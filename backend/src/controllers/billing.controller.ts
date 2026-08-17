import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { createError } from '../middleware/errorHandler.js';
import pool from '../database/connection.js';
import { getPlanConfig } from '../utils/planConfig.js';
import path from 'path';
import fs from 'fs';

const ensurePaymentRequestsTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscription_payment_requests (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
      plan_key VARCHAR(50) NOT NULL,
      amount DECIMAL(10, 2) NOT NULL,
      method VARCHAR(50) NOT NULL DEFAULT 'sham_cash',
      proof_url TEXT NOT NULL,
      status VARCHAR(50) DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
      admin_note TEXT,
      reviewed_by UUID REFERENCES merchants(id),
      reviewed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_subscription_payment_requests_merchant
    ON subscription_payment_requests(merchant_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_subscription_payment_requests_status
    ON subscription_payment_requests(status)
  `);
};

const ensureAdminNotificationsTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_notifications (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      type VARCHAR(50) NOT NULL,
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      data JSONB,
      is_read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      read_at TIMESTAMP
    )
  `);
};

type OfflineMethodId = 'sham_cash' | 'usdt';

async function getOfflinePaymentSettings() {
  const result = await pool.query(
    `SELECT value::jsonb FROM global_settings WHERE key = 'admin_global_settings'`
  );
  const settings = result.rows[0]?.value || {};
  const shamCash = settings.paymentMethods?.shamCash || {};
  const usdt = settings.paymentMethods?.usdt || {};

  return {
    sham_cash: {
      id: 'sham_cash' as OfflineMethodId,
      name: 'شام كاش',
      enabled: shamCash.enabled !== false,
      walletAddress: shamCash.walletAddress || '',
      qrImageUrl: shamCash.qrImageUrl || '',
      network: '',
      instructions: shamCash.instructions || 'حوّل المبلغ إلى عنوان المحفظة ثم ارفع إثبات التحويل.'
    },
    usdt: {
      id: 'usdt' as OfflineMethodId,
      name: 'USDT',
      enabled: usdt.enabled !== false,
      walletAddress: usdt.walletAddress || '',
      qrImageUrl: usdt.qrImageUrl || '',
      network: usdt.network || '',
      instructions: usdt.instructions || 'حوّل المبلغ بـ USDT إلى عنوان المحفظة ثم ارفع إثبات التحويل.'
    }
  };
}

function isMethodReady(method: { enabled: boolean; walletAddress: string; qrImageUrl: string }) {
  return Boolean(method.enabled && method.walletAddress && method.qrImageUrl);
}

/**
 * Merchant: get enabled offline payment methods (Sham Cash / USDT)
 */
export const getPaymentMethods = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const all = await getOfflinePaymentSettings();
    const methods = Object.values(all)
      .filter(isMethodReady)
      .map((method) => ({
        id: method.id,
        name: method.name,
        type: 'offline',
        walletAddress: method.walletAddress,
        qrImageUrl: method.qrImageUrl,
        network: method.network || undefined,
        instructions: method.instructions
      }));

    res.json({
      success: true,
      data: { methods }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Merchant: submit subscription payment request with proof
 */
export const submitPaymentRequest = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const { planKey, proofUrl, method: methodId } = req.body;

    if (!planKey || !['comments', 'single', 'social', 'yearly'].includes(planKey)) {
      return next(createError('خطة اشتراك غير صالحة', 400));
    }
    if (!proofUrl || typeof proofUrl !== 'string') {
      return next(createError('إثبات الدفع مطلوب', 400));
    }
    if (!methodId || !['sham_cash', 'usdt'].includes(methodId)) {
      return next(createError('وسيلة دفع غير صالحة', 400));
    }

    // Ensure proof belongs to this merchant (tenant isolation)
    const proofPath = proofUrl.replace(/^https?:\/\/[^/]+/, '');
    if (!proofPath.includes(`/uploads/${merchantId}/`) && !proofPath.startsWith(`/uploads/${merchantId}/`)) {
      return next(createError('ملف الإثبات غير صالح', 400));
    }

    const allMethods = await getOfflinePaymentSettings();
    const selectedMethod = allMethods[methodId as OfflineMethodId];
    if (!selectedMethod || !isMethodReady(selectedMethod)) {
      return next(createError('وسيلة الدفع غير متاحة حالياً', 400));
    }

    const planConfig = await getPlanConfig(planKey);
    const amount = planConfig.price;

    await ensurePaymentRequestsTable();
    await ensureAdminNotificationsTable();

    // Prevent duplicate pending requests for same plan
    const existing = await pool.query(
      `SELECT id FROM subscription_payment_requests
       WHERE merchant_id = $1 AND plan_key = $2 AND status = 'pending'
       LIMIT 1`,
      [merchantId, planKey]
    );
    if (existing.rows.length > 0) {
      return next(createError('لديك طلب دفع قيد المراجعة لهذه الخطة بالفعل', 400));
    }

    const merchantResult = await pool.query(
      'SELECT id, name, email FROM merchants WHERE id = $1',
      [merchantId]
    );
    if (merchantResult.rows.length === 0) {
      return next(createError('User not found', 404));
    }
    const merchant = merchantResult.rows[0];

    const insertResult = await pool.query(
      `INSERT INTO subscription_payment_requests
        (merchant_id, plan_key, amount, method, proof_url, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING id, created_at`,
      [merchantId, planKey, amount, methodId, proofUrl]
    );
    const request = insertResult.rows[0];

    await pool.query(
      `INSERT INTO admin_notifications (type, title, message, data, is_read)
       VALUES ($1, $2, $3, $4, FALSE)`,
      [
        'subscription_payment',
        `طلب اشتراك جديد — ${selectedMethod.name}`,
        `طلب التاجر ${merchant.name || merchant.email} الاشتراك في خطة ${planConfig.name} بمبلغ ${amount}$ عبر ${selectedMethod.name}`,
        JSON.stringify({
          paymentRequestId: request.id,
          merchantId: merchant.id,
          merchantName: merchant.name,
          merchantEmail: merchant.email,
          planKey,
          planName: planConfig.name,
          amount,
          method: methodId,
          proofUrl,
          createdAt: request.created_at
        })
      ]
    );

    res.json({
      success: true,
      message: 'تم إرسال طلب الدفع بنجاح. سيتم تفعيل اشتراكك بعد التأكيد.',
      data: {
        id: request.id,
        planKey,
        amount,
        method: methodId,
        status: 'pending',
        createdAt: request.created_at
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Merchant: list own payment requests
 */
export const getMyPaymentRequests = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    await ensurePaymentRequestsTable();

    const result = await pool.query(
      `SELECT id, plan_key, amount, method, proof_url, status, admin_note, created_at, reviewed_at
       FROM subscription_payment_requests
       WHERE merchant_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [merchantId]
    );

    res.json({
      success: true,
      data: result.rows.map((row) => ({
        id: row.id,
        planKey: row.plan_key,
        amount: parseFloat(row.amount),
        method: row.method,
        proofUrl: row.proof_url,
        status: row.status,
        adminNote: row.admin_note,
        createdAt: row.created_at,
        reviewedAt: row.reviewed_at
      }))
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Admin: list all payment requests
 */
export const getAdminPaymentRequests = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    await ensurePaymentRequestsTable();

    const status = req.query.status as string | undefined;
    const params: any[] = [];
    let where = '';
    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      where = 'WHERE r.status = $1';
      params.push(status);
    }

    const result = await pool.query(
      `SELECT
         r.id, r.plan_key, r.amount, r.method, r.proof_url, r.status,
         r.admin_note, r.created_at, r.reviewed_at,
         m.id as merchant_id, m.name as merchant_name, m.email as merchant_email
       FROM subscription_payment_requests r
       JOIN merchants m ON m.id = r.merchant_id
       ${where}
       ORDER BY
         CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END,
         r.created_at DESC
       LIMIT 200`,
      params
    );

    res.json({
      success: true,
      data: result.rows.map((row) => ({
        id: row.id,
        planKey: row.plan_key,
        amount: parseFloat(row.amount),
        method: row.method,
        proofUrl: row.proof_url,
        status: row.status,
        adminNote: row.admin_note,
        createdAt: row.created_at,
        reviewedAt: row.reviewed_at,
        merchant: {
          id: row.merchant_id,
          name: row.merchant_name,
          email: row.merchant_email
        }
      }))
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Admin: approve or reject a payment request
 */
export const reviewPaymentRequest = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const { action, adminNote } = req.body;
    const adminId = req.merchantId;

    if (!action || !['approve', 'reject'].includes(action)) {
      return next(createError('إجراء غير صالح', 400));
    }

    await ensurePaymentRequestsTable();

    const result = await pool.query(
      `SELECT id, merchant_id, plan_key, amount, status
       FROM subscription_payment_requests
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return next(createError('طلب الدفع غير موجود', 404));
    }

    const paymentRequest = result.rows[0];
    if (paymentRequest.status !== 'pending') {
      return next(createError('تمت معالجة هذا الطلب مسبقاً', 400));
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';

    await pool.query(
      `UPDATE subscription_payment_requests
       SET status = $1,
           admin_note = $2,
           reviewed_by = $3,
           reviewed_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [newStatus, adminNote || null, adminId || null, id]
    );

    if (action === 'approve') {
      // Ensure optional end-date column exists (for yearly/monthly renewals)
      await pool.query(`
        ALTER TABLE merchants
        ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMP
      `);

      const planConfig = await getPlanConfig(paymentRequest.plan_key);
      const periodInterval = planConfig.billingPeriod === 'yearly' ? '1 year' : '1 month';
      await pool.query(
        `UPDATE merchants
         SET subscription_plan = $1,
             subscription_status = 'active',
             subscription_ends_at = CURRENT_TIMESTAMP + ($2)::interval,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [paymentRequest.plan_key, periodInterval, paymentRequest.merchant_id]
      );
    }

    res.json({
      success: true,
      message: action === 'approve'
        ? 'تم تأكيد الدفع وتفعيل الاشتراك'
        : 'تم رفض طلب الدفع',
      data: {
        id,
        status: newStatus
      }
    });
  } catch (error) {
    next(error);
  }
};

function resolveProofDiskPath(proofUrl: string, merchantId: string): string | null {
  const pathPart = proofUrl.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  const marker = `/uploads/${merchantId}/`;
  if (!pathPart.includes(marker) && !pathPart.startsWith(marker)) {
    return null;
  }
  const uploadsIdx = pathPart.indexOf('/uploads/');
  if (uploadsIdx === -1) return null;
  const relative = pathPart.slice(uploadsIdx + '/uploads/'.length);
  const uploadsRoot = path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'uploads');
  const full = path.resolve(uploadsRoot, relative);
  if (full !== uploadsRoot && !full.startsWith(uploadsRoot + path.sep)) {
    return null;
  }
  return full;
}

/** Authenticated download of a payment proof (admin). */
export const serveAdminPaymentProof = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    await ensurePaymentRequestsTable();
    const { id } = req.params;
    const result = await pool.query(
      `SELECT merchant_id, proof_url FROM subscription_payment_requests WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (result.rows.length === 0) {
      return next(createError('Not found', 404));
    }
    const { merchant_id: merchantId, proof_url: proofUrl } = result.rows[0];
    const diskPath = resolveProofDiskPath(proofUrl, merchantId);
    if (!diskPath || !fs.existsSync(diskPath) || !fs.statSync(diskPath).isFile()) {
      return next(createError('Proof file not found', 404));
    }
    const ext = path.extname(diskPath).toLowerCase();
    const mime =
      ext === '.pdf' ? 'application/pdf'
      : ext === '.webp' ? 'image/webp'
      : ext === '.png' ? 'image/png'
      : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
      : 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    return res.sendFile(diskPath);
  } catch (error) {
    next(error);
  }
};

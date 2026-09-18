import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.js';
import { createError } from '../middleware/errorHandler.js';
import pool from '../database/connection.js';
import path from 'path';
import fs from 'fs';
import {
  ensureAgencySchema,
  activateAgencyAccount,
  listAgencies,
  listAgencyPricing,
  upsertAgencyPricing,
  setAgencyStatus,
  listAdminSeatPayments,
  reviewSeatPayment,
  listAgencySeats,
  getAgencyByOwnerMerchantId
} from '../services/agency/index.js';
import {
  listAgencySignupRequests,
  approveAgencySignupRequest,
  rejectAgencySignupRequest,
  type AgencySignupStatus
} from '../services/agency/signupRequests.js';
import { isPaidPlanKey } from '../utils/planDefinitions.js';

export const adminListAgencies = async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const agencies = await listAgencies();
    res.json({ success: true, data: { agencies } });
  } catch (error) {
    next(error);
  }
};

export const adminActivateAgency = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { merchantId, name, notes, pricing } = req.body || {};
    if (!merchantId || typeof merchantId !== 'string') {
      return next(createError('معرّف التاجر مطلوب', 400));
    }

    let parsedPricing: Array<{ planKey: string; unitPrice: number }> | undefined;
    if (Array.isArray(pricing)) {
      parsedPricing = pricing.map((p: { planKey?: string; unitPrice?: number }) => ({
        planKey: String(p.planKey || ''),
        unitPrice: Number(p.unitPrice)
      }));
      for (const p of parsedPricing) {
        if (!isPaidPlanKey(p.planKey)) {
          return next(createError(`باقة غير صالحة: ${p.planKey}`, 400));
        }
      }
    }

    const result = await activateAgencyAccount({
      merchantId,
      name,
      notes,
      pricing: parsedPricing
    });

    res.status(201).json({
      success: true,
      message: 'تم تفعيل حساب الوكالة',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

export const adminGetAgency = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await ensureAgencySchema();
    const { id } = req.params;
    const agencies = await listAgencies();
    const agency = agencies.find((a) => a.id === id);
    if (!agency) return next(createError('الوكالة غير موجودة', 404));

    const pricing = await listAgencyPricing(id);
    const seats = await listAgencySeats(id);

    res.json({
      success: true,
      data: { agency, pricing, seats }
    });
  } catch (error) {
    next(error);
  }
};

export const adminUpdateAgencyPricing = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { pricing } = req.body || {};
    if (!Array.isArray(pricing) || pricing.length === 0) {
      return next(createError('قائمة الأسعار مطلوبة', 400));
    }

    const parsed = pricing.map((p: { planKey?: string; unitPrice?: number }) => ({
      planKey: String(p.planKey || ''),
      unitPrice: Number(p.unitPrice)
    }));

    const updated = await upsertAgencyPricing(id, parsed);
    res.json({
      success: true,
      message: 'تم تحديث أسعار الوكالة',
      data: { pricing: updated }
    });
  } catch (error) {
    next(error);
  }
};

export const adminUpdateAgencyStatus = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!status || !['active', 'suspended'].includes(status)) {
      return next(createError('حالة غير صالحة', 400));
    }
    const agency = await setAgencyStatus(id, status);
    res.json({
      success: true,
      message: status === 'active' ? 'تم تفعيل الوكالة' : 'تم تعليق الوكالة',
      data: {
        agency: {
          id: agency.id,
          status: agency.status,
          name: agency.name
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

export const adminListSeatPayments = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status as string | undefined;
    const payments = await listAdminSeatPayments(status);
    res.json({ success: true, data: { payments } });
  } catch (error) {
    next(error);
  }
};

export const adminReviewSeatPayment = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { action, adminNote } = req.body || {};
    const adminId = req.merchantId;
    if (!adminId) return next(createError('Unauthorized', 401));
    if (!action || !['approve', 'reject'].includes(action)) {
      return next(createError('إجراء غير صالح', 400));
    }

    const result = await reviewSeatPayment({
      paymentId: id,
      action,
      adminId,
      adminNote
    });

    res.json({
      success: true,
      message: action === 'approve' ? 'تم تأكيد الدفع وتفعيل المقعد' : 'تم رفض طلب الدفع',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

export const serveAdminAgencyPaymentProof = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    await ensureAgencySchema();
    const { id } = req.params;
    const result = await pool.query(
      `SELECT p.proof_url, a.owner_merchant_id
       FROM agency_seat_payments p
       JOIN agencies a ON a.id = p.agency_id
       WHERE p.id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return next(createError('طلب الدفع غير موجود', 404));
    }

    const { proof_url: proofUrl, owner_merchant_id: ownerId } = result.rows[0];
    const diskPath = resolveProofDiskPath(proofUrl, ownerId);
    if (!diskPath || !fs.existsSync(diskPath)) {
      return next(createError('ملف الإثبات غير موجود', 404));
    }

    res.sendFile(path.resolve(diskPath));
  } catch (error) {
    next(error);
  }
};

function resolveProofDiskPath(proofUrl: string, merchantId: string): string | null {
  try {
    const cleaned = proofUrl.replace(/^https?:\/\/[^/]+/, '');
    const marker = `/uploads/${merchantId}/`;
    const idx = cleaned.indexOf(marker);
    if (idx === -1) return null;
    const relative = cleaned.slice(idx + '/uploads/'.length);
    const uploadsRoot = path.join(process.cwd(), 'uploads');
    const full = path.join(uploadsRoot, relative);
    if (!full.startsWith(uploadsRoot)) return null;
    return full;
  } catch {
    return null;
  }
}

/** Lookup helper: find merchant candidates that can become agencies */
export const adminListAgencySignupRequests = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const status = req.query.status as AgencySignupStatus | undefined;
    const allowed = ['pending', 'approved', 'rejected'] as const;
    const filter =
      status && (allowed as readonly string[]).includes(status) ? status : undefined;
    const requests = await listAgencySignupRequests(filter);
    res.json({
      success: true,
      data: {
        requests: requests.map((r) => ({
          id: r.id,
          email: r.email,
          phone: r.phone,
          agencyName: r.agency_name,
          status: r.status,
          adminNote: r.admin_note,
          reviewedAt: r.reviewed_at,
          createdMerchantId: r.created_merchant_id,
          createdAt: r.created_at,
        })),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const adminApproveAgencySignupRequest = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const adminId = req.merchantId;
    if (!adminId) return next(createError('Unauthorized', 401));

    const { adminNote, pricing } = req.body || {};
    let parsedPricing: Array<{ planKey: string; unitPrice: number }> | undefined;
    if (Array.isArray(pricing)) {
      parsedPricing = pricing.map((p: { planKey?: string; unitPrice?: number }) => ({
        planKey: String(p.planKey || ''),
        unitPrice: Number(p.unitPrice),
      }));
      for (const p of parsedPricing) {
        if (!isPaidPlanKey(p.planKey)) {
          return next(createError(`باقة غير صالحة: ${p.planKey}`, 400));
        }
      }
    }

    const result = await approveAgencySignupRequest({
      requestId: id,
      adminId,
      adminNote: adminNote || null,
      pricing: parsedPricing,
    });

    res.json({
      success: true,
      message: 'تمت الموافقة وإنشاء حساب الوكالة',
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

export const adminRejectAgencySignupRequest = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const adminId = req.merchantId;
    if (!adminId) return next(createError('Unauthorized', 401));

    const { adminNote } = req.body || {};
    const request = await rejectAgencySignupRequest({
      requestId: id,
      adminId,
      adminNote: adminNote || null,
    });

    res.json({
      success: true,
      message: 'تم رفض الطلب',
      data: {
        request: {
          id: request.id,
          email: request.email,
          phone: request.phone,
          agencyName: request.agency_name,
          status: request.status,
          adminNote: request.admin_note,
          reviewedAt: request.reviewed_at,
          createdAt: request.created_at,
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

export const adminSearchAgencyCandidates = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    await ensureAgencySchema();
    const q = String(req.query.q || '').trim().toLowerCase();
    if (q.length < 2) {
      return res.json({ success: true, data: { merchants: [] } });
    }

    const result = await pool.query(
      `SELECT id, email, name, account_type, subscription_plan
       FROM merchants
       WHERE role = 'user'
         AND COALESCE(account_type, 'merchant') = 'merchant'
         AND (LOWER(email) LIKE $1 OR LOWER(COALESCE(name, '')) LIKE $1)
       ORDER BY created_at DESC
       LIMIT 20`,
      [`%${q}%`]
    );

    const merchants = [];
    for (const row of result.rows) {
      const existing = await getAgencyByOwnerMerchantId(row.id);
      if (!existing) {
        merchants.push({
          id: row.id,
          email: row.email,
          name: row.name,
          subscriptionPlan: row.subscription_plan
        });
      }
    }

    res.json({ success: true, data: { merchants } });
  } catch (error) {
    next(error);
  }
};

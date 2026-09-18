import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import pool from '../../database/connection.js';
import { createError } from '../../middleware/errorHandler.js';
import { ensureAgencySchema, activateAgencyAccount } from './index.js';
import { normalizeSignupPhone } from '../signupOtp/index.js';
import { createAdminNotification } from '../adminNotifications.js';

async function generateUniqueReferralCode(email: string): Promise<string> {
  for (let attempts = 0; attempts < 20; attempts++) {
    const emailPrefix = email.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, '') || 'REF';
    const code = `${emailPrefix}${Math.floor(10000 + Math.random() * 90000)}`;
    const check = await pool.query(`SELECT id FROM merchants WHERE referral_code = $1`, [code]);
    if (check.rows.length === 0) return code;
  }
  return `AG${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

export type AgencySignupStatus = 'pending' | 'approved' | 'rejected';

export interface AgencySignupRequestRow {
  id: string;
  email: string;
  phone: string;
  agency_name: string;
  status: AgencySignupStatus;
  admin_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_merchant_id: string | null;
  created_at: string;
  updated_at: string;
}

let schemaReady = false;

export async function ensureAgencySignupSchema(): Promise<void> {
  if (schemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agency_signup_requests (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      email VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      phone VARCHAR(40) NOT NULL,
      agency_name VARCHAR(255) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
      admin_note TEXT,
      reviewed_by UUID REFERENCES merchants(id),
      reviewed_at TIMESTAMP,
      created_merchant_id UUID REFERENCES merchants(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_agency_signup_requests_email_pending
      ON agency_signup_requests (LOWER(TRIM(email)))
      WHERE status = 'pending'
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_agency_signup_requests_status
      ON agency_signup_requests (status, created_at DESC)
  `);
  schemaReady = true;
}

function mapRequest(row: Record<string, unknown>): AgencySignupRequestRow {
  return {
    id: String(row.id),
    email: String(row.email),
    phone: String(row.phone),
    agency_name: String(row.agency_name),
    status: row.status as AgencySignupStatus,
    admin_note: (row.admin_note as string | null) ?? null,
    reviewed_by: (row.reviewed_by as string | null) ?? null,
    reviewed_at: row.reviewed_at ? String(row.reviewed_at) : null,
    created_merchant_id: (row.created_merchant_id as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function createAgencySignupRequest(input: {
  email: string;
  password: string;
  phone: string;
  agencyName: string;
}): Promise<{ id: string; message: string }> {
  await ensureAgencySignupSchema();

  const email = input.email.trim().toLowerCase();
  const agencyName = input.agencyName.trim();
  if (!email || !agencyName) {
    throw createError('البريد الإلكتروني واسم الوكالة مطلوبان', 400);
  }
  if (!input.password || input.password.length < 8) {
    throw createError('كلمة المرور يجب أن تكون 8 أحرف على الأقل', 400);
  }

  let phone: string;
  try {
    ({ phone } = normalizeSignupPhone(input.phone));
  } catch (err) {
    throw createError(
      err instanceof Error ? err.message : 'رقم الهاتف غير صالح',
      400
    );
  }

  const existingMerchant = await pool.query(
    `SELECT id FROM merchants WHERE LOWER(TRIM(email)) = $1 LIMIT 1`,
    [email]
  );
  if (existingMerchant.rows.length > 0) {
    throw createError('هذا البريد الإلكتروني مسجّل بالفعل', 409);
  }

  const pending = await pool.query(
    `SELECT id FROM agency_signup_requests
     WHERE LOWER(TRIM(email)) = $1 AND status = 'pending'
     LIMIT 1`,
    [email]
  );
  if (pending.rows.length > 0) {
    throw createError('يوجد طلب قيد المراجعة لهذا البريد بالفعل', 409);
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const result = await pool.query(
    `INSERT INTO agency_signup_requests (email, password_hash, phone, agency_name, status)
     VALUES ($1, $2, $3, $4, 'pending')
     RETURNING id`,
    [email, passwordHash, phone, agencyName]
  );

  createAdminNotification({
    type: 'agency_signup_request',
    title: 'طلب إنشاء وكالة جديد',
    message: `${agencyName} — ${email} — ${phone}`,
    data: { requestId: result.rows[0].id, email, agencyName, phone, link: '/agencies' },
  }).catch(() => {});

  return {
    id: result.rows[0].id,
    message: 'تم استلام طلبك وسيتم الرد عليه في أقرب وقت ممكن',
  };
}

export async function listAgencySignupRequests(status?: AgencySignupStatus) {
  await ensureAgencySignupSchema();
  const params: string[] = [];
  let where = '';
  if (status) {
    params.push(status);
    where = `WHERE status = $1`;
  }
  const result = await pool.query(
    `SELECT id, email, phone, agency_name, status, admin_note, reviewed_by,
            reviewed_at, created_merchant_id, created_at, updated_at
     FROM agency_signup_requests
     ${where}
     ORDER BY
       CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
       created_at DESC
     LIMIT 200`,
    params
  );
  return result.rows.map(mapRequest);
}

export async function approveAgencySignupRequest(input: {
  requestId: string;
  adminId: string;
  adminNote?: string | null;
  pricing?: Array<{ planKey: string; unitPrice: number }>;
}) {
  await ensureAgencySignupSchema();
  await ensureAgencySchema();

  const reqResult = await pool.query(
    `SELECT * FROM agency_signup_requests WHERE id = $1`,
    [input.requestId]
  );
  if (reqResult.rows.length === 0) {
    throw createError('الطلب غير موجود', 404);
  }
  const req = reqResult.rows[0];
  if (req.status !== 'pending') {
    throw createError('تمت مراجعة هذا الطلب مسبقاً', 400);
  }

  const emailClash = await pool.query(
    `SELECT id FROM merchants WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) LIMIT 1`,
    [req.email]
  );
  if (emailClash.rows.length > 0) {
    throw createError('البريد الإلكتروني مستخدم بالفعل في حساب موجود', 409);
  }

  // Ensure referral_code column exists
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='merchants' AND column_name='referral_code'
      ) THEN
        ALTER TABLE merchants ADD COLUMN referral_code VARCHAR(100) UNIQUE;
      END IF;
    END $$;
  `);

  const referralCode = await generateUniqueReferralCode(req.email);
  const client = await pool.connect();
  let merchantId: string;
  try {
    await client.query('BEGIN');

    const lock = await client.query(
      `SELECT id, status FROM agency_signup_requests WHERE id = $1 FOR UPDATE`,
      [input.requestId]
    );
    if (lock.rows.length === 0) throw createError('الطلب غير موجود', 404);
    if (lock.rows[0].status !== 'pending') {
      throw createError('تمت مراجعة هذا الطلب مسبقاً', 400);
    }

    const merchantInsert = await client.query(
      `INSERT INTO merchants (
         email, password_hash, name, phone, role,
         subscription_plan, subscription_status, trial_ends_at, subscription_ends_at,
         referral_code, auth_provider, account_type
       ) VALUES (
         $1, $2, $3, $4, 'user',
         'agency', 'active', NULL, NULL,
         $5, 'email', 'merchant'
       )
       RETURNING id`,
      [req.email, req.password_hash, req.agency_name, req.phone, referralCode]
    );
    merchantId = merchantInsert.rows[0].id as string;

    await client.query(
      `INSERT INTO merchant_settings (merchant_id, store_name, welcome_message, store_currency)
       VALUES ($1, $2, $3, $4)`,
      [
        merchantId,
        req.agency_name,
        'أهلاً بك في متجرنا! كيف يمكنني مساعدتك اليوم؟',
        'USD',
      ]
    );

    await client.query(
      `UPDATE agency_signup_requests
       SET status = 'approved',
           admin_note = $2,
           reviewed_by = $3,
           reviewed_at = NOW(),
           created_merchant_id = $4,
           updated_at = NOW()
       WHERE id = $1`,
      [input.requestId, input.adminNote || null, input.adminId, merchantId]
    );

    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }

  const agency = await activateAgencyAccount({
    merchantId,
    name: req.agency_name,
    notes: input.adminNote || null,
    pricing: input.pricing,
  });

  return {
    request: mapRequest({
      ...req,
      status: 'approved',
      admin_note: input.adminNote || null,
      reviewed_by: input.adminId,
      created_merchant_id: merchantId,
    }),
    agency,
  };
}

export async function rejectAgencySignupRequest(input: {
  requestId: string;
  adminId: string;
  adminNote?: string | null;
}) {
  await ensureAgencySignupSchema();

  const result = await pool.query(
    `UPDATE agency_signup_requests
     SET status = 'rejected',
         admin_note = $2,
         reviewed_by = $3,
         reviewed_at = NOW(),
         updated_at = NOW()
     WHERE id = $1 AND status = 'pending'
     RETURNING id, email, phone, agency_name, status, admin_note, reviewed_by,
               reviewed_at, created_merchant_id, created_at, updated_at`,
    [input.requestId, input.adminNote || null, input.adminId]
  );

  if (result.rows.length === 0) {
    const exists = await pool.query(
      `SELECT status FROM agency_signup_requests WHERE id = $1`,
      [input.requestId]
    );
    if (exists.rows.length === 0) throw createError('الطلب غير موجود', 404);
    throw createError('تمت مراجعة هذا الطلب مسبقاً', 400);
  }

  return mapRequest(result.rows[0]);
}

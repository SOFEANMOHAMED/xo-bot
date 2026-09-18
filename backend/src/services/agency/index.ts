import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import pool from '../../database/connection.js';
import { createError } from '../../middleware/errorHandler.js';
import { getPlanConfig } from '../../utils/planConfig.js';
import { PAID_PLAN_KEYS, isPaidPlanKey, type PaidPlanKey } from '../../utils/planDefinitions.js';
import { createAdminNotification } from '../adminNotifications.js';
import { ensureSubscriptionEndsAtColumn } from '../subscriptionExpiry/index.js';
import { normalizeMerchantEmail } from '../merchantOnboarding.js';

export type AccountType = 'merchant' | 'agency' | 'agency_client';
export type AgencySeatStatus = 'pending_payment' | 'active' | 'suspended' | 'cancelled';
export type SeatPaymentPurpose = 'activate' | 'renew' | 'change_plan';
export type OfflineMethodId = 'sham_cash' | 'usdt';

let schemaReady = false;

export async function ensureAgencySchema(): Promise<void> {
  if (schemaReady) return;

  await pool.query(`
    ALTER TABLE merchants
      ADD COLUMN IF NOT EXISTS account_type VARCHAR(30) NOT NULL DEFAULT 'merchant'
  `);

  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'merchants_account_type_check'
      ) THEN
        ALTER TABLE merchants
          ADD CONSTRAINT merchants_account_type_check
          CHECK (account_type IN ('merchant', 'agency', 'agency_client'));
      END IF;
    END $$;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agencies (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      owner_merchant_id UUID NOT NULL UNIQUE REFERENCES merchants(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended')),
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agency_pricing (
      agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
      plan_key VARCHAR(50) NOT NULL,
      unit_price DECIMAL(10, 2) NOT NULL CHECK (unit_price > 0),
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (agency_id, plan_key)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agency_seats (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
      client_merchant_id UUID NOT NULL UNIQUE REFERENCES merchants(id) ON DELETE CASCADE,
      plan_key VARCHAR(50) NOT NULL,
      agency_unit_price_snapshot DECIMAL(10, 2) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'pending_payment'
        CHECK (status IN ('pending_payment', 'active', 'suspended', 'cancelled')),
      client_label VARCHAR(255),
      starts_at TIMESTAMP,
      ends_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS agency_seat_payments (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      agency_id UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
      seat_id UUID NOT NULL REFERENCES agency_seats(id) ON DELETE CASCADE,
      plan_key VARCHAR(50) NOT NULL,
      amount DECIMAL(10, 2) NOT NULL,
      purpose VARCHAR(30) NOT NULL DEFAULT 'activate'
        CHECK (purpose IN ('activate', 'renew', 'change_plan')),
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

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_merchants_account_type ON merchants(account_type)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_agencies_status ON agencies(status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_agency_seats_agency ON agency_seats(agency_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_agency_seat_payments_status ON agency_seat_payments(status)`);

  schemaReady = true;
}

export async function getMerchantAccountType(merchantId: string): Promise<AccountType> {
  await ensureAgencySchema();
  const result = await pool.query(
    `SELECT account_type FROM merchants WHERE id = $1`,
    [merchantId]
  );
  if (result.rows.length === 0) {
    throw createError('User not found', 404);
  }
  return (result.rows[0].account_type || 'merchant') as AccountType;
}

export async function getAgencyByOwnerMerchantId(ownerMerchantId: string) {
  await ensureAgencySchema();
  const result = await pool.query(
    `SELECT a.*, m.email as owner_email, m.name as owner_name
     FROM agencies a
     JOIN merchants m ON m.id = a.owner_merchant_id
     WHERE a.owner_merchant_id = $1`,
    [ownerMerchantId]
  );
  return result.rows[0] || null;
}

export async function requireActiveAgency(ownerMerchantId: string) {
  const agency = await getAgencyByOwnerMerchantId(ownerMerchantId);
  if (!agency) {
    throw createError('هذا الحساب ليس وكالة', 403);
  }
  if (agency.status !== 'active') {
    throw createError('تم تعليق حساب الوكالة', 403);
  }
  return agency;
}

function mapPricingRows(rows: Array<{ plan_key: string; unit_price: string | number }>) {
  return rows.map((row) => ({
    planKey: row.plan_key,
    unitPrice: parseFloat(String(row.unit_price))
  }));
}

export async function listAgencyPricing(agencyId: string) {
  const result = await pool.query(
    `SELECT plan_key, unit_price FROM agency_pricing WHERE agency_id = $1 ORDER BY plan_key`,
    [agencyId]
  );
  return mapPricingRows(result.rows);
}

export async function getAgencyUnitPrice(agencyId: string, planKey: string): Promise<number> {
  const result = await pool.query(
    `SELECT unit_price FROM agency_pricing WHERE agency_id = $1 AND plan_key = $2`,
    [agencyId, planKey]
  );
  if (result.rows.length === 0) {
    throw createError('لا يوجد سعر متفق عليه لهذه الباقة لدى الوكالة. تواصل مع الإدارة.', 400);
  }
  return parseFloat(String(result.rows[0].unit_price));
}

export async function upsertAgencyPricing(
  agencyId: string,
  prices: Array<{ planKey: string; unitPrice: number }>
) {
  for (const item of prices) {
    if (!isPaidPlanKey(item.planKey)) {
      throw createError(`باقة غير صالحة: ${item.planKey}`, 400);
    }
    if (!(item.unitPrice > 0)) {
      throw createError('سعر الوكالة يجب أن يكون أكبر من صفر', 400);
    }
    await pool.query(
      `INSERT INTO agency_pricing (agency_id, plan_key, unit_price, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (agency_id, plan_key)
       DO UPDATE SET unit_price = EXCLUDED.unit_price, updated_at = CURRENT_TIMESTAMP`,
      [agencyId, item.planKey, item.unitPrice]
    );
  }
  return listAgencyPricing(agencyId);
}

export async function activateAgencyAccount(input: {
  merchantId: string;
  name?: string;
  notes?: string | null;
  pricing?: Array<{ planKey: string; unitPrice: number }>;
}) {
  await ensureAgencySchema();
  await ensureSubscriptionEndsAtColumn();

  const merchantResult = await pool.query(
    `SELECT id, email, name, account_type, role FROM merchants WHERE id = $1`,
    [input.merchantId]
  );
  if (merchantResult.rows.length === 0) {
    throw createError('المستخدم غير موجود', 404);
  }
  const merchant = merchantResult.rows[0];
  if (merchant.role === 'owner' || merchant.role === 'admin') {
    throw createError('لا يمكن تحويل حساب إداري إلى وكالة', 400);
  }
  if (merchant.account_type === 'agency_client') {
    throw createError('حساب عميل وكالة لا يمكن تحويله إلى وكالة', 400);
  }

  const existing = await getAgencyByOwnerMerchantId(input.merchantId);
  if (existing) {
    throw createError('هذا الحساب وكالة بالفعل', 400);
  }

  const agencyName =
    (input.name || merchant.name || merchant.email || 'وكالة').toString().trim() || 'وكالة';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE merchants
       SET account_type = 'agency',
           subscription_plan = 'agency',
           subscription_status = 'active',
           trial_ends_at = NULL,
           subscription_ends_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [input.merchantId]
    );

    const agencyInsert = await client.query(
      `INSERT INTO agencies (owner_merchant_id, name, status, notes)
       VALUES ($1, $2, 'active', $3)
       RETURNING *`,
      [input.merchantId, agencyName, input.notes || null]
    );
    await client.query('COMMIT');

    const agency = agencyInsert.rows[0];
    if (input.pricing?.length) {
      await upsertAgencyPricing(agency.id, input.pricing);
    }

    return {
      agency: {
        id: agency.id,
        name: agency.name,
        status: agency.status,
        notes: agency.notes,
        ownerMerchantId: agency.owner_merchant_id,
        createdAt: agency.created_at
      },
      pricing: await listAgencyPricing(agency.id)
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function setAgencyStatus(agencyId: string, status: 'active' | 'suspended') {
  const result = await pool.query(
    `UPDATE agencies
     SET status = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2
     RETURNING *`,
    [status, agencyId]
  );
  if (result.rows.length === 0) {
    throw createError('الوكالة غير موجودة', 404);
  }
  return result.rows[0];
}

export async function listAgencies() {
  await ensureAgencySchema();
  const result = await pool.query(
    `SELECT
       a.id, a.name, a.status, a.notes, a.created_at, a.updated_at,
       a.owner_merchant_id,
       m.email as owner_email, m.name as owner_name,
       (SELECT COUNT(*)::int FROM agency_seats s WHERE s.agency_id = a.id) as seat_count,
       (SELECT COUNT(*)::int FROM agency_seats s WHERE s.agency_id = a.id AND s.status = 'active') as active_seat_count
     FROM agencies a
     JOIN merchants m ON m.id = a.owner_merchant_id
     ORDER BY a.created_at DESC`
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ownerMerchantId: row.owner_merchant_id,
    ownerEmail: row.owner_email,
    ownerName: row.owner_name,
    seatCount: row.seat_count,
    activeSeatCount: row.active_seat_count
  }));
}

async function generateUniqueReferralCode(email: string): Promise<string> {
  for (let attempts = 0; attempts < 20; attempts++) {
    const emailPrefix = email.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, '') || 'REF';
    const code = `${emailPrefix}${Math.floor(10000 + Math.random() * 90000)}`;
    const check = await pool.query(`SELECT id FROM merchants WHERE referral_code = $1`, [code]);
    if (check.rows.length === 0) return code;
  }
  return `AG${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

function mapSeatRow(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    agencyId: row.agency_id as string,
    clientMerchantId: row.client_merchant_id as string,
    planKey: row.plan_key as string,
    unitPrice: parseFloat(String(row.agency_unit_price_snapshot)),
    status: row.status as AgencySeatStatus,
    clientLabel: (row.client_label as string | null) || null,
    startsAt: row.starts_at || null,
    endsAt: row.ends_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    clientEmail: (row.client_email as string | undefined) || undefined,
    clientName: (row.client_name as string | null | undefined) ?? undefined,
    clientSubscriptionStatus: (row.client_subscription_status as string | undefined) || undefined
  };
}

export async function listAgencySeats(agencyId: string) {
  const result = await pool.query(
    `SELECT
       s.*,
       m.email as client_email,
       m.name as client_name,
       m.subscription_status as client_subscription_status
     FROM agency_seats s
     JOIN merchants m ON m.id = s.client_merchant_id
     WHERE s.agency_id = $1
     ORDER BY s.created_at DESC`,
    [agencyId]
  );
  return result.rows.map(mapSeatRow);
}

export async function createAgencySeat(input: {
  agencyId: string;
  email: string;
  password: string;
  planKey: PaidPlanKey;
  clientLabel?: string;
  clientName?: string;
}) {
  await ensureAgencySchema();
  await ensureSubscriptionEndsAtColumn();

  if (!isPaidPlanKey(input.planKey)) {
    throw createError('باقة غير صالحة', 400);
  }
  if (!input.password || input.password.length < 6) {
    throw createError('كلمة المرور يجب أن تكون 6 أحرف على الأقل', 400);
  }

  const email = normalizeMerchantEmail(input.email);
  const existingEmail = await pool.query(
    `SELECT id FROM merchants WHERE LOWER(TRIM(email)) = $1`,
    [email]
  );
  if (existingEmail.rows.length > 0) {
    throw createError('البريد الإلكتروني مستخدم مسبقاً', 400);
  }

  const unitPrice = await getAgencyUnitPrice(input.agencyId, input.planKey);
  const passwordHash = await bcrypt.hash(input.password, 10);

  // Ensure referral_code column exists (same as onboarding)
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='merchants' AND column_name='referral_code') THEN
        ALTER TABLE merchants ADD COLUMN referral_code VARCHAR(100) UNIQUE;
      END IF;
    END $$;
  `);

  const referralCode = await generateUniqueReferralCode(email);
  const storeName = (input.clientLabel || input.clientName || 'متجر العميل').trim() || 'متجر العميل';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const merchantInsert = await client.query(
      `INSERT INTO merchants (
         email, password_hash, name, role,
         subscription_plan, subscription_status, trial_ends_at, subscription_ends_at,
         referral_code, auth_provider, account_type
       ) VALUES (
         $1, $2, $3, 'user',
         $4, 'suspended', NULL, NULL,
         $5, 'email', 'agency_client'
       )
       RETURNING id, email, name, subscription_plan, subscription_status`,
      [email, passwordHash, input.clientName || input.clientLabel || null, input.planKey, referralCode]
    );
    const clientMerchant = merchantInsert.rows[0];

    await client.query(
      `INSERT INTO merchant_settings (merchant_id, store_name, welcome_message, store_currency)
       VALUES ($1, $2, $3, $4)`,
      [
        clientMerchant.id,
        storeName,
        'أهلاً بك في متجرنا! كيف يمكنني مساعدتك اليوم؟',
        'USD'
      ]
    );

    const seatInsert = await client.query(
      `INSERT INTO agency_seats (
         agency_id, client_merchant_id, plan_key, agency_unit_price_snapshot,
         status, client_label
       ) VALUES ($1, $2, $3, $4, 'pending_payment', $5)
       RETURNING *`,
      [input.agencyId, clientMerchant.id, input.planKey, unitPrice, input.clientLabel || null]
    );

    await client.query('COMMIT');

    const seat = seatInsert.rows[0];
    return {
      seat: mapSeatRow({
        ...seat,
        client_email: clientMerchant.email,
        client_name: clientMerchant.name,
        client_subscription_status: clientMerchant.subscription_status
      }),
      amountDue: unitPrice
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getSeatForAgency(agencyId: string, seatId: string) {
  const result = await pool.query(
    `SELECT s.*, m.email as client_email, m.name as client_name,
            m.subscription_status as client_subscription_status
     FROM agency_seats s
     JOIN merchants m ON m.id = s.client_merchant_id
     WHERE s.id = $1 AND s.agency_id = $2`,
    [seatId, agencyId]
  );
  if (result.rows.length === 0) {
    throw createError('المقعد غير موجود', 404);
  }
  return result.rows[0];
}

export async function submitSeatPayment(input: {
  agencyId: string;
  agencyOwnerMerchantId: string;
  seatId: string;
  proofUrl: string;
  method: OfflineMethodId;
  purpose: SeatPaymentPurpose;
  planKey?: PaidPlanKey;
}) {
  await ensureAgencySchema();

  if (!['sham_cash', 'usdt'].includes(input.method)) {
    throw createError('وسيلة دفع غير صالحة', 400);
  }
  if (!input.proofUrl || typeof input.proofUrl !== 'string') {
    throw createError('إثبات الدفع مطلوب', 400);
  }

  const proofPath = input.proofUrl.replace(/^https?:\/\/[^/]+/, '');
  if (
    !proofPath.includes(`/uploads/${input.agencyOwnerMerchantId}/`) &&
    !proofPath.startsWith(`/uploads/${input.agencyOwnerMerchantId}/`)
  ) {
    throw createError('ملف الإثبات غير صالح', 400);
  }

  const seat = await getSeatForAgency(input.agencyId, input.seatId);

  if (input.purpose === 'activate' && seat.status !== 'pending_payment' && seat.status !== 'suspended') {
    throw createError('هذا المقعد لا يحتاج تفعيل دفع حالياً', 400);
  }
  if (input.purpose === 'renew' && seat.status !== 'active' && seat.status !== 'suspended') {
    throw createError('لا يمكن تجديد مقعد غير مفعّل', 400);
  }
  if (input.purpose === 'change_plan') {
    if (!input.planKey || !isPaidPlanKey(input.planKey)) {
      throw createError('باقة جديدة مطلوبة', 400);
    }
    if (seat.status === 'cancelled') {
      throw createError('لا يمكن تغيير باقة مقعد ملغى', 400);
    }
  }

  const pending = await pool.query(
    `SELECT id FROM agency_seat_payments
     WHERE seat_id = $1 AND status = 'pending'
     LIMIT 1`,
    [input.seatId]
  );
  if (pending.rows.length > 0) {
    throw createError('يوجد طلب دفع قيد المراجعة لهذا المقعد', 400);
  }

  const planKey = (input.purpose === 'change_plan' ? input.planKey! : seat.plan_key) as PaidPlanKey;
  const amount = await getAgencyUnitPrice(input.agencyId, planKey);
  const planConfig = await getPlanConfig(planKey);

  // Snapshot price on seat for activate/change
  if (input.purpose === 'activate' || input.purpose === 'change_plan') {
    await pool.query(
      `UPDATE agency_seats
       SET plan_key = $1,
           agency_unit_price_snapshot = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [planKey, amount, input.seatId]
    );
  }

  const insert = await pool.query(
    `INSERT INTO agency_seat_payments
       (agency_id, seat_id, plan_key, amount, purpose, method, proof_url, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
     RETURNING *`,
    [input.agencyId, input.seatId, planKey, amount, input.purpose, input.method, input.proofUrl]
  );

  const payment = insert.rows[0];
  const agency = await pool.query(`SELECT name FROM agencies WHERE id = $1`, [input.agencyId]);
  const agencyName = agency.rows[0]?.name || 'وكالة';

  await createAdminNotification({
    type: 'agency_seat_payment',
    title: `دفع مقعد وكالة — ${agencyName}`,
    message: `طلب ${input.purpose} لمقعد ${seat.client_label || seat.client_email} بخطة ${planConfig.name} بمبلغ ${amount}$`,
    data: {
      paymentId: payment.id,
      agencyId: input.agencyId,
      seatId: input.seatId,
      planKey,
      amount,
      purpose: input.purpose,
      method: input.method,
      proofUrl: input.proofUrl
    }
  });

  return {
    id: payment.id,
    seatId: payment.seat_id,
    planKey: payment.plan_key,
    amount: parseFloat(String(payment.amount)),
    purpose: payment.purpose,
    method: payment.method,
    status: payment.status,
    createdAt: payment.created_at
  };
}

export async function suspendAgencySeat(agencyId: string, seatId: string) {
  const seat = await getSeatForAgency(agencyId, seatId);
  if (seat.status === 'cancelled') {
    throw createError('المقعد ملغى مسبقاً', 400);
  }

  await pool.query(
    `UPDATE agency_seats
     SET status = 'suspended', updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [seatId]
  );
  await pool.query(
    `UPDATE merchants
     SET subscription_status = 'suspended', updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [seat.client_merchant_id]
  );

  return mapSeatRow({ ...seat, status: 'suspended', client_subscription_status: 'suspended' });
}

export async function cancelAgencySeat(agencyId: string, seatId: string) {
  const seat = await getSeatForAgency(agencyId, seatId);
  if (seat.status === 'cancelled') {
    throw createError('المقعد ملغى مسبقاً', 400);
  }

  const pending = await pool.query(
    `SELECT id FROM agency_seat_payments
     WHERE seat_id = $1 AND status = 'pending'
     LIMIT 1`,
    [seatId]
  );
  if (pending.rows.length > 0) {
    throw createError('لا يمكن إلغاء مقعد لديه طلب دفع قيد المراجعة', 400);
  }

  await pool.query(
    `UPDATE agency_seats
     SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [seatId]
  );
  await pool.query(
    `UPDATE merchants
     SET subscription_status = 'suspended', updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [seat.client_merchant_id]
  );

  return mapSeatRow({ ...seat, status: 'cancelled', client_subscription_status: 'suspended' });
}

export async function updateAgencySeatLabel(
  agencyId: string,
  seatId: string,
  clientLabel: string | null
) {
  const seat = await getSeatForAgency(agencyId, seatId);
  if (seat.status === 'cancelled') {
    throw createError('لا يمكن تعديل مقعد ملغى', 400);
  }

  const label = clientLabel?.trim() || null;
  const result = await pool.query(
    `UPDATE agency_seats
     SET client_label = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 AND agency_id = $3
     RETURNING *`,
    [label, seatId, agencyId]
  );

  return mapSeatRow({
    ...result.rows[0],
    client_email: seat.client_email,
    client_name: seat.client_name,
    client_subscription_status: seat.client_subscription_status
  });
}

export async function resetAgencyClientPassword(
  agencyId: string,
  seatId: string,
  newPassword: string
) {
  if (!newPassword || newPassword.length < 6) {
    throw createError('كلمة المرور يجب أن تكون 6 أحرف على الأقل', 400);
  }

  const seat = await getSeatForAgency(agencyId, seatId);
  if (seat.status === 'cancelled') {
    throw createError('لا يمكن تعديل مقعد ملغى', 400);
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await pool.query(
    `UPDATE merchants
     SET password_hash = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2`,
    [passwordHash, seat.client_merchant_id]
  );

  return {
    seatId,
    clientEmail: seat.client_email as string,
    message: 'تم تحديث كلمة مرور العميل'
  };
}

export async function getAgencyReports(agencyId: string) {
  await ensureAgencySchema();

  const statusResult = await pool.query(
    `SELECT status, COUNT(*)::int AS count
     FROM agency_seats
     WHERE agency_id = $1
     GROUP BY status`,
    [agencyId]
  );

  const byStatus = {
    pending_payment: 0,
    active: 0,
    suspended: 0,
    cancelled: 0,
    total: 0
  };
  for (const row of statusResult.rows) {
    const key = row.status as keyof typeof byStatus;
    if (key in byStatus && key !== 'total') {
      byStatus[key] = row.count;
    }
    byStatus.total += row.count;
  }

  const planResult = await pool.query(
    `SELECT plan_key,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'active')::int AS active
     FROM agency_seats
     WHERE agency_id = $1 AND status <> 'cancelled'
     GROUP BY plan_key
     ORDER BY plan_key`,
    [agencyId]
  );

  const expiringResult = await pool.query(
    `SELECT
       s.id, s.plan_key, s.client_label, s.ends_at, s.agency_unit_price_snapshot,
       m.email AS client_email
     FROM agency_seats s
     JOIN merchants m ON m.id = s.client_merchant_id
     WHERE s.agency_id = $1
       AND s.status = 'active'
       AND s.ends_at IS NOT NULL
       AND s.ends_at > CURRENT_TIMESTAMP
       AND s.ends_at <= CURRENT_TIMESTAMP + INTERVAL '14 days'
     ORDER BY s.ends_at ASC
     LIMIT 20`,
    [agencyId]
  );

  const spendResult = await pool.query(
    `SELECT
       COALESCE(SUM(amount) FILTER (
         WHERE status = 'approved'
           AND COALESCE(reviewed_at, created_at) >= date_trunc('month', CURRENT_TIMESTAMP)
       ), 0)::float AS spent_this_month,
       COALESCE(SUM(amount) FILTER (WHERE status = 'approved'), 0)::float AS spent_total,
       COALESCE(SUM(amount) FILTER (WHERE status = 'pending'), 0)::float AS pending_amount,
       COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count,
       COUNT(*) FILTER (WHERE status = 'approved')::int AS approved_count
     FROM agency_seat_payments
     WHERE agency_id = $1`,
    [agencyId]
  );

  const spend = spendResult.rows[0] || {};

  return {
    seats: byStatus,
    byPlan: planResult.rows.map((row) => ({
      planKey: row.plan_key,
      total: row.total,
      active: row.active
    })),
    expiringSoon: expiringResult.rows.map((row) => ({
      id: row.id,
      planKey: row.plan_key,
      clientLabel: row.client_label,
      clientEmail: row.client_email,
      endsAt: row.ends_at,
      unitPrice: parseFloat(String(row.agency_unit_price_snapshot))
    })),
    spending: {
      thisMonth: Number(spend.spent_this_month) || 0,
      total: Number(spend.spent_total) || 0,
      pendingAmount: Number(spend.pending_amount) || 0,
      pendingCount: Number(spend.pending_count) || 0,
      approvedCount: Number(spend.approved_count) || 0
    }
  };
}

export async function listAgencySeatPaymentsForAgency(agencyId: string) {
  const result = await pool.query(
    `SELECT p.*, s.client_label, m.email as client_email
     FROM agency_seat_payments p
     JOIN agency_seats s ON s.id = p.seat_id
     JOIN merchants m ON m.id = s.client_merchant_id
     WHERE p.agency_id = $1
     ORDER BY p.created_at DESC
     LIMIT 50`,
    [agencyId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    seatId: row.seat_id,
    planKey: row.plan_key,
    amount: parseFloat(String(row.amount)),
    purpose: row.purpose,
    method: row.method,
    proofUrl: row.proof_url,
    status: row.status,
    adminNote: row.admin_note,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    clientLabel: row.client_label,
    clientEmail: row.client_email
  }));
}

export async function listAdminSeatPayments(status?: string) {
  await ensureAgencySchema();
  const params: string[] = [];
  let where = '';
  if (status && ['pending', 'approved', 'rejected'].includes(status)) {
    where = 'WHERE p.status = $1';
    params.push(status);
  }

  const result = await pool.query(
    `SELECT
       p.*,
       a.name as agency_name,
       s.client_label,
       cm.email as client_email,
       om.email as agency_owner_email
     FROM agency_seat_payments p
     JOIN agencies a ON a.id = p.agency_id
     JOIN agency_seats s ON s.id = p.seat_id
     JOIN merchants cm ON cm.id = s.client_merchant_id
     JOIN merchants om ON om.id = a.owner_merchant_id
     ${where}
     ORDER BY
       CASE WHEN p.status = 'pending' THEN 0 ELSE 1 END,
       p.created_at DESC
     LIMIT 200`,
    params
  );

  return result.rows.map((row) => ({
    id: row.id,
    seatId: row.seat_id,
    agencyId: row.agency_id,
    agencyName: row.agency_name,
    agencyOwnerEmail: row.agency_owner_email,
    clientLabel: row.client_label,
    clientEmail: row.client_email,
    planKey: row.plan_key,
    amount: parseFloat(String(row.amount)),
    purpose: row.purpose,
    method: row.method,
    proofUrl: row.proof_url,
    status: row.status,
    adminNote: row.admin_note,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at
  }));
}

export async function reviewSeatPayment(input: {
  paymentId: string;
  action: 'approve' | 'reject';
  adminId: string;
  adminNote?: string;
}) {
  await ensureAgencySchema();
  await ensureSubscriptionEndsAtColumn();

  const result = await pool.query(
    `SELECT p.*, s.client_merchant_id, s.status as seat_status, s.ends_at as seat_ends_at
     FROM agency_seat_payments p
     JOIN agency_seats s ON s.id = p.seat_id
     WHERE p.id = $1`,
    [input.paymentId]
  );
  if (result.rows.length === 0) {
    throw createError('طلب الدفع غير موجود', 404);
  }

  const payment = result.rows[0];
  if (payment.status !== 'pending') {
    throw createError('تمت معالجة هذا الطلب مسبقاً', 400);
  }

  const newStatus = input.action === 'approve' ? 'approved' : 'rejected';

  await pool.query(
    `UPDATE agency_seat_payments
     SET status = $1,
         admin_note = $2,
         reviewed_by = $3,
         reviewed_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $4`,
    [newStatus, input.adminNote || null, input.adminId, input.paymentId]
  );

  if (input.action === 'approve') {
    const planConfig = await getPlanConfig(payment.plan_key);
    const periodInterval = planConfig.billingPeriod === 'yearly' ? '1 year' : '1 month';

    await pool.query(
      `UPDATE agency_seats
       SET status = 'active',
           plan_key = $1,
           agency_unit_price_snapshot = $2,
           starts_at = COALESCE(starts_at, CURRENT_TIMESTAMP),
           ends_at = CASE
             WHEN ends_at IS NOT NULL AND ends_at > CURRENT_TIMESTAMP AND status = 'active'
             THEN ends_at + ($3)::interval
             ELSE CURRENT_TIMESTAMP + ($3)::interval
           END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [payment.plan_key, payment.amount, periodInterval, payment.seat_id]
    );

    await pool.query(
      `UPDATE merchants
       SET subscription_plan = $1,
           subscription_status = 'active',
           subscription_ends_at = (
             SELECT ends_at FROM agency_seats WHERE id = $2
           ),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [payment.plan_key, payment.seat_id, payment.client_merchant_id]
    );
  }

  return { id: input.paymentId, status: newStatus };
}

export { PAID_PLAN_KEYS };

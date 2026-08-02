import type { Pool, PoolClient } from 'pg';
import { calculateCommission } from './planConfig.js';

const CREATE_AFFILIATE_REFERRALS_TABLE = `
  CREATE TABLE IF NOT EXISTS affiliate_referrals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    referrer_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    referred_user_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    referral_code VARCHAR(100),
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'expired')),
    commission_amount DECIMAL(10, 2) DEFAULT 0,
    plan VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(referred_user_id)
  )
`;

/**
 * Decode referral code from Google OAuth `state` (base64url JSON { ref }).
 */
export function referralCodeFromOAuthState(stateParam: unknown): string | undefined {
  if (typeof stateParam !== 'string' || !stateParam.trim()) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(stateParam, 'base64url').toString('utf8')) as {
      ref?: string;
    };
    const ref =
      typeof parsed.ref === 'string'
        ? parsed.ref.trim().toUpperCase().replace(/[^A-Z0-9\-_]/g, '')
        : '';
    return ref || undefined;
  } catch {
    return undefined;
  }
}

const CREATE_AFFILIATE_CLICKS_TABLE = `
  CREATE TABLE IF NOT EXISTS affiliate_clicks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    referrer_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
    referral_code VARCHAR(100),
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`;

function normalizeReferralCode(raw: string | undefined | null): string {
  return (raw ?? '').trim().toUpperCase().replace(/[^A-Z0-9\-_]/g, '');
}

/**
 * Persist an affiliate link click (same semantics as GET /affiliate/track-click).
 */
export async function recordAffiliateClick(
  db: Pool | PoolClient,
  rawReferralCode: string | undefined | null,
  ipAddress: string | null,
  userAgent: string | null
): Promise<void> {
  const code = normalizeReferralCode(rawReferralCode);
  if (!code) return;

  await db.query(CREATE_AFFILIATE_CLICKS_TABLE);

  const referrerResult = await db.query('SELECT id FROM merchants WHERE referral_code = $1', [code]);
  if (referrerResult.rows.length === 0) return;

  await db.query(
    `INSERT INTO affiliate_clicks (referrer_id, referral_code, ip_address, user_agent)
     VALUES ($1, $2, $3, $4)`,
    [referrerResult.rows[0].id, code, ipAddress, userAgent]
  );
}

/**
 * Links a new merchant to an affiliate referrer by referral code.
 * Idempotent: ignores unknown codes, self-referral, and duplicate rows.
 */
export async function linkMerchantToAffiliateReferrer(
  db: Pool | PoolClient,
  referredMerchantId: string,
  rawReferralCode: string | undefined | null
): Promise<void> {
  const code = normalizeReferralCode(rawReferralCode);
  if (!code) return;

  await db.query(CREATE_AFFILIATE_REFERRALS_TABLE);

  const referrerResult = await db.query('SELECT id FROM merchants WHERE referral_code = $1', [code]);
  if (referrerResult.rows.length === 0) return;

  const referrerId = referrerResult.rows[0].id as string;
  if (referrerId === referredMerchantId) return;

  const planRow = await db.query('SELECT subscription_plan FROM merchants WHERE id = $1', [
    referredMerchantId
  ]);
  const plan = planRow.rows[0]?.subscription_plan || 'trial';
  const commissionAmount = await calculateCommission(plan);

  await db.query(
    `INSERT INTO affiliate_referrals (referrer_id, referred_user_id, referral_code, status, commission_amount, plan)
     VALUES ($1, $2, $3, 'pending', $4, $5)
     ON CONFLICT (referred_user_id) DO NOTHING`,
    [referrerId, referredMerchantId, code, commissionAmount, plan]
  );
}

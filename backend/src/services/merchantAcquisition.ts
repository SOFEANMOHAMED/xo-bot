/**
 * Merchant marketing acquisition (SaaS ads / UTM / official-page Messenger).
 * Isolated from merchant-customer social acquisition and affiliate referrer linking.
 */

import crypto from 'crypto';
import type { Pool, PoolClient } from 'pg';
import pool from '../database/connection.js';
import { logger } from '../utils/logger.js';
import { ensurePlatformFacebookTables } from './platformFacebookPage.js';

export type MerchantAcquisitionInput = {
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  content?: string | null;
  term?: string | null;
  adId?: string | null;
  ref?: string | null;
  /** Short code from official page conversation (?acq=) */
  acqCode?: string | null;
  landingPath?: string | null;
  fbclid?: string | null;
  gclid?: string | null;
  raw?: Record<string, unknown> | null;
};

const ACQ_CODE_PREFIX = 'XO';

let merchantColumnsEnsured = false;

export async function ensureMerchantAcquisitionColumns(
  db: Pool | PoolClient = pool
): Promise<void> {
  if (merchantColumnsEnsured && db === pool) return;

  await db.query(`
    ALTER TABLE merchants ADD COLUMN IF NOT EXISTS acquisition_source VARCHAR(64);
    ALTER TABLE merchants ADD COLUMN IF NOT EXISTS acquisition_medium VARCHAR(64);
    ALTER TABLE merchants ADD COLUMN IF NOT EXISTS acquisition_campaign VARCHAR(128);
    ALTER TABLE merchants ADD COLUMN IF NOT EXISTS acquisition_content VARCHAR(128);
    ALTER TABLE merchants ADD COLUMN IF NOT EXISTS acquisition_term VARCHAR(128);
    ALTER TABLE merchants ADD COLUMN IF NOT EXISTS acquisition_ad_id VARCHAR(128);
    ALTER TABLE merchants ADD COLUMN IF NOT EXISTS acquisition_ref VARCHAR(128);
    ALTER TABLE merchants ADD COLUMN IF NOT EXISTS acquisition_acq_code VARCHAR(32);
    ALTER TABLE merchants ADD COLUMN IF NOT EXISTS acquisition_landing_path TEXT;
    ALTER TABLE merchants ADD COLUMN IF NOT EXISTS acquisition_platform_conversation_id UUID;
    ALTER TABLE merchants ADD COLUMN IF NOT EXISTS acquisition_first_touch_at TIMESTAMP;
    ALTER TABLE merchants ADD COLUMN IF NOT EXISTS acquisition_raw JSONB NOT NULL DEFAULT '{}'::jsonb;
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_merchants_acquisition_campaign
      ON merchants(acquisition_campaign)
      WHERE acquisition_campaign IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_merchants_acquisition_source
      ON merchants(acquisition_source)
      WHERE acquisition_source IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_merchants_acquisition_acq_code
      ON merchants(acquisition_acq_code)
      WHERE acquisition_acq_code IS NOT NULL;
  `);

  if (db === pool) merchantColumnsEnsured = true;
}

export async function ensurePlatformConversationAcquisitionColumns(): Promise<void> {
  await ensurePlatformFacebookTables();
  await pool.query(`
    ALTER TABLE platform_conversations
      ADD COLUMN IF NOT EXISTS acq_code VARCHAR(32);
    ALTER TABLE platform_conversations
      ADD COLUMN IF NOT EXISTS attributed_merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL;
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_conversations_acq_code
      ON platform_conversations(acq_code)
      WHERE acq_code IS NOT NULL;
  `);
}

function cleanStr(v: unknown, max = 128): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().slice(0, max);
  return t || null;
}

/** Normalize client/body acquisition payload (UTM + acq + optional ads ids). */
export function normalizeAcquisitionInput(
  raw: Record<string, unknown> | null | undefined
): MerchantAcquisitionInput | null {
  if (!raw || typeof raw !== 'object') return null;

  const input: MerchantAcquisitionInput = {
    source: cleanStr(raw.utm_source ?? raw.source ?? raw.utmSource, 64),
    medium: cleanStr(raw.utm_medium ?? raw.medium ?? raw.utmMedium, 64),
    campaign: cleanStr(raw.utm_campaign ?? raw.campaign ?? raw.utmCampaign, 128),
    content: cleanStr(raw.utm_content ?? raw.content ?? raw.utmContent, 128),
    term: cleanStr(raw.utm_term ?? raw.term ?? raw.utmTerm, 128),
    adId: cleanStr(raw.ad_id ?? raw.adId, 128),
    ref: cleanStr(raw.ref ?? raw.referralCode, 128),
    acqCode: cleanStr(raw.acq ?? raw.acqCode ?? raw.acquisition_acq_code, 32)?.toUpperCase() || null,
    landingPath: cleanStr(raw.landing_path ?? raw.landingPath, 500),
    fbclid: cleanStr(raw.fbclid, 256),
    gclid: cleanStr(raw.gclid, 256),
    raw: raw as Record<string, unknown>,
  };

  const hasAny = Object.entries(input).some(([k, v]) => {
    if (k === 'raw') return false;
    return typeof v === 'string' && v.length > 0;
  });
  return hasAny ? input : null;
}

function generateAcqCode(): string {
  return `${ACQ_CODE_PREFIX}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

/**
 * Ensure a platform conversation has a stable short acq code for tracked signup links.
 */
export async function ensureConversationAcqCode(conversationId: string): Promise<string> {
  await ensurePlatformConversationAcquisitionColumns();

  const existing = await pool.query(
    `SELECT acq_code FROM platform_conversations WHERE id = $1 LIMIT 1`,
    [conversationId]
  );
  if (existing.rows[0]?.acq_code) {
    return String(existing.rows[0].acq_code);
  }

  for (let i = 0; i < 8; i++) {
    const code = generateAcqCode();
    try {
      const updated = await pool.query(
        `UPDATE platform_conversations
         SET acq_code = $2, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND acq_code IS NULL
         RETURNING acq_code`,
        [conversationId, code]
      );
      if (updated.rows[0]?.acq_code) return String(updated.rows[0].acq_code);
      const again = await pool.query(
        `SELECT acq_code FROM platform_conversations WHERE id = $1`,
        [conversationId]
      );
      if (again.rows[0]?.acq_code) return String(again.rows[0].acq_code);
    } catch {
      /* unique race — retry */
    }
  }
  throw new Error('Failed to allocate acquisition code');
}

export function buildTrackedSignupUrl(acqCode: string, baseUrl?: string): string {
  const base =
    (baseUrl || process.env.CORS_ORIGIN || process.env.FRONTEND_URL || 'https://xo-bot.com').replace(
      /\/+$/,
      ''
    );
  return `${base}/signup?acq=${encodeURIComponent(acqCode)}`;
}

/**
 * Merge ads/referral touch into platform conversation_state + ensure acq_code.
 */
export async function captureOfficialPageAcquisition(params: {
  conversationId: string;
  pageId: string;
  adId?: string | null;
  ref?: string | null;
  postId?: string | null;
  source?: string | null;
}): Promise<{ acqCode: string; signupUrl: string }> {
  await ensurePlatformConversationAcquisitionColumns();

  const acqCode = await ensureConversationAcqCode(params.conversationId);
  const touch = {
    source:
      params.source === 'ADS' || params.adId
        ? 'facebook_ad'
        : params.ref
          ? 'messenger_ref'
          : 'messenger',
    ad_id: params.adId || null,
    ref: params.ref || null,
    post_id: params.postId || null,
    meta_source: params.source || null,
    captured_at: new Date().toISOString(),
    page_id: params.pageId,
  };

  await pool.query(
    `UPDATE platform_conversations
     SET conversation_state = COALESCE(conversation_state, '{}'::jsonb)
       || jsonb_build_object('acquisition', COALESCE(conversation_state->'acquisition', '{}'::jsonb) || $2::jsonb),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [params.conversationId, JSON.stringify(touch)]
  );

  return { acqCode, signupUrl: buildTrackedSignupUrl(acqCode) };
}

type ResolvedFromAcq = {
  platformConversationId: string;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  adId: string | null;
  ref: string | null;
  postId: string | null;
};

async function resolveFromAcqCode(acqCode: string): Promise<ResolvedFromAcq | null> {
  await ensurePlatformConversationAcquisitionColumns();
  const code = acqCode.trim().toUpperCase();
  if (!code) return null;

  const result = await pool.query(
    `SELECT id, conversation_state
     FROM platform_conversations
     WHERE acq_code = $1
     LIMIT 1`,
    [code]
  );
  if (!result.rows[0]) return null;

  const state = result.rows[0].conversation_state || {};
  const acq = state.acquisition || {};
  return {
    platformConversationId: result.rows[0].id,
    source: typeof acq.source === 'string' ? acq.source : 'facebook_messenger',
    medium: 'messenger',
    campaign: typeof acq.ref === 'string' ? acq.ref : null,
    adId: typeof acq.ad_id === 'string' ? acq.ad_id : null,
    ref: typeof acq.ref === 'string' ? acq.ref : null,
    postId: typeof acq.post_id === 'string' ? acq.post_id : null,
  };
}

/**
 * Persist acquisition on a newly registered merchant (first-touch only).
 * Also attributes official-page conversation when acq code matches.
 */
export async function applyMerchantAcquisition(
  merchantId: string,
  input: MerchantAcquisitionInput | null | undefined
): Promise<void> {
  if (!input) return;
  await ensureMerchantAcquisitionColumns();

  let merged: MerchantAcquisitionInput = { ...input };
  let platformConversationId: string | null = null;

  if (merged.acqCode) {
    const fromAcq = await resolveFromAcqCode(merged.acqCode);
    if (fromAcq) {
      platformConversationId = fromAcq.platformConversationId;
      merged = {
        ...merged,
        source: merged.source || fromAcq.source,
        medium: merged.medium || fromAcq.medium,
        campaign: merged.campaign || fromAcq.campaign || fromAcq.ref,
        adId: merged.adId || fromAcq.adId,
        ref: merged.ref || fromAcq.ref,
      };
    }
  }

  // Infer source when only UTMs / fbclid present
  if (!merged.source) {
    if (merged.fbclid || merged.adId) merged.source = 'facebook_ad';
    else if (merged.gclid) merged.source = 'google_ad';
    else if (merged.campaign || merged.medium) merged.source = 'campaign';
    else if (merged.acqCode) merged.source = 'facebook_messenger';
  }

  const hasMarketing =
    merged.source ||
    merged.medium ||
    merged.campaign ||
    merged.adId ||
    merged.acqCode ||
    merged.fbclid ||
    merged.gclid ||
    merged.landingPath;

  if (!hasMarketing) return;

  await pool.query(
    `UPDATE merchants SET
       acquisition_source = COALESCE(acquisition_source, $2),
       acquisition_medium = COALESCE(acquisition_medium, $3),
       acquisition_campaign = COALESCE(acquisition_campaign, $4),
       acquisition_content = COALESCE(acquisition_content, $5),
       acquisition_term = COALESCE(acquisition_term, $6),
       acquisition_ad_id = COALESCE(acquisition_ad_id, $7),
       acquisition_ref = COALESCE(acquisition_ref, $8),
       acquisition_acq_code = COALESCE(acquisition_acq_code, $9),
       acquisition_landing_path = COALESCE(acquisition_landing_path, $10),
       acquisition_platform_conversation_id = COALESCE(acquisition_platform_conversation_id, $11::uuid),
       acquisition_first_touch_at = COALESCE(acquisition_first_touch_at, CURRENT_TIMESTAMP),
       acquisition_raw = COALESCE(acquisition_raw, '{}'::jsonb) || $12::jsonb,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [
      merchantId,
      merged.source || null,
      merged.medium || null,
      merged.campaign || null,
      merged.content || null,
      merged.term || null,
      merged.adId || null,
      merged.ref || null,
      merged.acqCode || null,
      merged.landingPath || null,
      platformConversationId,
      JSON.stringify({
        ...(merged.raw || {}),
        fbclid: merged.fbclid || undefined,
        gclid: merged.gclid || undefined,
        applied_at: new Date().toISOString(),
      }),
    ]
  );

  if (platformConversationId) {
    await pool.query(
      `UPDATE platform_conversations
       SET attributed_merchant_id = COALESCE(attributed_merchant_id, $2),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [platformConversationId, merchantId]
    );
  }

  logger.info('Merchant acquisition applied', {
    merchantId,
    source: merged.source,
    campaign: merged.campaign,
    acqCode: merged.acqCode,
    platformConversationId,
  });
}

/** Decode extended Google OAuth state { ref?, acquisition? }. */
export function acquisitionFromOAuthState(stateParam: unknown): MerchantAcquisitionInput | null {
  if (typeof stateParam !== 'string' || !stateParam.trim()) return null;
  try {
    const parsed = JSON.parse(Buffer.from(stateParam, 'base64url').toString('utf8')) as {
      ref?: string;
      acquisition?: Record<string, unknown>;
      acq?: string;
    };
    const fromNested = normalizeAcquisitionInput(parsed.acquisition || null);
    const acqCode =
      cleanStr(parsed.acq, 32)?.toUpperCase() ||
      fromNested?.acqCode ||
      null;
    const ref = cleanStr(parsed.ref, 128);
    if (!fromNested && !acqCode && !ref) return null;
    return {
      ...(fromNested || {}),
      ref: fromNested?.ref || ref,
      acqCode: acqCode || fromNested?.acqCode || null,
    };
  } catch {
    return null;
  }
}

export async function getAdminAcquisitionStats(): Promise<{
  totals: {
    withAcquisition: number;
    paidConverted: number;
    trialActive: number;
    last7Days: number;
    last30Days: number;
  };
  bySource: Array<{ key: string; signups: number; paid: number }>;
  byCampaign: Array<{ key: string; signups: number; paid: number }>;
  recent: Array<{
    id: string;
    name: string | null;
    email: string;
    plan: string;
    status: string | null;
    source: string | null;
    campaign: string | null;
    adId: string | null;
    acqCode: string | null;
    createdAt: string;
  }>;
}> {
  await ensureMerchantAcquisitionColumns();

  const paidPredicate = `subscription_plan IS NOT NULL
    AND subscription_plan NOT IN ('trial', 'expired', '')
    AND COALESCE(subscription_status, 'active') IN ('active', 'past_due')`;

  const totalsResult = await pool.query(`
    SELECT
      COUNT(*) FILTER (
        WHERE acquisition_source IS NOT NULL
           OR acquisition_campaign IS NOT NULL
           OR acquisition_acq_code IS NOT NULL
           OR acquisition_ad_id IS NOT NULL
      )::int AS with_acquisition,
      COUNT(*) FILTER (
        WHERE (acquisition_source IS NOT NULL OR acquisition_campaign IS NOT NULL OR acquisition_acq_code IS NOT NULL OR acquisition_ad_id IS NOT NULL)
          AND ${paidPredicate}
      )::int AS paid_converted,
      COUNT(*) FILTER (
        WHERE (acquisition_source IS NOT NULL OR acquisition_campaign IS NOT NULL OR acquisition_acq_code IS NOT NULL OR acquisition_ad_id IS NOT NULL)
          AND subscription_plan = 'trial'
      )::int AS trial_active,
      COUNT(*) FILTER (
        WHERE (acquisition_source IS NOT NULL OR acquisition_campaign IS NOT NULL OR acquisition_acq_code IS NOT NULL OR acquisition_ad_id IS NOT NULL)
          AND created_at > NOW() - INTERVAL '7 days'
      )::int AS last_7_days,
      COUNT(*) FILTER (
        WHERE (acquisition_source IS NOT NULL OR acquisition_campaign IS NOT NULL OR acquisition_acq_code IS NOT NULL OR acquisition_ad_id IS NOT NULL)
          AND created_at > NOW() - INTERVAL '30 days'
      )::int AS last_30_days
    FROM merchants
    WHERE COALESCE(role, 'user') = 'user'
  `);

  const bySource = await pool.query(`
    SELECT COALESCE(NULLIF(TRIM(acquisition_source), ''), '(غير محدد)') AS key,
           COUNT(*)::int AS signups,
           COUNT(*) FILTER (WHERE ${paidPredicate})::int AS paid
    FROM merchants
    WHERE COALESCE(role, 'user') = 'user'
      AND (acquisition_source IS NOT NULL OR acquisition_campaign IS NOT NULL OR acquisition_acq_code IS NOT NULL OR acquisition_ad_id IS NOT NULL)
    GROUP BY 1
    ORDER BY signups DESC
    LIMIT 20
  `);

  const byCampaign = await pool.query(`
    SELECT COALESCE(NULLIF(TRIM(acquisition_campaign), ''), '(بدون حملة)') AS key,
           COUNT(*)::int AS signups,
           COUNT(*) FILTER (WHERE ${paidPredicate})::int AS paid
    FROM merchants
    WHERE COALESCE(role, 'user') = 'user'
      AND (acquisition_source IS NOT NULL OR acquisition_campaign IS NOT NULL OR acquisition_acq_code IS NOT NULL OR acquisition_ad_id IS NOT NULL)
    GROUP BY 1
    ORDER BY signups DESC
    LIMIT 30
  `);

  const recent = await pool.query(`
    SELECT id, name, email, subscription_plan AS plan, subscription_status AS status,
           acquisition_source AS source, acquisition_campaign AS campaign,
           acquisition_ad_id AS ad_id, acquisition_acq_code AS acq_code, created_at
    FROM merchants
    WHERE COALESCE(role, 'user') = 'user'
      AND (acquisition_source IS NOT NULL OR acquisition_campaign IS NOT NULL OR acquisition_acq_code IS NOT NULL OR acquisition_ad_id IS NOT NULL)
    ORDER BY created_at DESC
    LIMIT 50
  `);

  const t = totalsResult.rows[0] || {};
  return {
    totals: {
      withAcquisition: t.with_acquisition || 0,
      paidConverted: t.paid_converted || 0,
      trialActive: t.trial_active || 0,
      last7Days: t.last_7_days || 0,
      last30Days: t.last_30_days || 0,
    },
    bySource: bySource.rows.map((r) => ({
      key: r.key,
      signups: r.signups,
      paid: r.paid,
    })),
    byCampaign: byCampaign.rows.map((r) => ({
      key: r.key,
      signups: r.signups,
      paid: r.paid,
    })),
    recent: recent.rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      plan: r.plan,
      status: r.status,
      source: r.source,
      campaign: r.campaign,
      adId: r.ad_id,
      acqCode: r.acq_code,
      createdAt: r.created_at,
    })),
  };
}

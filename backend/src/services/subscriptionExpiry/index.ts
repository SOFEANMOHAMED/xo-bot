/**
 * Subscription / trial expiry: set status → expired when period elapses.
 * Trials stay on plan `trial` (no auto-upgrade to paid).
 * Also used on-request so expiry is enforced even between scheduler ticks.
 * Owns merchants.subscription_starts_at / subscription_ends_at schema helpers and trial defaults.
 */
import pool from '../../database/connection.js';
import { logger } from '../../utils/logger.js';

/** Free trial length used at signup and when admin assigns a trial plan. */
export const DEFAULT_TRIAL_DAYS = 7;

const SCHEMA_READY_KEY = 'subscription_date_columns';
let schemaReady = false;

/** Ensures subscription_ends_at and subscription_starts_at exist on merchants. */
export async function ensureSubscriptionEndsAtColumn(): Promise<void> {
  if (schemaReady) return;
  await pool.query(`
    ALTER TABLE merchants
    ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMP
  `);
  await pool.query(`
    ALTER TABLE merchants
    ADD COLUMN IF NOT EXISTS subscription_starts_at TIMESTAMP
  `);
  schemaReady = true;
  logger.debug(`Ensured merchants.${SCHEMA_READY_KEY}`);
}

export type MerchantSubscriptionRow = {
  subscription_plan: string | null;
  subscription_status: string | null;
  trial_ends_at: Date | string | null;
  subscription_starts_at?: Date | string | null;
  subscription_ends_at: Date | string | null;
};

/** Parse a date input; empty/invalid → null. Throws on non-empty invalid strings. */
export function parseOptionalDate(
  value: unknown,
  fieldLabel: string
): Date | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date for ${fieldLabel}`);
  }
  return d;
}

/** Default trial end: fromDate + DEFAULT_TRIAL_DAYS. */
export function defaultTrialEndsAt(fromDate: Date = new Date()): Date {
  return new Date(fromDate.getTime() + DEFAULT_TRIAL_DAYS * 24 * 60 * 60 * 1000);
}

/** Extend an existing trial end (or now if past/missing) by the given days. */
export function extendTrialEndsAt(
  currentEndsAt: Date | string | null | undefined,
  days: number = DEFAULT_TRIAL_DAYS
): Date {
  const now = Date.now();
  let base = now;
  if (currentEndsAt) {
    const current = currentEndsAt instanceof Date ? currentEndsAt : new Date(currentEndsAt);
    if (!Number.isNaN(current.getTime()) && current.getTime() > now) {
      base = current.getTime();
    }
  }
  return new Date(base + days * 24 * 60 * 60 * 1000);
}

/**
 * Validate paid period range. Throws Error with Arabic message when invalid.
 * Null on either side is allowed (admin may clear one side).
 */
export function assertSubscriptionPeriodValid(
  startsAt: Date | null,
  endsAt: Date | null
): void {
  if (startsAt && endsAt && startsAt.getTime() > endsAt.getTime()) {
    throw new Error('تاريخ بداية الباقة يجب أن يكون قبل أو يساوي تاريخ النهاية');
  }
}

/**
 * When admin sets a paid end date in the future and status is expired, reactivate.
 * Suspended is left unchanged (manual suspend).
 */
export function resolveStatusAfterDateEdit(
  currentStatus: string | null | undefined,
  endsAt: Date | null,
  endsAtWasUpdated: boolean
): string | undefined {
  if (!endsAtWasUpdated || !endsAt) return undefined;
  const status = currentStatus || 'active';
  if (status === 'suspended') return undefined;
  if (endsAt.getTime() > Date.now() && status === 'expired') {
    return 'active';
  }
  if (endsAt.getTime() <= Date.now() && status === 'active') {
    return 'expired';
  }
  return undefined;
}

function isPast(dateValue: Date | string | null | undefined): boolean {
  if (!dateValue) return false;
  const d = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() <= Date.now();
}

/**
 * Mark a single merchant expired when:
 * - paid plan: subscription_ends_at has elapsed, OR
 * - trial plan: trial_ends_at has elapsed (plan stays `trial`, never auto-upgrades).
 */
export async function enforceMerchantSubscriptionExpiry(
  merchantId: string,
  row?: Partial<MerchantSubscriptionRow>
): Promise<{
  subscriptionStatus: string;
  didExpire: boolean;
  subscriptionEndsAt: Date | string | null;
}> {
  await ensureSubscriptionEndsAtColumn();

  let plan = row?.subscription_plan;
  let status = row?.subscription_status || 'active';
  let endsAt = row?.subscription_ends_at ?? null;
  let trialEndsAt = row?.trial_ends_at ?? null;

  if (plan === undefined || endsAt === undefined || trialEndsAt === undefined) {
    const result = await pool.query(
      `SELECT subscription_plan, subscription_status, subscription_ends_at, trial_ends_at
       FROM merchants WHERE id = $1`,
      [merchantId]
    );
    if (result.rows.length === 0) {
      return { subscriptionStatus: status, didExpire: false, subscriptionEndsAt: null };
    }
    plan = result.rows[0].subscription_plan;
    status = result.rows[0].subscription_status || 'active';
    endsAt = result.rows[0].subscription_ends_at;
    trialEndsAt = result.rows[0].trial_ends_at;
  }

  // Agency management accounts never auto-expire
  if (plan === 'agency') {
    return { subscriptionStatus: status || 'active', didExpire: false, subscriptionEndsAt: null };
  }

  if (status === 'expired' || status === 'suspended') {
    return { subscriptionStatus: status, didExpire: false, subscriptionEndsAt: endsAt };
  }

  // Trial: expire in place — keep plan = trial (no paid transition)
  if (plan === 'trial' && trialEndsAt && isPast(trialEndsAt)) {
    const update = await pool.query(
      `UPDATE merchants
       SET subscription_status = 'expired',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
         AND COALESCE(subscription_status, 'active') = 'active'
         AND COALESCE(subscription_plan, 'trial') = 'trial'
         AND trial_ends_at IS NOT NULL
         AND trial_ends_at <= CURRENT_TIMESTAMP
       RETURNING subscription_status`,
      [merchantId]
    );

    if (update.rows.length > 0) {
      logger.info('Merchant trial auto-expired', { merchantId, trialEndsAt });
    }
    return { subscriptionStatus: 'expired', didExpire: update.rows.length > 0, subscriptionEndsAt: endsAt };
  }

  // Paid plans with an end date
  if (!plan || plan === 'trial' || !endsAt || !isPast(endsAt)) {
    return { subscriptionStatus: status, didExpire: false, subscriptionEndsAt: endsAt };
  }

  const update = await pool.query(
    `UPDATE merchants
     SET subscription_status = 'expired',
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
       AND COALESCE(subscription_status, 'active') = 'active'
       AND subscription_plan IS NOT NULL
       AND subscription_plan <> 'trial'
       AND subscription_plan <> 'agency'
       AND subscription_ends_at IS NOT NULL
       AND subscription_ends_at <= CURRENT_TIMESTAMP
     RETURNING subscription_status, subscription_ends_at`,
    [merchantId]
  );

  if (update.rows.length > 0) {
    logger.info('Merchant subscription auto-expired', {
      merchantId,
      plan,
      subscriptionEndsAt: update.rows[0].subscription_ends_at
    });
    return {
      subscriptionStatus: 'expired',
      didExpire: true,
      subscriptionEndsAt: update.rows[0].subscription_ends_at
    };
  }

  return { subscriptionStatus: status, didExpire: false, subscriptionEndsAt: endsAt };
}

/**
 * Bulk expire due paid subscriptions and ended free trials (scheduler).
 * Trials stay on plan `trial` with status `expired` — never auto-upgrade to paid.
 */
export async function expireDueSubscriptions(): Promise<number> {
  await ensureSubscriptionEndsAtColumn();

  const paid = await pool.query(
    `UPDATE merchants
     SET subscription_status = 'expired',
         updated_at = CURRENT_TIMESTAMP
     WHERE COALESCE(subscription_status, 'active') = 'active'
       AND subscription_plan IS NOT NULL
       AND subscription_plan <> 'trial'
       AND subscription_plan <> 'agency'
       AND subscription_ends_at IS NOT NULL
       AND subscription_ends_at <= CURRENT_TIMESTAMP
     RETURNING id`
  );

  const trials = await pool.query(
    `UPDATE merchants
     SET subscription_status = 'expired',
         updated_at = CURRENT_TIMESTAMP
     WHERE COALESCE(subscription_status, 'active') = 'active'
       AND COALESCE(subscription_plan, 'trial') = 'trial'
       AND trial_ends_at IS NOT NULL
       AND trial_ends_at <= CURRENT_TIMESTAMP
     RETURNING id`
  );

  const paidCount = paid.rowCount ?? paid.rows.length;
  const trialCount = trials.rowCount ?? trials.rows.length;

  if (paidCount > 0) {
    logger.info(`Auto-expired ${paidCount} paid subscription(s)`, {
      merchantIds: paid.rows.map((r: { id: string }) => r.id)
    });
  }
  if (trialCount > 0) {
    logger.info(`Auto-expired ${trialCount} trial account(s)`, {
      merchantIds: trials.rows.map((r: { id: string }) => r.id)
    });
  }
  return paidCount + trialCount;
}

let schedulerInterval: NodeJS.Timeout | null = null;
let cycleInFlight = false;

async function safeCycle(): Promise<void> {
  if (cycleInFlight) {
    logger.debug('Subscription expiry cycle skipped — previous still running');
    return;
  }
  cycleInFlight = true;
  try {
    await expireDueSubscriptions();
  } catch (error) {
    logger.error('Subscription expiry cycle error', error as Error);
  } finally {
    cycleInFlight = false;
  }
}

/** Runs every N minutes; also fires once shortly after boot. */
export function startSubscriptionExpiryScheduler(intervalMinutes: number = 15): void {
  if (schedulerInterval) {
    logger.warn('Subscription expiry scheduler already running');
    return;
  }

  const mins = Math.max(5, intervalMinutes);
  logger.info(`Starting subscription expiry scheduler (${mins} min interval)`);

  // Ensure schema before first cycle (and before auth paths race)
  void ensureSubscriptionEndsAtColumn().catch((error) => {
    logger.error('Failed to ensure subscription_ends_at column', error as Error);
  });

  setTimeout(() => {
    safeCycle().catch(() => undefined);
  }, 30_000);

  schedulerInterval = setInterval(safeCycle, mins * 60 * 1000);
}

export function stopSubscriptionExpiryScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    logger.info('Subscription expiry scheduler stopped');
  }
}

/**
 * Paid-subscription expiry: auto-suspend (status → expired) when subscription_ends_at elapses.
 * Also used on-request so expiry is enforced even between scheduler ticks.
 */
import pool from '../../database/connection.js';
import { logger } from '../../utils/logger.js';

const SCHEMA_READY_KEY = 'subscription_ends_at_column';
let schemaReady = false;

export async function ensureSubscriptionEndsAtColumn(): Promise<void> {
  if (schemaReady) return;
  await pool.query(`
    ALTER TABLE merchants
    ADD COLUMN IF NOT EXISTS subscription_ends_at TIMESTAMP
  `);
  schemaReady = true;
  logger.debug(`Ensured merchants.${SCHEMA_READY_KEY}`);
}

export type MerchantSubscriptionRow = {
  subscription_plan: string | null;
  subscription_status: string | null;
  trial_ends_at: Date | string | null;
  subscription_ends_at: Date | string | null;
};

function isPast(dateValue: Date | string | null | undefined): boolean {
  if (!dateValue) return false;
  const d = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() <= Date.now();
}

/**
 * Mark a single merchant expired when their paid period has ended.
 * Returns the effective status after enforcement.
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

  if (plan === undefined || endsAt === undefined) {
    const result = await pool.query(
      `SELECT subscription_plan, subscription_status, subscription_ends_at
       FROM merchants WHERE id = $1`,
      [merchantId]
    );
    if (result.rows.length === 0) {
      return { subscriptionStatus: status, didExpire: false, subscriptionEndsAt: null };
    }
    plan = result.rows[0].subscription_plan;
    status = result.rows[0].subscription_status || 'active';
    endsAt = result.rows[0].subscription_ends_at;
  }

  if (status === 'expired' || status === 'suspended') {
    return { subscriptionStatus: status, didExpire: false, subscriptionEndsAt: endsAt };
  }

  // Only paid (non-trial) plans with an end date are auto-expired
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
 * Bulk expire all due paid subscriptions (scheduler).
 */
export async function expireDueSubscriptions(): Promise<number> {
  await ensureSubscriptionEndsAtColumn();

  const result = await pool.query(
    `UPDATE merchants
     SET subscription_status = 'expired',
         updated_at = CURRENT_TIMESTAMP
     WHERE COALESCE(subscription_status, 'active') = 'active'
       AND subscription_plan IS NOT NULL
       AND subscription_plan <> 'trial'
       AND subscription_ends_at IS NOT NULL
       AND subscription_ends_at <= CURRENT_TIMESTAMP
     RETURNING id`
  );

  const count = result.rowCount ?? result.rows.length;
  if (count > 0) {
    logger.info(`Auto-expired ${count} paid subscription(s)`, {
      merchantIds: result.rows.map((r: { id: string }) => r.id)
    });
  }
  return count;
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

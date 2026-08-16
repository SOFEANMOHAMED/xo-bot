/**
 * Merchant lifecycle emails: welcome tracking + delayed onboarding / trial nudges.
 */

import pool from '../../database/connection.js';
import { logger } from '../../utils/logger.js';
import {
  sendDay3EngagementEmail,
  sendDay6TrialEndingEmail,
  sendOnboardingStepsEmail,
  sendTrialEndedEmail,
  sendWelcomeEmail,
} from '../../utils/emailService.js';

export const LIFECYCLE_EMAIL_TYPES = {
  welcome: 'welcome',
  onboarding_steps: 'onboarding_steps',
  day3_engagement: 'day3_engagement',
  day6_trial_ending: 'day6_trial_ending',
  trial_ended: 'trial_ended',
} as const;

export type LifecycleEmailType =
  (typeof LIFECYCLE_EMAIL_TYPES)[keyof typeof LIFECYCLE_EMAIL_TYPES];

let tableReady = false;

export async function ensureLifecycleEmailsTable(): Promise<void> {
  if (tableReady) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS merchant_lifecycle_emails (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
      email_type VARCHAR(50) NOT NULL,
      sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (merchant_id, email_type)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_merchant_lifecycle_emails_type_sent
      ON merchant_lifecycle_emails (email_type, sent_at DESC)
  `);
  tableReady = true;
}

/**
 * Atomically claim a send slot. Returns false if already sent / claimed.
 */
export async function claimLifecycleEmail(
  merchantId: string,
  emailType: LifecycleEmailType
): Promise<boolean> {
  await ensureLifecycleEmailsTable();
  const result = await pool.query(
    `INSERT INTO merchant_lifecycle_emails (merchant_id, email_type)
     VALUES ($1, $2)
     ON CONFLICT (merchant_id, email_type) DO NOTHING
     RETURNING id`,
    [merchantId, emailType]
  );
  return (result.rowCount ?? 0) > 0;
}

async function releaseLifecycleClaim(
  merchantId: string,
  emailType: LifecycleEmailType
): Promise<void> {
  try {
    await pool.query(
      `DELETE FROM merchant_lifecycle_emails
       WHERE merchant_id = $1 AND email_type = $2`,
      [merchantId, emailType]
    );
  } catch (error) {
    logger.warn('Failed to release lifecycle email claim', {
      merchantId,
      emailType,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

type MerchantRow = {
  id: string;
  email: string;
  name: string | null;
  trial_ends_at: Date | null;
};

/**
 * Send welcome + mark as sent (email signup or Google OAuth).
 */
export async function sendAndTrackWelcomeEmail(
  merchantId: string,
  email: string,
  name?: string | null
): Promise<void> {
  try {
    const claimed = await claimLifecycleEmail(merchantId, LIFECYCLE_EMAIL_TYPES.welcome);
    if (!claimed) {
      logger.info('Welcome email already tracked — skip', { merchantId });
      return;
    }

    const ok = await sendWelcomeEmail(email, name);
    if (!ok) {
      await releaseLifecycleClaim(merchantId, LIFECYCLE_EMAIL_TYPES.welcome);
    }
  } catch (error) {
    logger.error('sendAndTrackWelcomeEmail failed', error as Error, { merchantId });
  }
}

async function sendClaimed(
  merchant: MerchantRow,
  emailType: LifecycleEmailType,
  sendFn: () => Promise<boolean>
): Promise<boolean> {
  const claimed = await claimLifecycleEmail(merchant.id, emailType);
  if (!claimed) return false;

  const ok = await sendFn();
  if (!ok) {
    await releaseLifecycleClaim(merchant.id, emailType);
    return false;
  }
  return true;
}

const baseMerchantFilter = `
  m.email IS NOT NULL
  AND TRIM(m.email) <> ''
  AND (m.role IS NULL OR m.role = 'user')
`;

const stillOnTrialFilter = `
  (
    COALESCE(m.subscription_plan, 'trial') = 'trial'
    OR (
      m.trial_ends_at IS NOT NULL
      AND m.trial_ends_at > NOW()
      AND COALESCE(m.subscription_plan, 'trial') NOT IN ('comments','single','social','yearly','starter','pro','business')
    )
  )
`;

async function processOnboardingSteps(): Promise<number> {
  const result = await pool.query(
    `SELECT m.id, m.email, m.name, m.trial_ends_at
     FROM merchants m
     WHERE ${baseMerchantFilter}
       AND m.created_at <= NOW() - INTERVAL '1 hour'
       AND m.created_at >= NOW() - INTERVAL '8 days'
       AND NOT EXISTS (
         SELECT 1 FROM merchant_lifecycle_emails e
         WHERE e.merchant_id = m.id AND e.email_type = $1
       )
     ORDER BY m.created_at ASC
     LIMIT 50`,
    [LIFECYCLE_EMAIL_TYPES.onboarding_steps]
  );

  let sent = 0;
  for (const row of result.rows as MerchantRow[]) {
    const ok = await sendClaimed(row, LIFECYCLE_EMAIL_TYPES.onboarding_steps, () =>
      sendOnboardingStepsEmail(row.email, row.name)
    );
    if (ok) sent += 1;
  }
  return sent;
}

async function processDay3(): Promise<number> {
  const result = await pool.query(
    `SELECT m.id, m.email, m.name, m.trial_ends_at
     FROM merchants m
     WHERE ${baseMerchantFilter}
       AND m.created_at <= NOW() - INTERVAL '3 days'
       AND m.created_at >= NOW() - INTERVAL '8 days'
       AND NOT EXISTS (
         SELECT 1 FROM merchant_lifecycle_emails e
         WHERE e.merchant_id = m.id AND e.email_type = $1
       )
     ORDER BY m.created_at ASC
     LIMIT 50`,
    [LIFECYCLE_EMAIL_TYPES.day3_engagement]
  );

  let sent = 0;
  for (const row of result.rows as MerchantRow[]) {
    const ok = await sendClaimed(row, LIFECYCLE_EMAIL_TYPES.day3_engagement, () =>
      sendDay3EngagementEmail(row.email, row.name)
    );
    if (ok) sent += 1;
  }
  return sent;
}

async function processDay6(): Promise<number> {
  const result = await pool.query(
    `SELECT m.id, m.email, m.name, m.trial_ends_at
     FROM merchants m
     WHERE ${baseMerchantFilter}
       AND ${stillOnTrialFilter}
       AND m.created_at <= NOW() - INTERVAL '6 days'
       AND m.created_at >= NOW() - INTERVAL '10 days'
       AND (m.trial_ends_at IS NULL OR m.trial_ends_at > NOW())
       AND NOT EXISTS (
         SELECT 1 FROM merchant_lifecycle_emails e
         WHERE e.merchant_id = m.id AND e.email_type = $1
       )
     ORDER BY m.created_at ASC
     LIMIT 50`,
    [LIFECYCLE_EMAIL_TYPES.day6_trial_ending]
  );

  let sent = 0;
  for (const row of result.rows as MerchantRow[]) {
    const ok = await sendClaimed(row, LIFECYCLE_EMAIL_TYPES.day6_trial_ending, () =>
      sendDay6TrialEndingEmail(row.email, row.name, row.trial_ends_at)
    );
    if (ok) sent += 1;
  }
  return sent;
}

async function processTrialEnded(): Promise<number> {
  const result = await pool.query(
    `SELECT m.id, m.email, m.name, m.trial_ends_at
     FROM merchants m
     WHERE ${baseMerchantFilter}
       AND m.trial_ends_at IS NOT NULL
       AND m.trial_ends_at <= NOW()
       AND m.trial_ends_at >= NOW() - INTERVAL '7 days'
       AND COALESCE(m.subscription_plan, 'trial') = 'trial'
       AND NOT EXISTS (
         SELECT 1 FROM merchant_lifecycle_emails e
         WHERE e.merchant_id = m.id AND e.email_type = $1
       )
     ORDER BY m.trial_ends_at ASC
     LIMIT 50`,
    [LIFECYCLE_EMAIL_TYPES.trial_ended]
  );

  let sent = 0;
  for (const row of result.rows as MerchantRow[]) {
    const ok = await sendClaimed(row, LIFECYCLE_EMAIL_TYPES.trial_ended, () =>
      sendTrialEndedEmail(row.email, row.name)
    );
    if (ok) sent += 1;
  }
  return sent;
}

export async function runLifecycleEmailsCycle(): Promise<void> {
  await ensureLifecycleEmailsTable();

  const [onboarding, day3, day6, trialEnded] = await Promise.all([
    processOnboardingSteps(),
    processDay3(),
    processDay6(),
    processTrialEnded(),
  ]);

  if (onboarding + day3 + day6 + trialEnded > 0) {
    logger.info('Lifecycle emails cycle completed', {
      onboarding,
      day3,
      day6,
      trialEnded,
    });
  }
}

let schedulerInterval: NodeJS.Timeout | null = null;
let cycleInFlight = false;

async function safeCycle(): Promise<void> {
  if (cycleInFlight) {
    logger.debug('Lifecycle emails cycle skipped — previous still running');
    return;
  }
  cycleInFlight = true;
  try {
    await runLifecycleEmailsCycle();
  } catch (error) {
    logger.error('Lifecycle emails cycle error', error as Error);
  } finally {
    cycleInFlight = false;
  }
}

export function startLifecycleEmailsScheduler(intervalMinutes: number = 15): void {
  if (schedulerInterval) {
    logger.warn('Lifecycle emails scheduler already running');
    return;
  }

  const mins = Math.max(5, intervalMinutes);
  logger.info(`Starting lifecycle emails scheduler (${mins} min interval)`);

  setTimeout(() => {
    safeCycle().catch(() => undefined);
  }, 45_000);

  schedulerInterval = setInterval(safeCycle, mins * 60 * 1000);
}

export function stopLifecycleEmailsScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    logger.info('Lifecycle emails scheduler stopped');
  }
}

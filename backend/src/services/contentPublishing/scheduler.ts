/**
 * Content publishing scheduler — claims due scheduled posts and publishes them.
 */

import { logger } from '../../utils/logger.js';
import {
  CONTENT_SCHEDULER_BATCH_SIZE,
  CONTENT_SCHEDULER_INTERVAL_MINUTES
} from './constants.js';
import { executePublication } from './publisher.js';
import { claimDuePublications } from './repository.js';

let schedulerInterval: NodeJS.Timeout | null = null;
let cycleInFlight = false;

async function processClaimed(
  items: Array<{ id: string; merchant_id: string }>
): Promise<void> {
  for (const item of items) {
    try {
      await executePublication({
        merchantId: item.merchant_id,
        publicationId: item.id,
        alreadyClaimed: true
      });
    } catch (error) {
      logger.error('Scheduled content publication failed', error as Error, {
        merchantId: item.merchant_id,
        publicationId: item.id
      });
    }
  }
}

async function safeCycle(): Promise<void> {
  if (cycleInFlight) {
    logger.debug('Content publishing cycle skipped — previous still running');
    return;
  }
  cycleInFlight = true;
  try {
    const claimed = await claimDuePublications(CONTENT_SCHEDULER_BATCH_SIZE);
    if (claimed.length) {
      logger.info(`Content publishing scheduler claimed ${claimed.length} publication(s)`);
      await processClaimed(claimed);
    }
  } catch (error) {
    logger.error('Content publishing cycle error', error as Error);
  } finally {
    cycleInFlight = false;
  }
}

export function startContentPublishingScheduler(
  intervalMinutes: number = CONTENT_SCHEDULER_INTERVAL_MINUTES
): void {
  if (schedulerInterval) {
    logger.warn('Content publishing scheduler already running');
    return;
  }

  const mins = Math.max(1, intervalMinutes);
  logger.info(`Starting content publishing scheduler (${mins} min interval)`);

  setTimeout(() => {
    safeCycle().catch(() => undefined);
  }, 20_000);

  schedulerInterval = setInterval(safeCycle, mins * 60 * 1000);
}

export function stopContentPublishingScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    logger.info('Content publishing scheduler stopped');
  }
}

export function isContentPublishingSchedulerRunning(): boolean {
  return schedulerInterval !== null;
}

/** Exposed for tests / manual ops */
export async function runContentPublishingCycle(): Promise<void> {
  await safeCycle();
}

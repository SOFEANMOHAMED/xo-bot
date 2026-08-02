/**
 * Abandoned checkout reminder — public API + scheduler
 */

import { logger } from '../../utils/logger.js';
import { SCHEDULER_INTERVAL_MINUTES } from './constants.js';
import { runAbandonedCheckoutCycle } from './processor.js';

export { buildAbandonedReminderMessage } from './messageBuilder.js';
export { clearAbandonedCheckoutFromState } from './finder.js';
export { runAbandonedCheckoutCycle } from './processor.js';
export {
  ABANDONED_CHECKOUT_SOURCE,
  DEFAULT_REMINDER_DELAY_MINUTES,
  MAX_REMINDERS_PER_CHECKOUT,
  MESSAGING_WINDOW_HOURS,
} from './constants.js';

let schedulerInterval: NodeJS.Timeout | null = null;
let cycleInFlight = false;

async function safeCycle(): Promise<void> {
  if (cycleInFlight) {
    logger.debug('Abandoned checkout cycle skipped — previous still running');
    return;
  }
  cycleInFlight = true;
  try {
    await runAbandonedCheckoutCycle();
  } catch (error) {
    logger.error('Abandoned checkout cycle error', error as Error);
  } finally {
    cycleInFlight = false;
  }
}

export function startAbandonedCheckoutScheduler(
  intervalMinutes: number = SCHEDULER_INTERVAL_MINUTES
): void {
  if (schedulerInterval) {
    logger.warn('Abandoned checkout scheduler already running');
    return;
  }

  const mins = Math.max(1, intervalMinutes);
  logger.info(`Starting abandoned checkout scheduler (${mins} min interval)`);

  setTimeout(() => {
    safeCycle().catch(() => undefined);
  }, 30_000);

  schedulerInterval = setInterval(safeCycle, mins * 60 * 1000);
}

export function stopAbandonedCheckoutScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    logger.info('Abandoned checkout scheduler stopped');
  }
}

export function isAbandonedCheckoutSchedulerRunning(): boolean {
  return schedulerInterval !== null;
}

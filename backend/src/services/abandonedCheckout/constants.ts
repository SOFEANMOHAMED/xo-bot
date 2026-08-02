/** Abandoned checkout recovery — shared constants */

export const ABANDONED_CHECKOUT_SOURCE = 'abandoned_reminder' as const;

/** Platforms that support proactive bot follow-up */
export const ABANDONED_CHECKOUT_PLATFORMS = [
  'facebook_messenger',
  'telegram',
  'whatsapp',
  'instagram',
] as const;

export type AbandonedCheckoutPlatform = (typeof ABANDONED_CHECKOUT_PLATFORMS)[number];

/** SalesGPT stages considered mid-checkout / close */
export const CHECKOUT_STAGE_IDS = ['6', '7', '8'] as const;

/** Default silence before first reminder (minutes) */
export const DEFAULT_REMINDER_DELAY_MINUTES = 45;

/** Keep a 1h safety margin inside Meta's 24h messaging window */
export const MESSAGING_WINDOW_HOURS = 23;

/** MVP: one gentle nudge per checkout attempt */
export const MAX_REMINDERS_PER_CHECKOUT = 1;

/** Job poll interval */
export const SCHEDULER_INTERVAL_MINUTES = 5;

/** Cap per cycle to avoid burst sends */
export const MAX_REMINDERS_PER_CYCLE = 50;

export const DEFAULT_REMINDER_TEMPLATE_AR =
  'أهلاً {name}، لاحظت أن طلبك{product_clause} لم يُؤكَّد بعد.\n' +
  'هل ما زلت راغباً في إتمامه؟ اكتب «نعم» للتأكيد، أو أخبرني إن احتجت أي تعديل.';

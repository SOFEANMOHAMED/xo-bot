/**
 * INTERIM — detect customer disputes about a prior bot claim.
 *
 * WHY: «أنت قلت في أسود» was treated as a color answer / order turn and forced
 * `collect_info` name («تمام، شو اسمك الكامل؟») — PHASE 2F baseline soft fail.
 * These utterances are product Q&A, not identity or bare variant answers.
 */
export const PAST_BOT_CLAIM_DISPUTE_TEST_CASES: ReadonlyArray<{
  phrase: string;
  isDispute: boolean;
  note: string;
}> = Object.freeze([
  { phrase: 'أنت قلت في أسود', isDispute: true, note: 'you said black exists' },
  { phrase: 'انت قلت في أسود', isDispute: true, note: 'unhamza أنت' },
  { phrase: 'ما قلت إن في أحمر؟', isDispute: true, note: 'did you not say red' },
  { phrase: 'قلت لي متوفر بالأسود', isDispute: true, note: 'you told me available' },
  { phrase: 'you said it comes in black', isDispute: true, note: 'english' },
  { phrase: 'أسود', isDispute: false, note: 'bare color selection' },
  { phrase: 'بدي الأسود', isDispute: false, note: 'order color choice' },
  { phrase: 'سفيان محمد', isDispute: false, note: 'identity name' },
]);

/**
 * True when the customer is referring to / disputing what the bot previously said,
 * not answering a pending color/size/identity question.
 */
export function isPastBotClaimDispute(messageText: string): boolean {
  if (!messageText?.trim()) return false;
  const t = messageText.trim();
  if (
    /(?:أنت|انت|انتي)\s*قلت/.test(t) ||
    /قلت\s*(?:لي|لنا|إن|ان|في|إنه|انه)/.test(t) ||
    /ما\s*قلت/.test(t) ||
    /كنت\s*قلت/.test(t)
  ) {
    return true;
  }
  if (/\byou\s+said\b/i.test(t) || /\byou\s+told\s+me\b/i.test(t)) {
    return true;
  }
  return false;
}

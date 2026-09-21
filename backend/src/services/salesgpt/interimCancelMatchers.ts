/**
 * INTERIM — verb matchers for whole-order cancel vs remove-one-line.
 *
 * WHY this exists: the LLM interpreter that should own cancel/remove intent
 * is not restored yet. Keep this module tiny and replace it wholesale later.
 * Do NOT grow it into product-name understanding — line targeting uses cart
 * line names/variants only (see matchCartLinesForRemoval).
 */
import { normalizeArabic } from '../../catalog/product-search.js';

export type InterimCancelKind = 'whole_cancel' | 'partial_remove' | 'none';

/** Documented phrases the interim matcher must classify (unit-tested). */
export const INTERIM_CANCEL_TEST_CASES: ReadonlyArray<{
  phrase: string;
  kind: InterimCancelKind;
  note: string;
}> = Object.freeze([
  { phrase: 'ألغي الطلب كله', kind: 'whole_cancel', note: 'explicit whole order' },
  { phrase: 'خلص ألغي كل شي', kind: 'whole_cancel', note: 'cancel everything' },
  { phrase: 'إلغاء الطلب', kind: 'whole_cancel', note: 'cancel the order' },
  { phrase: 'خلص ألغي', kind: 'whole_cancel', note: 'bare cancel after خلص' },
  { phrase: 'الغي', kind: 'whole_cancel', note: 'bare cancel verb' },
  { phrase: 'خلص بدي الغي القميص', kind: 'partial_remove', note: 'remove named line' },
  { phrase: 'شيل القميص', kind: 'partial_remove', note: 'شيل + line' },
  { phrase: 'بلاش القميص', kind: 'partial_remove', note: 'بلاش + line' },
  { phrase: 'احذف القميص', kind: 'partial_remove', note: 'احذف + line' },
  { phrase: 'الغي الموبايل', kind: 'partial_remove', note: 'remove verb + target (may be absent)' },
  { phrase: 'لا شكراً بس بدي الأزرق', kind: 'none', note: 'keep current non-cancel behavior' },
  { phrase: 'بعدين بخبرك', kind: 'none', note: 'defer — not cancel' },
  { phrase: 'لا ما بدي اسود بدي احمر', kind: 'none', note: 'variant correction, not cancel' },
]);

/** «ألغي الطلب كله» / «إلغاء الطلب» / bare «الغي». */
export function isInterimWholeOrderCancel(messageText: string): boolean {
  if (!messageText?.trim()) return false;
  const n = normalizeArabic(messageText);
  if (
    /(الطلب\s*كله|كل\s*(ال)?طلب|الطلب\s*كامل|كل\s*شي|كل\s*شيء|whole\s+order|entire\s+order)/i.test(
      n
    ) ||
    /cancel\s*(the\s+)?(whole|entire|full)\s+order/i.test(messageText)
  ) {
    return true;
  }
  // Bare cancel with no other content beyond fillers.
  if (
    /^(خلص|يلا|طيب|تمام)?\s*(بدي|ابي|ابغى)?\s*(الغي|الغاء|الغ|cancel)\s*$/i.test(n)
  ) {
    return true;
  }
  if (/(الغ|الغي|الغاء)\s*(الطلب|طلبي|اوردر|الاوردر)\s*$/i.test(n)) {
    return true;
  }
  return false;
}

/**
 * Remove-verb present and not a whole-order cancel.
 * Verbs (documented interim set): الغي / شيل / بلاش / احذف (+ cancel/remove).
 */
export function isInterimPartialRemoveVerb(messageText: string): boolean {
  if (!messageText?.trim()) return false;
  if (isInterimWholeOrderCancel(messageText)) return false;
  const n = normalizeArabic(messageText);
  // Variant correction («لا … بدي أحمر») is not a line remove.
  if (looksLikeVariantCorrection(n, messageText)) return false;

  const hasVerb =
    /(الغي|الغاء|شيل|بلاش|احذف|remove)/i.test(n) || /cancel/i.test(messageText);
  if (!hasVerb) return false;

  // Bare cancel already handled as whole — if we reach here with only verb, treat whole.
  if (/^(خلص|يلا|طيب|تمام)?\s*(بدي|ابي|ابغى)?\s*(الغي|الغاء|cancel)\s*$/i.test(n)) {
    return false;
  }
  return true;
}

function looksLikeVariantCorrection(normalized: string, raw: string): boolean {
  const hasColorOrSize =
    /(لون|مقاس|اسود|أسود|احمر|أحمر|ازرق|أزرق|ابيض|أبيض|اخضر|أخضر|red|black|white|blue|green|size|color)/i.test(
      normalized
    ) ||
    /(لون|مقاس|color|size)/i.test(raw);
  if (!hasColorOrSize) return false;
  if (/^(لا|لأ|مو|مش)\b/.test(normalized)) return true;
  if (/(غير|بدل|حول)\s*(ال)?(لون|مقاس|اللون|المقاس)/.test(normalized)) return true;
  return false;
}

export function classifyInterimCancelIntent(messageText: string): InterimCancelKind {
  if (!messageText?.trim()) return 'none';
  if (looksLikeVariantCorrection(normalizeArabic(messageText), messageText)) {
    return 'none';
  }
  if (isInterimWholeOrderCancel(messageText)) return 'whole_cancel';
  if (isInterimPartialRemoveVerb(messageText)) return 'partial_remove';
  return 'none';
}

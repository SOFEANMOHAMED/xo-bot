/**
 * INTERIM — verb matchers for whole-order cancel vs remove-one-line,
 * plus variant-correction / negation detection used by resolveVariantChange.
 *
 * WHY this exists: the LLM interpreter that should own cancel/remove/variant
 * intent is not restored yet. Keep this module tiny and replace it wholesale
 * later. Do NOT grow it into product-name understanding — line targeting uses
 * cart line names/variants only (see matchCartLinesForRemoval).
 *
 * Color negation against a product's catalog options lives in orderColorPolicy
 * (`isCatalogColorNegated` / `resolveWantedCatalogColor`); this module only
 * decides WHETHER the utterance is a correction vs cancel/remove.
 */
import { normalizeArabic } from '../../catalog/product-search.js';

export type InterimCancelKind = 'whole_cancel' | 'partial_remove' | 'none';

/** Color / size lexemes used to spot variant corrections (INTERIM). */
const VARIANT_OPTION_PATTERN =
  /(?:احمر|أحمر|أسود|اسود|ابيض|أبيض|ازرق|أزرق|اخضر|أخضر|اصفر|بني|رمادي|وردي|ذهبي|فضي|بيج|كحلي|لون|مقاس|red|black|white|blue|green|yellow|brown|pink|gold|silver|navy|beige|color|size|\b(?:xs|s|m|l|xl|xxl)\b)/i;

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

/** Documented variant-correction phrases (INTERIM — unit-tested). */
export const INTERIM_VARIANT_CORRECTION_TEST_CASES: ReadonlyArray<{
  phrase: string;
  isCorrection: boolean;
  note: string;
}> = Object.freeze([
  { phrase: 'لا ما بدي اسود بدي احمر', isCorrection: true, note: 'negation + positive color' },
  { phrase: 'مو الأسود، الأحمر', isCorrection: true, note: 'مو + alternative' },
  { phrase: 'غيّر اللون للأحمر', isCorrection: true, note: 'change color verb' },
  { phrase: 'خليه أحمر', isCorrection: true, note: 'خليه + color' },
  { phrase: 'الأسود', isCorrection: false, note: 'bare selection is not a correction' },
  { phrase: 'الغي القميص', isCorrection: false, note: 'line remove is not a correction' },
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
  if (isInterimVariantCorrectionIntent(messageText)) return false;

  const hasVerb =
    /(الغي|الغاء|شيل|بلاش|احذف|remove)/i.test(n) || /cancel/i.test(messageText);
  if (!hasVerb) return false;

  // Bare cancel already handled as whole — if we reach here with only verb, treat whole.
  if (/^(خلص|يلا|طيب|تمام)?\s*(بدي|ابي|ابغى)?\s*(الغي|الغاء|cancel)\s*$/i.test(n)) {
    return false;
  }
  return true;
}

/**
 * Customer is rejecting the current option and asking for another color/size
 * («لا ما بدي اسود بدي احمر»), not cancelling the order.
 * INTERIM — replace when the LLM interpreter owns this decision.
 */
export function isInterimVariantCorrectionIntent(messageText: string): boolean {
  if (!messageText?.trim()) return false;
  const normalized = normalizeArabic(messageText);
  if (!VARIANT_OPTION_PATTERN.test(normalized) && !VARIANT_OPTION_PATTERN.test(messageText)) {
    return false;
  }
  // Avoid \\b — it is unreliable on Arabic letters in JS.
  if (/^(لا|لأ|مو|مش)(?:\s|[،,]|$)/.test(normalized)) return true;
  if (/(غير|بدل|حول|غيّر)(?:\s|$)/.test(normalized)) return true;
  if (/(?:خليه|خليها|خلي|غيره|غيرها)(?:\s|$)/.test(normalized)) return true;
  if (
    /(مو|مش)\s*(?:ال)?(هيك|هذا|هيدا|اسود|أسود|احمر|أحمر|ابيض|أبيض)/.test(normalized)
  ) {
    return true;
  }
  if (
    /(بدي|ابي|ابغى|أريد|اريد)\s*(ها|ه|اها)?\s*(لون\s*)?(احمر|أحمر|اسود|أسود|ابيض|أبيض|ازرق|أزرق|اخضر|أخضر|red|black|white)/.test(
      normalized
    )
  ) {
    // Bare «بدي أحمر» is a selection — require a rejection/change cue.
    if (/^(لا|لأ|مو|مش)(?:\s|[،,]|$)/.test(normalized)) return true;
    if (/(غير|بدل|حول|غيّر|خليه|خليها)/.test(normalized)) return true;
    if (/(ما\s*بدي|بلاش|بدون)/.test(normalized)) return true;
    return false;
  }
  return false;
}

export function classifyInterimCancelIntent(messageText: string): InterimCancelKind {
  if (!messageText?.trim()) return 'none';
  if (isInterimVariantCorrectionIntent(messageText)) {
    return 'none';
  }
  if (isInterimWholeOrderCancel(messageText)) return 'whole_cancel';
  if (isInterimPartialRemoveVerb(messageText)) return 'partial_remove';
  return 'none';
}

/**
 * INTERIM — verb matchers for whole-order cancel vs remove-one-line,
 * plus variant-correction / negation detection used by resolveVariantChange.
 *
 * WHY this exists: deterministic cancel/remove verbs remain until the LLM
 * interpreter covers free-form phrasing. Do NOT grow product-name understanding
 * — line targeting uses cart line names/variants only (see matchCartLinesForRemoval).
 *
 * Color negation against a product's catalog options lives in orderColorPolicy
 * / variantEngine; this module only decides WHETHER the utterance is a
 * correction vs cancel/remove — without a hard-coded color/size word list.
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

/** Documented variant-correction phrases (INTERIM — unit-tested). */
export const INTERIM_VARIANT_CORRECTION_TEST_CASES: ReadonlyArray<{
  phrase: string;
  isCorrection: boolean;
  note: string;
}> = Object.freeze([
  { phrase: 'لا ما بدي اسود بدي احمر', isCorrection: true, note: 'negation + positive color' },
  { phrase: 'مو الأسود، الأحمر', isCorrection: true, note: 'مو + alternative' },
  { phrase: 'غيّر اللون للأحمر', isCorrection: true, note: 'change color verb' },
  { phrase: 'عدل المقاس لـ s', isCorrection: true, note: 'عدل size correction' },
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
 * Cue-based only — no catalog color/size lexicon.
 */
export function isInterimVariantCorrectionIntent(messageText: string): boolean {
  if (!messageText?.trim()) return false;
  const normalized = normalizeArabic(messageText);

  // Soft decline / defer — not a variant correction.
  if (
    /^(لا|لأ)\s*(شكرا|شكراً)?\s*(بس)?/i.test(normalized) &&
    !/(ما\s*بدي|مو|مش|غير|بدل|خليه|بدي\s+\S+)/.test(normalized)
  ) {
    return false;
  }

  // Avoid \\b — unreliable on Arabic letters in JS.
  if (/^(لا|لأ|مو|مش)(?:\s|[،,]|$)/.test(normalized)) {
    if (/^(لا|لأ|مو|مش)$/.test(normalized)) return false;
    // «لا شكراً» alone is not a correction.
    if (/^(لا|لأ)\s*(شكرا|شكراً)\s*$/i.test(normalized)) return false;
    return true;
  }
  if (/(غير|بدل|حول|غيّر|عدل|عدّل)(?:\s|$)/.test(normalized)) return true;
  if (/(?:خليه|خليها|خلي|غيره|غيرها)(?:\s|$)/.test(normalized)) return true;
  if (/(مو|مش)\s*(?:ال)?(هيك|هذا|هيدا)/.test(normalized)) return true;
  if (
    /(ما\s*بدي|بلاش|بدون)/.test(normalized) &&
    /(بدي|ابي|ابغى|غير|بدل|خليه)/.test(normalized)
  ) {
    return true;
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

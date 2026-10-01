import type { Language } from '../../../core/types.js';
import { formatColorOptionsForDisplay } from '../../../catalog/color-options.js';
import type { VariantAxis } from './types.js';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Single ask template — axis label is the only variable. */
export function buildAskVariantMessage(
  language: Language,
  axis: VariantAxis
): string {
  const options = formatColorOptionsForDisplay(
    axis.values,
    language === 'english' ? 'english' : 'arabic'
  );
  if (language === 'english') {
    return `Which ${axis.labels.en} would you like?\n${options}`;
  }
  return `أي ${axis.labels.ar} بتحب؟\n${options}`;
}

/** True only when OUR template for this axis was emitted — not free LLM copy. */
export function isOurVariantAskTemplate(
  replyText: string,
  axis: VariantAxis
): boolean {
  if (!replyText?.trim() || !axis.values.length) return false;
  const ar = new RegExp(`(?:أي|اي)\\s*${escapeRegExp(axis.labels.ar)}\\s*بتحب`, 'i');
  const en = new RegExp(
    `which\\s+${escapeRegExp(axis.labels.en)}\\s+would you like`,
    'i'
  );
  if (!ar.test(replyText) && !en.test(replyText)) return false;
  return axis.values.some((value) => replyText.includes(value));
}

/** Unavailable value for any axis (color/size/style) — not color-only copy. */
export function buildUnavailableVariantMessage(
  language: Language,
  axis: VariantAxis,
  rejectedValue?: string | null
): string {
  const options = formatColorOptionsForDisplay(
    axis.values,
    language === 'english' ? 'english' : 'arabic'
  );
  const arNoun =
    axis.id === 'color' ? 'اللون' : axis.id === 'size' ? 'المقاس' : axis.labels.ar;
  const enNoun = axis.labels.en.toLowerCase();
  if (language === 'english') {
    const rejected = rejectedValue?.trim()
      ? `\n("${rejectedValue}" is not available for this product.)`
      : '';
    return `That ${enNoun} isn't available for this product${rejected}\n\nAvailable ${enNoun}s:\n${options}\n\nPlease choose from the list.`;
  }
  const rejected = rejectedValue?.trim()
    ? `\n(«${rejectedValue}» غير متوفر لهذا المنتج.)`
    : '';
  return `هذا ${arNoun} غير متوفر لهذا المنتج${rejected}\n\nالخيارات المتاحة:\n${options}\n\nاختار من القائمة من فضلك.`;
}

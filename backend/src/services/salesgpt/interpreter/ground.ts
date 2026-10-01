/**
 * Single post-reply honesty gate. Reuses existing strippers — no second detector.
 */
import { stripFalseImageDeliveryClaims } from '../../../response/image-caption.js';
import type { Language } from '../../../core/types.js';
import type { ProductOverviewRow } from '../../../catalog/product-search.js';
import {
  buildNoMatchFallbackMessage,
  violatesNoMatchGrounding,
} from '../catalogGrounding.js';
import { stripUnsolicitedCrossSellMentions } from '../customerRequest.js';
import { stripFalseOrderPlacedClaims } from '../orderConfirmationPolicy.js';
import { stripFalseVariantUpdateClaims } from '../resolveVariantChange.js';

export function groundInterpreterReply(opts: {
  replyText: string;
  language: Language;
  imageAttached: boolean;
  noMatchForSpecificQuery: boolean;
  catalogOverview: ProductOverviewRow[];
  salespersonName: string;
  storeName?: string;
  /** When false, strip sentences that name non-active catalog products. */
  allowAlternatives?: boolean;
  /** Names of products currently in focus / cart for this turn. */
  activeProductNames?: string[];
}): string {
  let text = opts.replyText || '';
  text = stripFalseOrderPlacedClaims(text);
  text = stripFalseVariantUpdateClaims(text);
  if (!opts.imageAttached) {
    text = stripFalseImageDeliveryClaims(text);
  }
  if (
    opts.noMatchForSpecificQuery &&
    violatesNoMatchGrounding(text, opts.catalogOverview, opts.language)
  ) {
    return buildNoMatchFallbackMessage({
      language: opts.language,
      salespersonName: opts.salespersonName,
      storeName: opts.storeName,
      catalogOverview: opts.catalogOverview,
    });
  }

  if (opts.allowAlternatives !== true && (opts.catalogOverview?.length || 0) > 0) {
    const activeNameKeys = new Set(
      (opts.activeProductNames || []).map((n) => n.trim().toLowerCase())
    );
    const otherNames = opts.catalogOverview
      .map((row) => row.name)
      .filter((name) => name && !activeNameKeys.has(name.trim().toLowerCase()));
    text = stripUnsolicitedCrossSellMentions({
      replyText: text,
      activeProductNames: opts.activeProductNames || [],
      otherProductNames: otherNames,
      language: opts.language === 'english' ? 'english' : 'arabic',
    });
  }

  return text;
}

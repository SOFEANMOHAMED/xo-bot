/**
 * Match customer words against cart lines' own names/variants only.
 * No catalog product-name keyword lists.
 */
import type { CartItem } from '../../core/types.js';
import { colorsMatch } from '../../catalog/color-options.js';
import { normalizeArabic } from '../../catalog/product-search.js';
import { isInterimPartialRemoveVerb } from './interimCancelMatchers.js';

function namesLooselyMatch(a: string, b: string): boolean {
  const na = normalizeArabic(a || '');
  const nb = normalizeArabic(b || '');
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const sa = na.replace(/(ات|ين|ون|ة|ه)$/u, '');
  const sb = nb.replace(/(ات|ين|ون|ة|ه)$/u, '');
  return (
    sa.length >= 3 &&
    sb.length >= 3 &&
    (sa === sb || sa.startsWith(sb) || sb.startsWith(sa))
  );
}

function stripLeadingAl(value: string): string {
  return value.replace(/^ال/, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function textMentionsCartField(hay: string, raw: string | undefined): boolean {
  if (!raw?.trim()) return false;
  const n = normalizeArabic(raw);
  if (n.length < 2) return false;
  if (hay.includes(n)) return true;
  const strippedHay = hay.replace(/(^|\s)ال(?=\S)/g, '$1');
  const strippedN = stripLeadingAl(n);
  if (strippedN.length >= 2 && strippedHay.includes(strippedN)) return true;
  for (const tok of strippedHay.split(/\s+/)) {
    if (!tok) continue;
    if (namesLooselyMatch(tok, n) || namesLooselyMatch(tok, strippedN)) return true;
  }
  return false;
}

/**
 * True when the message rejects this product name
 * («مو الساعة»، «ما بدي الساعة»، «بدون القميص»).
 * Uses the cart/catalog product's own name only — no color/size lexicon.
 */
export function isProductNameNegatedInMessage(
  messageText: string,
  productName: string
): boolean {
  if (!messageText?.trim() || !productName?.trim()) return false;
  const hay = normalizeArabic(messageText);
  const name = normalizeArabic(productName);
  if (!name || name.length < 2) return false;

  const forms = [...new Set([name, stripLeadingAl(name)].filter((f) => f.length >= 2))];
  for (const form of forms) {
    const escaped = escapeRegExp(form);
    const re = new RegExp(
      `(?:^|[\\s،,])(?:مو|مش|ما\\s*بدي|لا\\s*بدي|بدون)\\s+(?:ال)?${escaped}(?=$|[\\s،,.!?])`,
      'i'
    );
    if (re.test(hay)) return true;
  }
  return false;
}

/**
 * Cart lines whose product name is explicitly negated in the message.
 * Distinct from remove-verb targeting (شيل/الغي) — those use matchCartLinesForRemoval.
 */
export function matchCartLinesForProductNegation(
  messageText: string,
  lines: CartItem[]
): CartItem[] {
  if (!messageText?.trim() || !lines.length) return [];
  if (isInterimPartialRemoveVerb(messageText)) return [];
  return lines.filter((line) =>
    isProductNameNegatedInMessage(messageText, line.productName)
  );
}

/**
 * Match the customer's words against cart lines' own names and variants.
 */
export function matchCartLinesForRemoval(
  messageText: string,
  lines: CartItem[]
): CartItem[] {
  if (!messageText?.trim() || !lines.length) return [];
  const hay = normalizeArabic(messageText);
  const removalByVerb = isInterimPartialRemoveVerb(messageText);

  const nameHits = lines.filter((line) => {
    if (!textMentionsCartField(hay, line.productName)) return false;
    return removalByVerb;
  });

  const variantHits = lines.filter((line) => {
    const colorHit =
      !!line.color &&
      (textMentionsCartField(hay, line.color) || colorsMatch(messageText, line.color));
    const sizeHit = !!line.size && textMentionsCartField(hay, line.size);
    return colorHit || sizeHit;
  });

  if (removalByVerb && variantHits.length > 0) {
    if (nameHits.length > 0) {
      const narrowed = variantHits.filter((variant) =>
        nameHits.some(
          (named) =>
            named.productId === variant.productId && named.addedAt === variant.addedAt
        )
      );
      return narrowed.length ? narrowed : variantHits;
    }
    return variantHits;
  }
  return nameHits;
}

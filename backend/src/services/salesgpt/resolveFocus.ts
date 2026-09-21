/**
 * Single-product focus resolution — pure decision, no I/O.
 *
 * Fixed priority (first hit wins):
 *   1. product named in the current message
 *   2. product bound to pending_bot_question
 *   3. product named in the last bot reply
 *   4. cart / last_recommended focus
 *   5. ad-seed product_id — ONLY when nothing else exists
 *
 * OOS products may be named (so we can say they exist but are out of stock)
 * but never become variant-selection or cart-line targets.
 */
import type { Product } from '../../core/types.js';

export type FocusSource =
  | 'message'
  | 'pending'
  | 'last_bot'
  | 'cart'
  | 'seed'
  | 'none';

export type ResolveFocusInput = {
  namedInMessage: Product[];
  pendingProduct: Product | null;
  lastBotProduct: Product | null;
  cartFocusProduct: Product | null;
  seededProduct: Product | null;
};

export type ResolveFocusResult = {
  product: Product | null;
  source: FocusSource;
};

/** True when the product can be sold (stock missing ⇒ treat as sellable). */
export function isSellableProduct(product: Product | null | undefined): boolean {
  if (!product) return false;
  return !(typeof product.stock === 'number' && product.stock <= 0);
}

/**
 * Prefer sellable products for pending / last-bot / cart / seed.
 * Message-named products keep OOS so the bot can admit unavailability.
 */
export function resolveFocus(input: ResolveFocusInput): ResolveFocusResult {
  if (input.namedInMessage.length > 0) {
    return { product: input.namedInMessage[0], source: 'message' };
  }

  if (input.pendingProduct && isSellableProduct(input.pendingProduct)) {
    return { product: input.pendingProduct, source: 'pending' };
  }

  if (input.lastBotProduct && isSellableProduct(input.lastBotProduct)) {
    return { product: input.lastBotProduct, source: 'last_bot' };
  }

  if (input.cartFocusProduct && isSellableProduct(input.cartFocusProduct)) {
    return { product: input.cartFocusProduct, source: 'cart' };
  }

  // Ad-seed is last resort — never sticky over a discussed alternative.
  if (input.seededProduct) {
    return { product: input.seededProduct, source: 'seed' };
  }

  return { product: null, source: 'none' };
}

/** Honest OOS acknowledgement (no color/size options from brand-like fields). */
export function buildOutOfStockMessage(
  language: 'arabic' | 'english',
  productName: string
): string {
  if (language === 'arabic') {
    return `${productName} غير متوفر حالياً.`;
  }
  return `${productName} is currently out of stock.`;
}

/**
 * Catalog-safe product blurb used when a reply fails grounding
 * (e.g. falsely claims a real color is unavailable).
 */
export function buildGroundedCatalogFallback(
  products: Product[],
  language: 'arabic' | 'english'
): string {
  const primary = products[0];
  if (!primary) {
    return language === 'arabic'
      ? 'ما عندي معلومة مؤكدة عن هالمنتج حالياً.'
      : 'I don’t have verified details for that product right now.';
  }

  if (!isSellableProduct(primary)) {
    return buildOutOfStockMessage(language, primary.name);
  }

  if (language === 'arabic') {
    const parts = [`${primary.name} بسعر ${primary.price}.`];
    if (primary.colors?.length) {
      parts.push(`الألوان المتوفرة: ${primary.colors.join('، ')}.`);
    }
    if (primary.sizes?.length) {
      parts.push(`المقاسات: ${primary.sizes.join('، ')}.`);
    }
    return parts.join(' ');
  }

  const parts = [`${primary.name} is ${primary.price}.`];
  if (primary.colors?.length) {
    parts.push(`Available colors: ${primary.colors.join(', ')}.`);
  }
  if (primary.sizes?.length) {
    parts.push(`Sizes: ${primary.sizes.join(', ')}.`);
  }
  return parts.join(' ');
}

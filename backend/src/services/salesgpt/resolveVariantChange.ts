/**
 * Pure variant-change decision — which cart line gets which positive color.
 *
 * Negation / correction intent detection lives in interimCancelMatchers
 * (documented INTERIM). Line writes happen via cartLineOps in the caller.
 */
import type { CartItem, Product } from '../../core/types.js';
import { ensureLineId } from './cartLineOps.js';
import {
  formatCartSummary,
  type CartSummaryOptions,
} from './cartSummary.js';
import { isInterimVariantCorrectionIntent } from './interimCancelMatchers.js';
import {
  mentionedColorOutsideCatalog,
  resolveWantedCatalogColor,
} from './orderColorPolicy.js';
import { extractBareColorAnswer } from './pendingBotQuestion.js';
import { isSellableProduct } from './resolveFocus.js';

export type VariantChangeResolution =
  | {
      kind: 'apply';
      productId: string;
      lineId: string;
      color: string;
      productName: string;
      changed: true;
    }
  | {
      kind: 'unchanged';
      productId: string;
      lineId: string;
      color: string;
      productName: string;
      changed: false;
    }
  | {
      kind: 'unavailable';
      productId: string;
      rejected: string;
      catalogColors: string[];
      productName?: string;
    }
  | {
      kind: 'ask_which';
      productId: string;
      color: string;
      productName?: string;
    }
  | { kind: 'none' };

export type ResolveVariantChangeInput = {
  messageText: string;
  cartLines: CartItem[];
  /** Products known in this turn (focus + mentioned + cart products). */
  products: Product[];
  focusProductId?: string | null;
  mentionedProductIds?: string[];
};

function productById(products: Product[], id: string | null | undefined): Product | null {
  if (!id) return null;
  return products.find((p) => p.id === id) || null;
}

function pickTargetProductId(input: ResolveVariantChangeInput): string | null {
  const lines = input.cartLines;
  if (input.mentionedProductIds?.length) {
    const hit = input.mentionedProductIds.find((id) =>
      lines.some((line) => line.productId === id)
    );
    if (hit) return hit;
  }
  if (input.focusProductId && lines.some((l) => l.productId === input.focusProductId)) {
    return input.focusProductId;
  }
  if (lines.length === 1) return lines[0].productId;
  // Prefer a line whose catalog colors include a wanted/unavailable mention.
  for (const line of lines) {
    const product = productById(input.products, line.productId);
    const colors = product?.colors || [];
    if (!colors.length) continue;
    if (
      resolveWantedCatalogColor(input.messageText, colors) ||
      mentionedColorOutsideCatalog(input.messageText, colors)
    ) {
      return line.productId;
    }
  }
  return input.focusProductId || lines[0]?.productId || null;
}

/**
 * Resolve a color/size correction or bare color pick against the target
 * product's real catalog colors.
 * Returns `none` when there is no actionable positive color.
 */
export function resolveVariantChange(
  input: ResolveVariantChangeInput
): VariantChangeResolution {
  if (!input.cartLines.length) {
    return { kind: 'none' };
  }

  const productId = pickTargetProductId(input);
  if (!productId) return { kind: 'none' };

  const product = productById(input.products, productId);
  if (!isSellableProduct(product)) {
    return { kind: 'none' };
  }

  const catalogColors = product?.colors || [];
  const wanted = resolveWantedCatalogColor(input.messageText, catalogColors);
  const unavailable = wanted
    ? null
    : mentionedColorOutsideCatalog(input.messageText, catalogColors);

  if (!wanted && !unavailable) {
    return { kind: 'none' };
  }

  const isCorrection = isInterimVariantCorrectionIntent(input.messageText);
  const isBarePick = Boolean(
    wanted && extractBareColorAnswer(input.messageText, catalogColors)
  );
  // Corrections («لا ما بدي اسود بدي احمر») or bare picks («بدي الأحمر» / «الأسود»).
  if (!isCorrection && !isBarePick && !unavailable) {
    return { kind: 'none' };
  }

  const matching = input.cartLines
    .map(ensureLineId)
    .filter((line) => line.productId === productId);

  if (wanted && matching.length > 1) {
    return {
      kind: 'ask_which',
      productId,
      color: wanted,
      productName: product?.name,
    };
  }

  if (unavailable) {
    return {
      kind: 'unavailable',
      productId,
      rejected: unavailable,
      catalogColors,
      productName: product?.name,
    };
  }

  if (!wanted || matching.length === 0) {
    return { kind: 'none' };
  }

  const line = matching[0];
  const current = (line.color || '').trim();
  if (current === wanted) {
    return {
      kind: 'unchanged',
      productId,
      lineId: line.lineId,
      color: wanted,
      productName: product?.name || line.productName,
      changed: false,
    };
  }

  return {
    kind: 'apply',
    productId,
    lineId: line.lineId,
    color: wanted,
    productName: product?.name || line.productName,
    changed: true,
  };
}

/** Strip false «تم التحديث» claims when the cart did not mutate. */
export function stripFalseVariantUpdateClaims(replyText: string): string {
  if (!replyText?.trim()) return replyText;
  return replyText
    .replace(/تمام،?\s*حد[ّ']?ثت\s*طلبك[.!]?\s*/gi, '')
    .replace(/تم\s*التحديث[.!]?\s*/gi, '')
    .replace(/حد[ّ']?ثت\s*طلبك[.!]?\s*/gi, '')
    .replace(/updated\s+your\s+order[.!]?\s*/gi, '')
    .trim();
}

export function buildVariantUpdatedMessage(
  language: 'arabic' | 'english',
  color: string,
  productName: string | undefined,
  cartItems: CartItem[],
  opts?: CartSummaryOptions
): string {
  const lead =
    language === 'arabic'
      ? productName
        ? `تمام، حدّثت طلبك — ${productName} باللون ${color}.`
        : `تمام، حدّثت طلبك للون ${color}.`
      : productName
        ? `Done — updated your order: ${productName} in ${color}.`
        : `Done — updated your order to ${color}.`;
  // WHY: add/remove already show priced summary; color change must match (PHASE 2H-2).
  const summary = formatCartSummary(cartItems, language, opts);
  const cta =
    language === 'arabic'
      ? 'نقدر نضيف منتج ثاني، أو نكمّل الطلب؟'
      : 'We can add another product, or finish the order.';
  return `${lead}\n${summary}\n\n${cta}`;
}

export function buildVariantUnchangedMessage(
  language: 'arabic' | 'english',
  color: string,
  productName?: string
): string {
  if (language === 'arabic') {
    return productName
      ? `طلبك أصلاً على ${productName} باللون ${color}.`
      : `طلبك أصلاً على اللون ${color}.`;
  }
  return productName
    ? `Your order already has ${productName} in ${color}.`
    : `Your order is already set to ${color}.`;
}

export function buildAskWhichLineMessage(
  language: 'arabic' | 'english',
  productName?: string
): string {
  if (language === 'arabic') {
    return productName
      ? `عندك أكثر من سطر لـ ${productName}. أي واحد بدك تغيّر لونه؟`
      : 'عندك أكثر من سطر لنفس المنتج. أي واحد بدك تغيّر لونه؟';
  }
  return productName
    ? `You have more than one ${productName} line. Which one should I change?`
    : 'You have more than one line for that product. Which one should I change?';
}

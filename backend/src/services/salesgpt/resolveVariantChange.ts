/**
 * Pure variant-change decision — any catalog axis (color, size, …).
 *
 * Live decision path: variantEngine.resolveVariantAxisChange.
 * Color-only correction fallback uses resolveWantedCatalogColor.
 */
import type { CartItem, Product } from '../../core/types.js';
import { ensureLineId } from './cartLineOps.js';
import {
  formatCartSummary,
  type CartSummaryOptions,
} from './cartSummary.js';
import { buildCartActionCta } from './cartActionCta.js';
import { isInterimVariantCorrectionIntent } from './interimCancelMatchers.js';
import {
  mentionedColorOutsideCatalog,
  resolveWantedCatalogColor,
} from './orderColorPolicy.js';
import { isSellableProduct } from './resolveFocus.js';
import {
  isCatalogValueNegated,
  resolveVariantAxisChange,
} from './variantEngine/change.js';
import {
  effectiveAxes,
  selectionFromEntities,
} from './variantEngine/axes.js';
import { extractBareCatalogAnswer } from './variantEngine/match.js';
import { RESERVED_AXIS_COLOR, RESERVED_AXIS_SIZE } from './variantEngine/types.js';

export type VariantChangeResolution =
  | {
      kind: 'apply';
      productId: string;
      lineId: string;
      axisId: string;
      value: string;
      /** Legacy alias when axisId === color. */
      color: string;
      productName: string;
      changed: true;
    }
  | {
      kind: 'unchanged';
      productId: string;
      lineId: string;
      axisId: string;
      value: string;
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
      axisId: string;
      value: string;
      color: string;
      productName?: string;
    }
  | { kind: 'none' };

export type ResolveVariantChangeInput = {
  messageText: string;
  cartLines: CartItem[];
  products: Product[];
  focusProductId?: string | null;
  mentionedProductIds?: string[];
};

function productById(products: Product[], id: string | null | undefined): Product | null {
  if (!id) return null;
  return products.find((p) => p.id === id) || null;
}

function mapApply(
  productId: string,
  productName: string,
  axisId: string,
  value: string,
  lineId: string,
  changed: boolean
): VariantChangeResolution {
  const color = axisId === RESERVED_AXIS_COLOR ? value : '';
  if (changed) {
    return {
      kind: 'apply',
      productId,
      lineId,
      axisId,
      value,
      color,
      productName,
      changed: true,
    };
  }
  return {
    kind: 'unchanged',
    productId,
    lineId,
    axisId,
    value,
    color,
    productName,
    changed: false,
  };
}

/** Target product via focus/mention/cart — catalog mentions use engine extract. */
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
  for (const line of lines) {
    const product = productById(input.products, line.productId);
    if (!product) continue;
    for (const axis of effectiveAxes(product)) {
      const bare = extractBareCatalogAnswer(input.messageText, axis);
      if (bare) return line.productId;
      const hit = axis.values.some(
        (c) =>
          input.messageText.toLowerCase().includes(c.toLowerCase()) &&
          !isCatalogValueNegated(input.messageText, c)
      );
      if (hit) return line.productId;
    }
    const colors = product.colors || [];
    if (
      colors.length &&
      (mentionedColorOutsideCatalog(input.messageText, colors) ||
        resolveWantedCatalogColor(input.messageText, colors))
    ) {
      return line.productId;
    }
  }
  return input.focusProductId || lines[0]?.productId || null;
}

/**
 * Resolve a color/size correction or bare pick against the target product.
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
  const targetLines = input.cartLines.filter((line) => line.productId === productId);
  const engine = resolveVariantAxisChange({
    messageText: input.messageText,
    product,
    cartLines: targetLines,
    pending: null,
    selection: selectionFromEntities({
      color: targetLines[0]?.color,
      size: targetLines[0]?.size,
      variants: targetLines[0]?.variants,
    }),
  });

  if (
    (engine.kind === 'apply' || engine.kind === 'unchanged') &&
    engine.lineId &&
    engine.axisId
  ) {
    return mapApply(
      productId,
      product?.name || '',
      engine.axisId,
      engine.value,
      engine.lineId,
      engine.kind === 'apply'
    );
  }
  if (engine.kind === 'ask_which_line' && engine.axisId) {
    return {
      kind: 'ask_which',
      productId,
      axisId: engine.axisId,
      value: engine.value,
      color: engine.axisId === RESERVED_AXIS_COLOR ? engine.value : '',
      productName: product?.name,
    };
  }
  if (engine.kind === 'unavailable' && engine.axisId === RESERVED_AXIS_COLOR) {
    return {
      kind: 'unavailable',
      productId,
      rejected: engine.rejected,
      catalogColors,
      productName: product?.name,
    };
  }

  const unavailable = mentionedColorOutsideCatalog(input.messageText, catalogColors);
  if (unavailable) {
    return {
      kind: 'unavailable',
      productId,
      rejected: unavailable,
      catalogColors,
      productName: product?.name,
    };
  }

  // Color correction fallback («غيّر للأحمر») when engine did not fire.
  if (!isInterimVariantCorrectionIntent(input.messageText)) {
    return { kind: 'none' };
  }
  const wanted = resolveWantedCatalogColor(input.messageText, catalogColors);
  if (!wanted) return { kind: 'none' };

  const matching = input.cartLines
    .map(ensureLineId)
    .filter((line) => line.productId === productId);

  if (matching.length > 1) {
    return {
      kind: 'ask_which',
      productId,
      axisId: RESERVED_AXIS_COLOR,
      value: wanted,
      color: wanted,
      productName: product?.name,
    };
  }
  if (matching.length === 0) return { kind: 'none' };

  const line = matching[0];
  const current = (line.color || '').trim();
  return mapApply(
    productId,
    product?.name || line.productName,
    RESERVED_AXIS_COLOR,
    wanted,
    line.lineId,
    current !== wanted
  );
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

function axisLead(
  language: 'arabic' | 'english',
  axisId: string,
  value: string,
  productName?: string
): string {
  if (axisId === RESERVED_AXIS_SIZE) {
    if (language === 'arabic') {
      return productName
        ? `تمام، حدّثت طلبك — ${productName} بالمقاس ${value}.`
        : `تمام، حدّثت طلبك للمقاس ${value}.`;
    }
    return productName
      ? `Done — updated your order: ${productName} in size ${value}.`
      : `Done — updated your order to size ${value}.`;
  }
  if (language === 'arabic') {
    return productName
      ? `تمام، حدّثت طلبك — ${productName} باللون ${value}.`
      : `تمام، حدّثت طلبك للون ${value}.`;
  }
  return productName
    ? `Done — updated your order: ${productName} in ${value}.`
    : `Done — updated your order to ${value}.`;
}

export function buildVariantUpdatedMessage(
  language: 'arabic' | 'english',
  valueOrColor: string,
  productName: string | undefined,
  cartItems: CartItem[],
  opts?: CartSummaryOptions & { axisId?: string }
): string {
  const axisId = opts?.axisId || RESERVED_AXIS_COLOR;
  const lead = axisLead(language, axisId, valueOrColor, productName);
  const summary = formatCartSummary(cartItems, language, opts);
  return `${lead}\n${summary}\n\n${buildCartActionCta(language)}`;
}

export function buildVariantUnchangedMessage(
  language: 'arabic' | 'english',
  valueOrColor: string,
  productName?: string,
  axisId: string = RESERVED_AXIS_COLOR
): string {
  if (axisId === RESERVED_AXIS_SIZE) {
    if (language === 'arabic') {
      return productName
        ? `طلبك أصلاً على ${productName} بالمقاس ${valueOrColor}.`
        : `طلبك أصلاً على المقاس ${valueOrColor}.`;
    }
    return productName
      ? `Your order already has ${productName} in size ${valueOrColor}.`
      : `Your order is already set to size ${valueOrColor}.`;
  }
  if (language === 'arabic') {
    return productName
      ? `طلبك أصلاً على ${productName} باللون ${valueOrColor}.`
      : `طلبك أصلاً على اللون ${valueOrColor}.`;
  }
  return productName
    ? `Your order already has ${productName} in ${valueOrColor}.`
    : `Your order is already set to ${valueOrColor}.`;
}

export function buildAskWhichLineMessage(
  language: 'arabic' | 'english',
  productName?: string,
  axisId: string = RESERVED_AXIS_COLOR
): string {
  const what =
    axisId === RESERVED_AXIS_SIZE
      ? language === 'arabic'
        ? 'مقاسه'
        : 'size'
      : language === 'arabic'
        ? 'لونه'
        : 'color';
  if (language === 'arabic') {
    return productName
      ? `عندك أكثر من سطر لـ ${productName}. أي واحد بدك تغيّر ${what}؟`
      : `عندك أكثر من سطر لنفس المنتج. أي واحد بدك تغيّر ${what}؟`;
  }
  return productName
    ? `You have more than one ${productName} line. Which one should I change?`
    : 'You have more than one line for that product. Which one should I change?';
}

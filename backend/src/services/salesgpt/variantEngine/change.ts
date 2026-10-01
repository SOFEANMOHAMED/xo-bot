import type { CartItem, Product } from '../../../core/types.js';
import { ensureLineId } from '../cartLineOps.js';
import { isSellableProduct } from '../resolveFocus.js';
import { axisById, effectiveAxes } from './axes.js';
import { extractBareVariantAnswer } from './extract.js';
import {
  matchCatalogValue,
  normalizeVariantToken,
  stripLeadingAl,
  tokenizeVariantText,
} from './match.js';
import type {
  PendingVariantQuestion,
  VariantAxis,
  VariantAxisId,
  VariantSelection,
} from './types.js';

export type VariantAxisChangeResolution =
  | {
      kind: 'apply';
      axisId: VariantAxisId;
      value: string;
      lineId: string;
    }
  | {
      kind: 'unchanged';
      axisId: VariantAxisId;
      value: string;
      lineId: string;
    }
  | {
      kind: 'unavailable';
      axisId: VariantAxisId;
      rejected: string;
    }
  | {
      kind: 'ask_which_line';
      axisId: VariantAxisId;
      value: string;
    }
  | {
      kind: 'ask_which_axis';
      value: string;
      axisIds: VariantAxisId[];
    }
  | { kind: 'none' };

const LOCAL_NEGATION =
  /(?:ما\s*بدي|ما\s*ابي|ما\s*ابغى|ما\s*عاوز|بلاش|بدون|مو|مش|لا\s*بدي|لا\s*اريد|لا\s*أريد)\s*(?:ال)?$/i;

function haystack(text: string): string {
  return stripLeadingAl(normalizeVariantToken(text)).replace(/(^|\s)ال(?=\S)/g, '$1');
}

export function isCatalogValueNegated(messageText: string, option: string): boolean {
  const hay = haystack(messageText);
  const needle = stripLeadingAl(normalizeVariantToken(option));
  if (!needle) return false;
  const idx = hay.indexOf(needle);
  if (idx < 0) return false;
  const before = hay.slice(0, idx).trim();
  return LOCAL_NEGATION.test(before);
}

function mentionIndex(messageText: string, option: string): number {
  const needle = stripLeadingAl(normalizeVariantToken(option));
  if (!needle) return -1;
  if (needle.length <= 2) {
    const tokens = tokenizeVariantText(messageText).map(stripLeadingAl);
    return tokens.findIndex((token) => token === needle);
  }
  return haystack(messageText).indexOf(needle);
}

function pickLine(
  cartLines: CartItem[],
  productId: string
): { lineId: string } | { ask: true } | null {
  const matching = cartLines
    .map(ensureLineId)
    .filter((line) => line.productId === productId);
  if (matching.length === 0) return null;
  if (matching.length > 1) return { ask: true };
  return { lineId: matching[0].lineId };
}

function currentOnLine(
  line: CartItem | undefined,
  axisId: VariantAxisId,
  selection: VariantSelection
): string {
  if (axisId === 'color' && line?.color) return line.color;
  if (axisId === 'size' && line?.size) return line.size;
  if (line?.variants?.[axisId]) return line.variants[axisId];
  return selection[axisId] || '';
}

function resolveOnAxis(
  axis: VariantAxis,
  wanted: string,
  product: Product,
  cartLines: CartItem[],
  selection: VariantSelection
): VariantAxisChangeResolution {
  const target = pickLine(cartLines, product.id);
  if (target && 'ask' in target) {
    return { kind: 'ask_which_line', axisId: axis.id, value: wanted };
  }
  if (!target) {
    return { kind: 'apply', axisId: axis.id, value: wanted, lineId: '' };
  }
  const line = cartLines.map(ensureLineId).find((row) => row.lineId === target.lineId);
  const current = currentOnLine(line, axis.id, selection).trim();
  if (current && current === wanted) {
    return {
      kind: 'unchanged',
      axisId: axis.id,
      value: wanted,
      lineId: target.lineId,
    };
  }
  return { kind: 'apply', axisId: axis.id, value: wanted, lineId: target.lineId };
}

/**
 * Catalog-value change / negation. Pending axis wins; exclusive match next;
 * same surface value on two axes → ask_which_axis.
 */
export function resolveVariantAxisChange(input: {
  messageText: string;
  product: Product | null | undefined;
  cartLines: CartItem[];
  pending: PendingVariantQuestion;
  selection: VariantSelection;
}): VariantAxisChangeResolution {
  const product = input.product;
  if (!product || !isSellableProduct(product)) return { kind: 'none' };
  const axes = effectiveAxes(product);
  if (axes.length === 0 || !input.messageText?.trim()) return { kind: 'none' };

  const pendingAxis =
    input.pending && input.pending.productId === String(product.id)
      ? axisById(product, input.pending.axisId)
      : null;

  const bareByAxis = axes
    .map((axis) => ({ axis, value: extractBareVariantAnswer(input.messageText, axis) }))
    .filter((row): row is { axis: VariantAxis; value: string } => Boolean(row.value));

  if (pendingAxis) {
    const pendingBare = extractBareVariantAnswer(input.messageText, pendingAxis);
    if (pendingBare) {
      return resolveOnAxis(
        pendingAxis,
        pendingBare,
        product,
        input.cartLines,
        input.selection
      );
    }
  } else if (bareByAxis.length === 1) {
    return resolveOnAxis(
      bareByAxis[0].axis,
      bareByAxis[0].value,
      product,
      input.cartLines,
      input.selection
    );
  } else if (bareByAxis.length > 1) {
    const sameValue = bareByAxis.every((row) => row.value === bareByAxis[0].value);
    if (sameValue) {
      return {
        kind: 'ask_which_axis',
        value: bareByAxis[0].value,
        axisIds: bareByAxis.map((row) => row.axis.id),
      };
    }
  }

  type Hit = { axis: VariantAxis; value: string; index: number; negated: boolean };
  const hits: Hit[] = [];
  for (const axis of axes) {
    for (const option of axis.values) {
      const index = mentionIndex(input.messageText, option);
      if (index < 0) continue;
      hits.push({
        axis,
        value: option,
        index,
        negated: isCatalogValueNegated(input.messageText, option),
      });
    }
  }

  const negated = hits.filter((hit) => hit.negated);
  const positive = hits
    .filter((hit) => !hit.negated)
    .sort((a, b) => a.index - b.index);

  // Contained values only count as a correction when something was negated —
  // OR an explicit change cue («غيّر المقاس لـ s») without naming the old value.
  const changeCue =
    /(غير|بدل|حول|غيّر|خليه|خليها|اغير|أغير|عدل|عدّل|اعدل|أعدّل)/.test(
      input.messageText
    ) || /^(لا|لأ|مو|مش)(?:\s|[،,]|$)/.test(input.messageText.trim());

  if (negated.length === 0 && !changeCue) return { kind: 'none' };

  if (negated.length === 0 && changeCue) {
    if (positive.length === 0) return { kind: 'none' };
    const preferSize = /مقاس|سايز|\bsize\b/i.test(input.messageText);
    const preferColor = /لون|\bcolor\b/i.test(input.messageText);
    let pool = positive;
    if (preferSize) {
      const sized = positive.filter((hit) => hit.axis.id === 'size');
      if (sized.length > 0) pool = sized;
    } else if (preferColor) {
      const colored = positive.filter((hit) => hit.axis.id === 'color');
      if (colored.length > 0) pool = colored;
    }
    const last = pool[pool.length - 1];
    const sameSurface = axes.filter(
      (axis) =>
        axis.values.some((option) => option === last.value) ||
        matchCatalogValue(axis, last.value) === last.value
    );
    if (sameSurface.length > 1 && !preferSize && !preferColor) {
      return {
        kind: 'ask_which_axis',
        value: last.value,
        axisIds: sameSurface.map((axis) => axis.id),
      };
    }
    return resolveOnAxis(
      last.axis,
      last.value,
      product,
      input.cartLines,
      input.selection
    );
  }

  if (pendingAxis) {
    const onPending = positive.filter((hit) => hit.axis.id === pendingAxis.id);
    if (onPending.length > 0) {
      return resolveOnAxis(
        pendingAxis,
        onPending[onPending.length - 1].value,
        product,
        input.cartLines,
        input.selection
      );
    }
    return { kind: 'none' };
  }

  if (positive.length === 0) return { kind: 'none' };

  const last = positive[positive.length - 1];
  const sameSurface = axes.filter(
    (axis) =>
      axis.values.some((option) => option === last.value) ||
      matchCatalogValue(axis, last.value) === last.value
  );
  if (sameSurface.length > 1) {
    return {
      kind: 'ask_which_axis',
      value: last.value,
      axisIds: sameSurface.map((axis) => axis.id),
    };
  }

  return resolveOnAxis(
    last.axis,
    last.value,
    product,
    input.cartLines,
    input.selection
  );
}

export function buildAskWhichAxisMessage(
  language: 'arabic' | 'english',
  value: string,
  axes: VariantAxis[]
): string {
  const names = axes.map((axis) =>
    language === 'english' ? axis.labels.en : axis.labels.ar
  );
  if (language === 'english') {
    return `Did you mean ${names.join(' or ')} “${value}”?`;
  }
  return `تقصد ${names.join(' ولا ')} «${value}»؟`;
}

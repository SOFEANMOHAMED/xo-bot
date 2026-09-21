/**
 * Pure cart line operations — narrow interface used by conversationCart / index.
 * Decision logic stays here; I/O and LLM stay outside.
 */
import { randomUUID } from 'node:crypto';
import type { CartItem } from '../../core/types.js';

export type CartLineId = string;

function specified(value?: string): string {
  return typeof value === 'string' ? value.trim() : '';
}

function lineKey(item: Pick<CartItem, 'productId' | 'color' | 'size'>): string {
  return `${item.productId}::${specified(item.color)}::${specified(item.size)}`;
}

/** True when incoming can fill or match an existing line without being a distinct variant. */
function isCompatibleLine(existing: CartItem, incoming: CartItem): boolean {
  if (existing.productId !== incoming.productId) return false;
  const eColor = specified(existing.color);
  const iColor = specified(incoming.color);
  const eSize = specified(existing.size);
  const iSize = specified(incoming.size);
  if (eColor && iColor && eColor !== iColor) return false;
  if (eSize && iSize && eSize !== iSize) return false;
  return true;
}

/** Assign a stable lineId when missing (legacy rows / newly built lines). */
export function ensureLineId(item: CartItem): CartItem & { lineId: CartLineId } {
  if (typeof item.lineId === 'string' && item.lineId.trim()) {
    return { ...item, lineId: item.lineId.trim() };
  }
  return { ...item, lineId: randomUUID() };
}

export function addCartLine(items: CartItem[], line: CartItem): CartItem[] {
  return [...items.map(ensureLineId), ensureLineId(line)];
}

/**
 * Merge incoming lines into existing ones.
 * Existing lines always stay; mentioned products add lines; quantities are not reset.
 */
export function mergeCartLines(existing: CartItem[], incoming: CartItem[]): CartItem[] {
  const result: Array<CartItem & { lineId: CartLineId }> = existing.map(ensureLineId);

  for (const raw of incoming) {
    const next = ensureLineId(raw);
    const exactIdx = result.findIndex((row) => lineKey(row) === lineKey(next));
    const compatibleIdx =
      exactIdx >= 0
        ? exactIdx
        : result.findIndex((row) => isCompatibleLine(row, next));

    if (compatibleIdx < 0) {
      result.push(next);
      continue;
    }

    const prev = result[compatibleIdx];
    result[compatibleIdx] = {
      ...prev,
      productName: next.productName || prev.productName,
      unitPrice: next.unitPrice > 0 ? next.unitPrice : prev.unitPrice,
      currency: next.currency || prev.currency,
      color: specified(next.color) || specified(prev.color) || undefined,
      size: specified(next.size) || specified(prev.size) || undefined,
      // Keep the quantity the customer already locked — sync must not reset.
      quantity: prev.quantity,
    };
  }

  return result;
}

export function updateCartLineById(
  items: CartItem[],
  lineId: CartLineId,
  patch: Partial<Omit<CartItem, 'lineId' | 'productId'>>
): CartItem[] {
  return items.map((item) => {
    const withId = ensureLineId(item);
    if (withId.lineId !== lineId) return withId;
    return {
      ...withId,
      ...patch,
      lineId: withId.lineId,
      productId: withId.productId,
    };
  });
}

export function removeCartLineById(items: CartItem[], lineId: CartLineId): CartItem[] {
  return items.map(ensureLineId).filter((item) => item.lineId !== lineId);
}

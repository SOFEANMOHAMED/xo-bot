/**
 * Generic product-variant axes — V1–V5.
 * Size and color asks / bare extract / confirm gates use this engine.
 * Reserved ids: "color" | "size". Other ids come from product.variant_axes.
 */

export type VariantAxisId = string;

export type VariantAxis = {
  id: VariantAxisId;
  labels: { ar: string; en: string };
  values: string[];
};

/** Confirmed values: axis id → catalog label as stored. */
export type VariantSelection = Record<VariantAxisId, string>;

export type PendingVariantQuestion = {
  axisId: VariantAxisId;
  productId: string;
} | null;

export const RESERVED_AXIS_COLOR = 'color';
export const RESERVED_AXIS_SIZE = 'size';

export const COLOR_AXIS_LABELS = { ar: 'لون', en: 'Color' } as const;
export const SIZE_AXIS_LABELS = { ar: 'مقاس', en: 'Size' } as const;

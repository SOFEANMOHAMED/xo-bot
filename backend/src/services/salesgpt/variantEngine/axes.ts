import type { Product } from '../../../core/types.js';
import {
  COLOR_AXIS_LABELS,
  RESERVED_AXIS_COLOR,
  RESERVED_AXIS_SIZE,
  SIZE_AXIS_LABELS,
  type VariantAxis,
  type VariantAxisId,
  type VariantSelection,
} from './types.js';
import { selectionInCatalog } from './match.js';

function cleanValues(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const value = item.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function extraAxesFromProduct(product: Product | null | undefined): VariantAxis[] {
  const raw = product?.variant_axes;
  if (!Array.isArray(raw)) return [];
  const out: VariantAxis[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    if (!id || id === RESERVED_AXIS_COLOR || id === RESERVED_AXIS_SIZE) continue;
    if (seen.has(id)) continue;
    const values = cleanValues(row.values);
    if (values.length === 0) continue;
    seen.add(id);
    const ar =
      (typeof row.labels?.ar === 'string' && row.labels.ar.trim()) || id;
    const en =
      (typeof row.labels?.en === 'string' && row.labels.en.trim()) || id;
    out.push({ id, labels: { ar, en }, values });
  }
  return out;
}

/** Active axes: non-empty colors → color, non-empty sizes → size, then extra JSONB. */
export function effectiveAxes(product: Product | null | undefined): VariantAxis[] {
  if (!product) return [];
  const axes: VariantAxis[] = [];
  const colors = cleanValues(product.colors);
  if (colors.length > 0) {
    axes.push({
      id: RESERVED_AXIS_COLOR,
      labels: { ar: COLOR_AXIS_LABELS.ar, en: COLOR_AXIS_LABELS.en },
      values: colors,
    });
  }
  const sizes = cleanValues(product.sizes);
  if (sizes.length > 0) {
    axes.push({
      id: RESERVED_AXIS_SIZE,
      labels: { ar: SIZE_AXIS_LABELS.ar, en: SIZE_AXIS_LABELS.en },
      values: sizes,
    });
  }
  axes.push(...extraAxesFromProduct(product));
  return axes;
}

/** Color axis from a raw catalog list — wrapper helper for legacy color APIs. */
export function colorAxisFromValues(
  values: string[] | null | undefined
): VariantAxis | null {
  const colors = cleanValues(values);
  if (colors.length === 0) return null;
  return {
    id: RESERVED_AXIS_COLOR,
    labels: { ar: COLOR_AXIS_LABELS.ar, en: COLOR_AXIS_LABELS.en },
    values: colors,
  };
}

/** Size axis from a raw catalog list — wrapper helper for legacy size APIs. */
export function sizeAxisFromValues(
  values: string[] | null | undefined
): VariantAxis | null {
  const sizes = cleanValues(values);
  if (sizes.length === 0) return null;
  return {
    id: RESERVED_AXIS_SIZE,
    labels: { ar: SIZE_AXIS_LABELS.ar, en: SIZE_AXIS_LABELS.en },
    values: sizes,
  };
}

export function axisById(
  product: Product | null | undefined,
  id: VariantAxisId
): VariantAxis | null {
  if (!id) return null;
  return effectiveAxes(product).find((axis) => axis.id === id) || null;
}

export function isAxisActive(
  product: Product | null | undefined,
  id: VariantAxisId
): boolean {
  return axisById(product, id) !== null;
}

export function missingAxes(
  product: Product | null | undefined,
  selection: VariantSelection | null | undefined
): VariantAxis[] {
  const selected = selection || {};
  return effectiveAxes(product).filter(
    (axis) => !selectionInCatalog(axis, selected[axis.id])
  );
}

export function selectionFromEntities(entities: {
  color?: string | null;
  size?: string | null;
  variants?: Record<string, string> | null;
} | null | undefined): VariantSelection {
  const out: VariantSelection = { ...(entities?.variants || {}) };
  if (typeof entities?.color === 'string' && entities.color.trim()) {
    out[RESERVED_AXIS_COLOR] = entities.color.trim();
  }
  if (typeof entities?.size === 'string' && entities.size.trim()) {
    out[RESERVED_AXIS_SIZE] = entities.size.trim();
  }
  return out;
}

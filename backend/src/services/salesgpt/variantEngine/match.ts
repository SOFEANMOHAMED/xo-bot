/**
 * Catalog-value matching — no intent keyword lists.
 * Color axis may use color-options aliases (value ↔ option), not sentence scan.
 */
import { matchColorOption } from '../../../catalog/color-options.js';
import { RESERVED_AXIS_COLOR, type VariantAxis } from './types.js';

export function normalizeVariantToken(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u0652]/g, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[!,.،؟?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripLeadingAl(value: string): string {
  return value.replace(/^ال/, '');
}

export function tokenizeVariantText(text: string): string[] {
  return normalizeVariantToken(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

export function valuesEqual(a: string, b: string): boolean {
  const na = stripLeadingAl(normalizeVariantToken(a));
  const nb = stripLeadingAl(normalizeVariantToken(b));
  return na.length > 0 && na === nb;
}

/** True when value is an exact catalog option (color axis: alias/compound adapter). */
export function selectionInCatalog(
  axis: VariantAxis,
  value: string | null | undefined
): boolean {
  if (value === null || value === undefined) return false;
  const text = String(value).trim();
  if (!text) return false;
  if (axis.values.some((option) => valuesEqual(option, text))) return true;
  if (axis.id === RESERVED_AXIS_COLOR) {
    return matchColorOption(text, axis.values).matched !== null;
  }
  return false;
}

export function matchCatalogValue(
  axis: VariantAxis,
  raw: string
): string | null {
  const text = raw.trim();
  if (!text) return null;
  for (const option of axis.values) {
    if (valuesEqual(option, text)) return option;
  }
  // Color aliases only on a single token — never scan a longer remainder (P1-2).
  if (axis.id === RESERVED_AXIS_COLOR && tokenizeVariantText(text).length === 1) {
    return matchColorOption(text, axis.values).matched;
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Strip courtesy / want-verbs / the axis label we printed — not intent lexemes. */
export function stripSelectionPadding(text: string, axis: VariantAxis): string {
  const labels = [axis.labels.ar, axis.labels.en]
    .filter(Boolean)
    .map(escapeRegExp)
    .join('|');
  let out = text.replace(/[\u064B-\u0652]/g, '');
  out = out.replace(/لو سمحت|من فضلك|please|thanks|thank you|شكرا(?:ً| لك)?/gi, ' ');
  out = out.replace(
    /(?:^|\s)(?:بدي|بغي|أبي|ابي|أبغى|ابغى|أريد|اريد|أبا|ابا)(?=\s|$)/gi,
    ' '
  );
  if (labels) {
    out = out.replace(new RegExp(`(?:^|\\s)(?:${labels})(?=\\s|$)`, 'gi'), ' ');
  }
  return out.replace(/[?!؟.,،]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Catalog-only remainder match. Whole leftover must be one option or index.
 * No photo / dispute gates — callers add those.
 */
export function extractBareCatalogAnswer(
  message: string,
  axis: VariantAxis
): string | null {
  if (!message?.trim() || !axis.values.length) return null;
  const padded = stripSelectionPadding(message, axis);
  if (!padded) return null;
  const tokens = tokenizeVariantText(padded);
  if (tokens.length === 0 || tokens.length > 3) return null;

  const numeric = extractNumericAxisChoice(padded, axis);
  if (numeric) return numeric;

  const asOne = matchCatalogValue(axis, padded);
  if (asOne) return asOne;

  if (tokens.length === 1) {
    return matchCatalogValue(axis, tokens[0]);
  }

  return null;
}

/** Index 1-based against axis.values — "2", "رقم 2", "{label} 2". */
export function extractNumericAxisChoice(
  text: string,
  axis: VariantAxis
): string | null {
  if (!text?.trim() || axis.values.length === 0) return null;
  const t = text.trim();
  const pure = t.match(/^(\d{1,2})$/);
  if (pure) {
    const idx = parseInt(pure[1], 10) - 1;
    if (idx >= 0 && idx < axis.values.length) return axis.values[idx];
  }
  const labelBits = [axis.labels.ar, axis.labels.en]
    .filter((s) => typeof s === 'string' && s.trim())
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const extra = labelBits.length ? `|${labelBits.join('|')}` : '';
  const labeled = t.match(
    new RegExp(
      `(?:رقم|الخيار|option|number|#|no\\.?${extra})\\s*(\\d{1,2})\\s*[).]?$`,
      'i'
    )
  );
  if (labeled) {
    const idx = parseInt(labeled[1], 10) - 1;
    if (idx >= 0 && idx < axis.values.length) return axis.values[idx];
  }
  return null;
}

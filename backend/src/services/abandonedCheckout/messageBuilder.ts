import {
  DEFAULT_PRODUCT_INTEREST_TEMPLATE_AR,
  DEFAULT_REMINDER_TEMPLATE_AR,
} from './constants.js';

export interface ReminderMessageContext {
  name: string;
  productName?: string | null;
  customTemplate?: string | null;
}

/**
 * Build a gentle abandoned-checkout reminder.
 * Placeholders: {name}, {product}, {product_clause}
 */
export function buildAbandonedReminderMessage(ctx: ReminderMessageContext): string {
  const name = (ctx.name || '').trim() || 'عميلنا العزيز';
  const product = (ctx.productName || '').trim();
  const productClause = product ? ` لـ «${product}»` : '';

  const template = (ctx.customTemplate || '').trim() || DEFAULT_REMINDER_TEMPLATE_AR;

  return template
    .replaceAll('{name}', name)
    .replaceAll('{product_clause}', productClause)
    .replaceAll('{product}', product || 'طلبك')
    .trim();
}

export interface ProductInterestMessageContext {
  name: string;
  productName: string;
  /** Benefit lines grounded in catalog description only */
  benefits: string[];
  priceLabel?: string | null;
  customTemplate?: string | null;
}

/** Split catalog description into short benefit lines — never invents copy. */
export function extractBenefitsFromDescription(
  description: string | null | undefined,
  max = 3
): string[] {
  if (!description?.trim()) return [];
  const plain = description
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return [];

  const parts = plain
    .split(/(?<=[.!?؟。])\s+|\n+|•|-\s+/)
    .map((p) => p.replace(/^[\s•\-\d.)]+/, '').trim())
    .filter((p) => p.length >= 12 && p.length <= 180);

  const unique: string[] = [];
  for (const part of parts) {
    if (unique.some((u) => u === part)) continue;
    unique.push(part);
    if (unique.length >= max) break;
  }
  if (unique.length === 0 && plain.length >= 12) {
    unique.push(plain.slice(0, 160).trim());
  }
  return unique;
}

/**
 * Product-interest reminder grounded in catalog facts.
 * Placeholders: {name}, {product}, {benefits}, {benefits_block}, {price}, {price_line}
 */
export function buildProductInterestReminderMessage(
  ctx: ProductInterestMessageContext
): string {
  const name = (ctx.name || '').trim() || 'عميلنا العزيز';
  const product = (ctx.productName || '').trim() || 'المنتج';
  const benefits = (ctx.benefits || []).map((b) => b.trim()).filter(Boolean);
  const benefitsText = benefits.join(' — ');
  const benefitsBlock = benefits.length
    ? benefits.map((b) => `• ${b}`).join('\n') + '\n'
    : '';
  const price = (ctx.priceLabel || '').trim();
  const priceLine = price ? `السعر: ${price}\n` : '';

  const template =
    (ctx.customTemplate || '').trim() || DEFAULT_PRODUCT_INTEREST_TEMPLATE_AR;

  return template
    .replaceAll('{name}', name)
    .replaceAll('{product}', product)
    .replaceAll('{benefits}', benefitsText)
    .replaceAll('{benefits_block}', benefitsBlock)
    .replaceAll('{price}', price || '')
    .replaceAll('{price_line}', priceLine)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

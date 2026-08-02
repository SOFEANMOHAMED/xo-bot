import {
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

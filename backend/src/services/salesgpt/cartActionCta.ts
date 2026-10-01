/**
 * Single CTA used after cart sync / variant update / line removal.
 */
import type { Language } from '../../core/types.js';

export function buildCartActionCta(language: Language): string {
  return language === 'arabic'
    ? 'نقدر نضيف منتج ثاني، أو نكمّل الطلب؟'
    : 'We can add another product, or finish the order.';
}

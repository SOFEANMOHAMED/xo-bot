/**
 * Product Renderer
 * Renders a list of products using productFormatter only
 * No AI logic or formatting allowed here
 */

import { formatProduct, type ProductLike } from './productFormatter.js';

export function renderProducts(
  products: ProductLike[],
  currency: string,
  maxProducts: number = 5,
  language: 'arabic' | 'english' = 'arabic'
): string {
  if (!products || products.length === 0) {
    return '';
  }

  return products
    .slice(0, maxProducts)
    .map((product, index) => formatProduct(index + 1, product, currency, language))
    .join('\n\n');
}

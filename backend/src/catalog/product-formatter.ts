/**
 * Product Formatter - Single source of truth for product display
 * No AI formatting allowed - deterministic output
 */

import type { Product, Language } from '../core/types.js';
import { getCurrencyDisplayName } from '../utils/currencyDisplayName.js';
import { formatColorOptionsForDisplay } from './color-options.js';

// ==================== TYPES ====================

export interface FormatOptions {
  language: Language;
  currency: string;
  showStock: boolean;
  showDescription: boolean;
  maxDescriptionLength: number;
}

const DEFAULT_OPTIONS: FormatOptions = {
  language: 'arabic',
  currency: 'USD',
  showStock: true,
  showDescription: true,
  maxDescriptionLength: 80
};

// ==================== SINGLE PRODUCT FORMATTING ====================

/**
 * Format single product for display
 */
export const formatProduct = (
  index: number,
  product: Product,
  options: Partial<FormatOptions> = {}
): string => {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { language, currency, showStock, showDescription, maxDescriptionLength } = opts;

  const name = product.name?.trim() || (language === 'arabic' ? 'منتج' : 'Product');
  const price = product.price ?? 0;
  const currencyLabel = getCurrencyDisplayName(currency, language === 'arabic' ? 'arabic' : 'english');

  let result = `${index}- **${name}**\n`;
  result += language === 'arabic'
    ? `- **السعر:** ${price} ${currencyLabel}`
    : `- **Price:** ${price} ${currencyLabel}`;

  // Description
  if (showDescription && product.description) {
    const description = product.description
      .replace(/<[^>]*>/g, '')
    //  .trim()
      .substring(0, maxDescriptionLength);

    result += language === 'arabic'
      ? `\n- **الوصف:** ${description}`
      : `\n- **Description:** ${description}`;
  }

  // Sizes
  if (product.sizes && product.sizes.length > 0) {
    const sizesStr = product.sizes.join(', ');
    result += language === 'arabic'
      ? `\n- 📏 **المقاسات:** ${sizesStr}`
      : `\n- 📏 **Sizes:** ${sizesStr}`;
  }

  // Colors — each array entry is one sellable option (may be compound e.g. أسود وبني)
  if (product.colors && product.colors.length > 0) {
    const colorsStr = formatColorOptionsForDisplay(
      product.colors,
      language === 'english' ? 'english' : 'arabic'
    );
    result += language === 'arabic'
      ? `\n- 🎨 **خيارات الألوان:** ${colorsStr}`
      : `\n- 🎨 **Color options:** ${colorsStr}`;
  }

  // Stock
  if (showStock) {
    const stock = product.stock ?? 0;
    if (stock <= 0) {
      result += language === 'arabic'
        ? `\n- **المخزون:** ✗ غير متوفر حالياً`
        : `\n- **Stock:** ✗ Currently unavailable`;
    } else if (stock < 5) {
      result += language === 'arabic'
        ? `\n- **المخزون:** ⚠️ سارع بالطلب، الكمية محدودة! (${stock} قطع متبقية)`
        : `\n- **Stock:** ⚠️ Hurry, limited quantity! (${stock} left)`;
    } else {
      result += language === 'arabic'
        ? `\n- **المخزون:** ✓ متوفر (${stock} قطعة)`
        : `\n- **Stock:** ✓ Available (${stock} units)`;
    }
  }

  return result;
};

// ==================== MULTIPLE PRODUCTS FORMATTING ====================

/**
 * Format multiple products for display
 */
export const formatProducts = (
  products: Product[],
  options: Partial<FormatOptions> = {},
  maxProducts: number = 5
): string => {
  if (!products || products.length === 0) {
    return '';
  }

  const productsToShow = products.slice(0, maxProducts);
  const formatted = productsToShow.map((product, index) =>
    formatProduct(index + 1, product, options)
  );

  let result = formatted.join('\n\n');

  // Add "and more" if there are more products
  if (products.length > maxProducts) {
    const remaining = products.length - maxProducts;
    const opts = { ...DEFAULT_OPTIONS, ...options };
    result += opts.language === 'arabic'
      ? `\n\n📦 وغيرها ${remaining} منتج آخر...`
      : `\n\n📦 And ${remaining} more products...`;
  }

  return result;
};

// ==================== QUICK FORMAT ====================

/**
 * Quick format for inline mention (name + price only)
 */
export const formatProductQuick = (
  product: Product,
  currency: string = 'USD',
  language: Language = 'arabic'
): string => {
  const name = product.name?.trim() || 'Product';
  const price = product.price ?? 0;
  const currencyLabel = getCurrencyDisplayName(currency, language === 'arabic' ? 'arabic' : 'english');
  return `${name} (${price} ${currencyLabel})`;
};

/**
 * Format product list as simple comma-separated names
 */
export const formatProductNames = (
  products: Product[],
  language: Language = 'arabic',
  maxProducts: number = 3
): string => {
  if (!products || products.length === 0) return '';

  const names = products.slice(0, maxProducts).map(p => p.name?.trim() || 'Product');
  const separator = language === 'arabic' ? ' و ' : ' and ';

  if (products.length > maxProducts) {
    const remaining = products.length - maxProducts;
    const moreText = language === 'arabic'
      ? ` وغيرها (${remaining} منتج)`
      : ` and more (${remaining} products)`;
    return names.join(separator) + moreText;
  }

  return names.join(separator);
};

// ==================== PRODUCT CARD ====================

/**
 * Format product as a card for messaging platforms
 */
export const formatProductCard = (
  product: Product,
  options: Partial<FormatOptions> = {}
): string => {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { language, currency } = opts;
  const currencyLabel = getCurrencyDisplayName(currency, language === 'arabic' ? 'arabic' : 'english');

  const name = product.name?.trim() || 'Product';
  const price = product.price ?? 0;
  const stock = product.stock ?? 0;

  const stockEmoji = stock > 0 ? '✓' : '✗';
  const stockText = language === 'arabic'
    ? (stock > 0 ? 'متوفر' : 'غير متوفر')
    : (stock > 0 ? 'Available' : 'Unavailable');

  return `┌─────────────────┐
│ **${name}**
│ 💰 ${price} ${currencyLabel}
│ ${stockEmoji} ${stockText}
└─────────────────┘`;
};

// ==================== RENDER PRODUCTS (Legacy Compatible) ====================

/**
 * Render products - compatible with existing productRenderer
 */
export const renderProducts = (
  products: Product[],
  currency: string = 'USD',
  maxProducts: number = 5,
  language: Language = 'arabic'
): string => {
  return formatProducts(products, { currency, language }, maxProducts);
};

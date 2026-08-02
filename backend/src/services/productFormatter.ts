/**
 * Product Formatter
 * Single Source of Truth for product display formatting
 * No AI formatting allowed
 */

import { getCurrencyDisplayName } from '../utils/currencyDisplayName.js';

export interface ProductVariant {
  option1?: string | null; // e.g., "Large" (Size)
  option2?: string | null; // e.g., "Red" (Color)
  option3?: string | null; // e.g., "Cotton" (Material)
  inventory_quantity?: number;
}

export interface ProductOption {
  name: string; // e.g., "Size", "Color"
  values: string[]; // e.g., ["Small", "Medium", "Large"]
}

export interface ProductLike {
  id?: string;
  name?: string;
  price?: number;
  description?: string;
  sizes?: string[];
  stock?: number;
  inventory_quantity?: number; // For low stock warning
  imageUrl?: string | null;
  variants?: ProductVariant[];
  options?: ProductOption[];
  colors?: string[]; // Direct colors array if available
}

/**
 * Extract unique sizes from variants or options
 */
function extractSizes(product: ProductLike): string[] {
  const sizesSet = new Set<string>();

  // From direct sizes array
  if (product.sizes && Array.isArray(product.sizes)) {
    product.sizes.forEach(size => {
      if (size && size.trim()) sizesSet.add(size.trim());
    });
  }

  // From variants (option1 is typically size)
  if (product.variants && Array.isArray(product.variants)) {
    product.variants.forEach(variant => {
      if (variant.option1 && variant.option1.trim()) {
        sizesSet.add(variant.option1.trim());
      }
    });
  }

  // From options (find option named "Size" or similar)
  if (product.options && Array.isArray(product.options)) {
    product.options.forEach(option => {
      const optionName = option.name?.toLowerCase() || '';
      if (optionName.includes('size') || optionName.includes('مقاس') || optionName.includes('حجم')) {
        if (option.values && Array.isArray(option.values)) {
          option.values.forEach(value => {
            if (value && value.trim()) sizesSet.add(value.trim());
          });
        }
      }
    });
  }

  return Array.from(sizesSet);
}

/**
 * Extract unique colors from variants or options
 */
function extractColors(product: ProductLike): string[] {
  const colorsSet = new Set<string>();

  // From direct colors array
  if (product.colors && Array.isArray(product.colors)) {
    product.colors.forEach(color => {
      if (color && color.trim()) colorsSet.add(color.trim());
    });
  }

  // From variants (option2 is typically color)
  if (product.variants && Array.isArray(product.variants)) {
    product.variants.forEach(variant => {
      if (variant.option2 && variant.option2.trim()) {
        colorsSet.add(variant.option2.trim());
      }
    });
  }

  // From options (find option named "Color" or similar)
  if (product.options && Array.isArray(product.options)) {
    product.options.forEach(option => {
      const optionName = option.name?.toLowerCase() || '';
      if (optionName.includes('color') || optionName.includes('لون') || optionName.includes('ألوان')) {
        if (option.values && Array.isArray(option.values)) {
          option.values.forEach(value => {
            if (value && value.trim()) colorsSet.add(value.trim());
          });
        }
      }
    });
  }

  return Array.from(colorsSet);
}

/**
 * Get minimum inventory quantity from variants or product stock
 */
function getMinInventory(product: ProductLike): number | null {
  // Check direct inventory_quantity
  if (product.inventory_quantity !== undefined && product.inventory_quantity !== null) {
    return product.inventory_quantity;
  }

  // Check stock
  if (product.stock !== undefined && product.stock !== null) {
    return product.stock;
  }

  // Check variants inventory
  if (product.variants && Array.isArray(product.variants) && product.variants.length > 0) {
    const variantInventories = product.variants
      .map(v => v.inventory_quantity)
      .filter(qty => qty !== undefined && qty !== null) as number[];
    
    if (variantInventories.length > 0) {
      return Math.min(...variantInventories);
    }
  }

  return null;
}

/**
 * Format a single product for display
 * Format:
 *   1- **اسم المنتج**
 *   - **السعر:** X (اسم العملة وليس الرمز فقط)
 *   - **الوصف:** وصف قصير
 *   - 📏 **المقاسات:** (إن وجدت)
 *   - 🎨 **الألوان:** (إن وجدت)
 *   - **المخزون:** (إن وجد)
 */
export function formatProduct(
  index: number,
  product: ProductLike,
  currency: string,
  language: 'arabic' | 'english' = 'arabic'
): string {
  const name = product.name?.trim() || (language === 'arabic' ? 'منتج' : 'Product');
  const price = product.price ?? 0;
  const currencyLabel = getCurrencyDisplayName(currency, language === 'arabic' ? 'arabic' : 'english');
  const description = product.description
    ? product.description.replace(/<[^>]*>/g, '').trim().substring(0, 80)
    : language === 'arabic' ? 'منتج مميز' : 'Quality product';

  if (language === 'english') {
    let result = `${index}- **${name}**\n- **Price:** ${price} ${currencyLabel}\n- **Description:** ${description}`;
    const sizes = extractSizes(product);
    if (sizes.length > 0) {
      result += `\n- 📏 **Sizes:** ${sizes.join(', ')}`;
    }
    const colors = extractColors(product);
    if (colors.length > 0) {
      result += `\n- 🎨 **Colors:** ${colors.join(', ')}`;
    }
    const minInventory = getMinInventory(product);
    if (minInventory !== null) {
      if (minInventory <= 0) {
        result += `\n- **Stock:** ✗ Currently unavailable`;
      } else if (minInventory < 5) {
        result += `\n- **Stock:** ⚠️ Low stock! Only ${minInventory} left`;
      } else {
        result += `\n- **Stock:** ✓ Available (${minInventory} units)`;
      }
    }
    return result;
  }

  let result = `${index}- **${name}**\n- **السعر:** ${price} ${currencyLabel}\n- **الوصف:** ${description}`;

  const sizes = extractSizes(product);
  if (sizes.length > 0) {
    result += `\n- 📏 **المقاسات:** ${sizes.join(', ')}`;
  }

  const colors = extractColors(product);
  if (colors.length > 0) {
    result += `\n- 🎨 **الألوان:** ${colors.join(', ')}`;
  }

  const minInventory = getMinInventory(product);
  if (minInventory !== null) {
    if (minInventory <= 0) {
      result += `\n- **المخزون:** ✗ غير متوفر حالياً`;
    } else if (minInventory < 5) {
      result += `\n- **المخزون:** ⚠️ سارع بالطلب، الكمية محدودة جداً! (${minInventory} قطع متبقية)`;
    } else {
      result += `\n- **المخزون:** ✓ متوفر (${minInventory} قطعة)`;
    }
  }

  return result;
}

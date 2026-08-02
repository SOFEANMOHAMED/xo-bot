/**
 * Pricing Logic - Handle pricing, discounts, and promotions
 * Supports dynamic pricing for SaaS
 */

import type { Product, Language } from '../core/types.js';
import { logger } from '../utils/logger.js';
import { getCurrencyDisplayName } from '../utils/currencyDisplayName.js';

// ==================== TYPES ====================

export interface PriceBreakdown {
  originalPrice: number;
  finalPrice: number;
  discount: number;
  discountPercentage: number;
  currency: string;
  appliedPromotion?: string;
}

export interface DiscountRule {
  id: string;
  type: 'percentage' | 'fixed' | 'quantity';
  value: number;
  minQuantity?: number;
  minOrderValue?: number;
  maxDiscount?: number;
  validUntil?: Date;
  productIds?: string[];
  categories?: string[];
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface CartPricing {
  items: Array<{
    product: Product;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    discount: number;
  }>;
  subtotal: number;
  totalDiscount: number;
  shippingCost: number;
  grandTotal: number;
  currency: string;
}

// ==================== DISCOUNT CALCULATION ====================

/**
 * Calculate discount for a product
 */
export const calculateProductDiscount = (
  product: Product,
  quantity: number = 1,
  discountRules: DiscountRule[] = []
): PriceBreakdown => {
  const originalPrice = product.price * quantity;
  let discount = 0;
  let appliedPromotion: string | undefined;

  for (const rule of discountRules) {
    // Check if rule applies to this product
    if (rule.productIds && !rule.productIds.includes(product.id)) {
      continue;
    }

    if (rule.categories && product.category && !rule.categories.includes(product.category)) {
      continue;
    }

    // Check validity
    if (rule.validUntil && new Date() > rule.validUntil) {
      continue;
    }

    // Check minimum quantity
    if (rule.minQuantity && quantity < rule.minQuantity) {
      continue;
    }

    // Check minimum order value
    if (rule.minOrderValue && originalPrice < rule.minOrderValue) {
      continue;
    }

    // Calculate discount based on type
    let ruleDiscount = 0;
    switch (rule.type) {
      case 'percentage':
        ruleDiscount = originalPrice * (rule.value / 100);
        break;
      case 'fixed':
        ruleDiscount = rule.value;
        break;
      case 'quantity':
        // Buy X get Y% off
        if (quantity >= (rule.minQuantity || 1)) {
          ruleDiscount = originalPrice * (rule.value / 100);
        }
        break;
    }

    // Apply max discount limit
    if (rule.maxDiscount && ruleDiscount > rule.maxDiscount) {
      ruleDiscount = rule.maxDiscount;
    }

    // Use the best discount
    if (ruleDiscount > discount) {
      discount = ruleDiscount;
      appliedPromotion = rule.id;
    }
  }

  const finalPrice = Math.max(0, originalPrice - discount);
  const discountPercentage = originalPrice > 0 ? (discount / originalPrice) * 100 : 0;

  return {
    originalPrice,
    finalPrice,
    discount,
    discountPercentage: Math.round(discountPercentage * 10) / 10,
    currency: product.currency,
    appliedPromotion
  };
};

/**
 * Calculate cart total with discounts
 */
export const calculateCartPricing = (
  items: CartItem[],
  discountRules: DiscountRule[] = [],
  shippingCost: number = 0
): CartPricing => {
  const pricedItems = items.map(item => {
    const breakdown = calculateProductDiscount(item.product, item.quantity, discountRules);
    return {
      product: item.product,
      quantity: item.quantity,
      unitPrice: item.product.price,
      lineTotal: breakdown.finalPrice,
      discount: breakdown.discount
    };
  });

  const subtotal = pricedItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const totalDiscount = pricedItems.reduce((sum, item) => sum + item.discount, 0);
  const grandTotal = subtotal - totalDiscount + shippingCost;

  return {
    items: pricedItems,
    subtotal,
    totalDiscount,
    shippingCost,
    grandTotal: Math.max(0, grandTotal),
    currency: items[0]?.product.currency || 'USD'
  };
};

// ==================== PRICE FORMATTING ====================

/**
 * Format price for display
 */
export const formatPrice = (
  amount: number,
  currency: string,
  language: Language = 'arabic'
): string => {
  // Round to 2 decimal places
  const rounded = Math.round(amount * 100) / 100;
  const label = getCurrencyDisplayName(currency, language === 'arabic' ? 'arabic' : 'english');

  if (language === 'arabic') {
    return `${rounded} ${label}`;
  }

  return `${label} ${rounded}`;
};

/**
 * Format price breakdown for display
 */
export const formatPriceBreakdown = (
  breakdown: PriceBreakdown,
  language: Language = 'arabic'
): string => {
  const { originalPrice, finalPrice, discount, discountPercentage, currency } = breakdown;
  const label = getCurrencyDisplayName(currency, language === 'arabic' ? 'arabic' : 'english');

  if (discount === 0) {
    return formatPrice(finalPrice, currency, language);
  }

  if (language === 'arabic') {
    return `~~${originalPrice} ${label}~~ → **${finalPrice} ${label}** (خصم ${discountPercentage}%)`;
  }

  return `~~${label} ${originalPrice}~~ → **${label} ${finalPrice}** (${discountPercentage}% off)`;
};

// ==================== SHIPPING PRICING ====================

export interface ShippingRate {
  city: string;
  cost: number;
  estimatedDays: string;
  freeThreshold?: number;
}

/**
 * Calculate shipping cost
 */
export const calculateShippingCost = (
  city: string | undefined,
  orderTotal: number,
  shippingRates: ShippingRate[] = []
): { cost: number; estimatedDays: string; isFree: boolean } => {
  // Default shipping
  const defaultCost = 5000; // Default shipping cost
  const defaultDays = '2-3 أيام';

  if (!city) {
    return { cost: defaultCost, estimatedDays: defaultDays, isFree: false };
  }

  // Find matching rate
  const rate = shippingRates.find(r => 
    r.city.toLowerCase() === city.toLowerCase()
  );

  if (!rate) {
    return { cost: defaultCost, estimatedDays: defaultDays, isFree: false };
  }

  // Check free shipping threshold
  if (rate.freeThreshold && orderTotal >= rate.freeThreshold) {
    return { cost: 0, estimatedDays: rate.estimatedDays, isFree: true };
  }

  return { cost: rate.cost, estimatedDays: rate.estimatedDays, isFree: false };
};

// ==================== PRICE COMPARISON ====================

/**
 * Compare prices and suggest best value
 */
export const comparePrices = (
  products: Product[]
): { cheapest: Product; mostExpensive: Product; average: number } | null => {
  if (products.length === 0) return null;

  const sorted = [...products].sort((a, b) => a.price - b.price);
  const average = products.reduce((sum, p) => sum + p.price, 0) / products.length;

  return {
    cheapest: sorted[0],
    mostExpensive: sorted[sorted.length - 1],
    average: Math.round(average * 100) / 100
  };
};

/**
 * Get cheaper alternatives
 */
export const getCheaperAlternatives = (
  product: Product,
  allProducts: Product[],
  maxResults: number = 3
): Product[] => {
  return allProducts
    .filter(p => 
      p.id !== product.id && 
      p.price < product.price && 
      p.stock > 0
    )
    .sort((a, b) => b.price - a.price) // Most expensive of cheaper first
    .slice(0, maxResults);
};

// ==================== OBJECTION HANDLING PRICES ====================

/**
 * Generate price objection response data
 */
export const handlePriceObjection = (
  product: Product,
  allProducts: Product[],
  language: Language = 'arabic'
): {
  hasCheaperOptions: boolean;
  cheaperProducts: Product[];
  valueProposition: string;
} => {
  const cheaper = getCheaperAlternatives(product, allProducts, 3);
  
  const valueProposition = language === 'arabic'
    ? `${product.name} يتميز بجودة عالية وضمان كامل. نوفر أيضاً الدفع عند الاستلام.`
    : `${product.name} features high quality and full warranty. We also offer cash on delivery.`;

  return {
    hasCheaperOptions: cheaper.length > 0,
    cheaperProducts: cheaper,
    valueProposition
  };
};

/**
 * Calculate potential savings
 */
export const calculateSavings = (
  originalProduct: Product,
  alternativeProduct: Product
): { amount: number; percentage: number } => {
  const amount = originalProduct.price - alternativeProduct.price;
  const percentage = (amount / originalProduct.price) * 100;

  return {
    amount: Math.round(amount * 100) / 100,
    percentage: Math.round(percentage * 10) / 10
  };
};

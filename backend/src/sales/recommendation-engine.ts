/**
 * Recommendation Engine - Smart product recommendations
 * No AI needed - pure algorithmic logic
 */

import type { Product, RecommendationStrategy } from '../core/types.js';
import { logger } from '../utils/logger.js';

// ==================== TYPES ====================

export interface RecommendationInput {
  products: Product[];
  strategy: RecommendationStrategy;
  budget?: number;
  preferredCategory?: string;
  excludeProductIds?: string[];
  limit?: number;
}

export interface RecommendationResult {
  products: Product[];
  strategy: RecommendationStrategy;
  reason: string;
}

// ==================== SCORING FUNCTIONS ====================

/**
 * Score product for relevance
 */
const scoreProduct = (
  product: Product,
  query?: string,
  budget?: number
): number => {
  let score = 0;

  // Stock availability (high priority)
  if (product.stock > 0) {
    score += 50;
    if (product.stock > 10) score += 10;
  }

  // Price within budget
  if (budget && product.price <= budget) {
    score += 30;
    // Closer to budget = better value perception
    const budgetRatio = product.price / budget;
    if (budgetRatio > 0.7) score += 10;
  }

  // Query match (if provided)
  if (query && product.name) {
    const queryLower = query.toLowerCase();
    const nameLower = product.name.toLowerCase();
    
    if (nameLower.includes(queryLower)) {
      score += 40;
    } else if (queryLower.split(' ').some(word => nameLower.includes(word))) {
      score += 20;
    }
  }

  return score;
};

// ==================== RECOMMENDATION STRATEGIES ====================

/**
 * Get top sellers (highest stock, newest)
 */
const getTopSellers = (products: Product[], limit: number): Product[] => {
  return [...products]
    .filter(p => p.stock > 0)
    .sort((a, b) => {
      // First by stock
      if (b.stock !== a.stock) return b.stock - a.stock;
      // Then by price (mid-range preferred)
      return 0;
    })
    .slice(0, limit);
};

/**
 * Match products to query
 */
const matchQuery = (products: Product[], query: string, limit: number): Product[] => {
  const scored = products
    .filter(p => p.stock > 0)
    .map(p => ({ product: p, score: scoreProduct(p, query) }))
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(s => s.product);
};

/**
 * Get upsell options (higher value products)
 */
const getUpsellOptions = (
  products: Product[],
  currentProduct: Product,
  limit: number
): Product[] => {
  const currentPrice = currentProduct.price;
  const maxUpsellPrice = currentPrice * 1.5; // Up to 50% more expensive

  return [...products]
    .filter(p => 
      p.stock > 0 &&
      p.id !== currentProduct.id &&
      p.price > currentPrice &&
      p.price <= maxUpsellPrice
    )
    .sort((a, b) => a.price - b.price) // Cheapest upsell first
    .slice(0, limit);
};

/**
 * Get cheaper alternatives
 */
const getCheaperAlternatives = (
  products: Product[],
  currentProduct: Product,
  limit: number
): Product[] => {
  const currentPrice = currentProduct.price;

  return [...products]
    .filter(p => 
      p.stock > 0 &&
      p.id !== currentProduct.id &&
      p.price < currentPrice
    )
    .sort((a, b) => b.price - a.price) // Most expensive of cheaper first
    .slice(0, limit);
};

/**
 * Get best value (balance of price and features)
 */
const getBestValue = (products: Product[], limit: number): Product[] => {
  // Score based on stock availability and mid-range price
  const prices = products.map(p => p.price);
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;

  return [...products]
    .filter(p => p.stock > 0)
    .map(p => ({
      product: p,
      score: 
        (p.stock > 5 ? 30 : 10) + // Stock score
        (Math.abs(p.price - avgPrice) < avgPrice * 0.3 ? 20 : 0) // Mid-range price score
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.product);
};

// ==================== MAIN RECOMMENDATION FUNCTION ====================

/**
 * Get product recommendations based on strategy
 */
export const getRecommendations = (input: RecommendationInput): RecommendationResult => {
  const {
    products,
    strategy,
    budget,
    excludeProductIds = [],
    limit = 5
  } = input;

  // Filter out excluded products
  let availableProducts = products.filter(p => !excludeProductIds.includes(p.id));

  // Filter by budget if provided
  if (budget) {
    availableProducts = availableProducts.filter(p => p.price <= budget);
  }

  if (availableProducts.length === 0) {
    return {
      products: [],
      strategy,
      reason: 'No products match the criteria'
    };
  }

  let recommended: Product[];
  let reason: string;

  switch (strategy) {
    case 'top_sellers':
      recommended = getTopSellers(availableProducts, limit);
      reason = 'Top selling products';
      break;

    case 'match_query':
      recommended = availableProducts.slice(0, limit);
      reason = 'Matching your search';
      break;

    case 'upsell':
      if (availableProducts.length > 0) {
        recommended = getUpsellOptions(products, availableProducts[0], limit);
        reason = 'Premium options you might like';
      } else {
        recommended = [];
        reason = 'No upsell options available';
      }
      break;

    case 'cheaper_alt':
      if (availableProducts.length > 0) {
        recommended = getCheaperAlternatives(products, availableProducts[0], limit);
        reason = 'Budget-friendly alternatives';
      } else {
        recommended = [];
        reason = 'No cheaper alternatives available';
      }
      break;

    case 'best_value':
      recommended = getBestValue(availableProducts, limit);
      reason = 'Best value for your money';
      break;

    default:
      recommended = availableProducts.slice(0, limit);
      reason = 'Recommended for you';
  }

  logger.debug('Recommendations generated', {
    strategy,
    inputCount: products.length,
    outputCount: recommended.length,
    reason
  });

  return {
    products: recommended,
    strategy,
    reason
  };
};

// ==================== RELATED PRODUCTS ====================

/**
 * Get related products (same category, similar price)
 */
export const getRelatedProducts = (
  product: Product,
  allProducts: Product[],
  limit: number = 3
): Product[] => {
  return [...allProducts]
    .filter(p =>
      p.id !== product.id &&
      p.stock > 0 &&
      (
        p.category === product.category ||
        Math.abs(p.price - product.price) < product.price * 0.3
      )
    )
    .sort((a, b) => {
      // Prefer same category
      if (a.category === product.category && b.category !== product.category) return -1;
      if (b.category === product.category && a.category !== product.category) return 1;
      // Then by stock
      return b.stock - a.stock;
    })
    .slice(0, limit);
};

// ==================== FREQUENTLY BOUGHT TOGETHER ====================

/**
 * Simple complementary products logic
 * In a real system, this would use order history
 */
export const getComplementaryProducts = (
  product: Product,
  allProducts: Product[],
  limit: number = 2
): Product[] => {
  // For now, return products from different categories at similar price
  return [...allProducts]
    .filter(p =>
      p.id !== product.id &&
      p.stock > 0 &&
      p.category !== product.category &&
      Math.abs(p.price - product.price) < product.price * 0.5
    )
    .sort((a, b) => b.stock - a.stock)
    .slice(0, limit);
};

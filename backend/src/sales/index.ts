/**
 * Sales Module - Sales rules and recommendations
 */

// ==================== SALES RULES ====================
export {
  planSalesAction
} from './sales-rules.js';

export type {
  SalesPlanInput,
  SalesPlan
} from './sales-rules.js';

// ==================== RECOMMENDATION ENGINE ====================
export {
  getRecommendations,
  getRelatedProducts,
  getComplementaryProducts
} from './recommendation-engine.js';

export type {
  RecommendationInput,
  RecommendationResult
} from './recommendation-engine.js';

// ==================== PRICING LOGIC ====================
export {
  calculateProductDiscount,
  calculateCartPricing,
  formatPrice,
  formatPriceBreakdown,
  calculateShippingCost,
  comparePrices,
  getCheaperAlternatives,
  handlePriceObjection,
  calculateSavings
} from './pricing-logic.js';

export type {
  PriceBreakdown,
  DiscountRule,
  CartItem,
  CartPricing,
  ShippingRate
} from './pricing-logic.js';

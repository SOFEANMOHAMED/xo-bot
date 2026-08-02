/**
 * Catalog Module - Product search and formatting
 */

// ==================== PRODUCT SEARCH ====================
export {
  searchProducts,
  getProductById,
  getTopProducts,
  getProductsOverview,
  getCatalogMeta,
  getMerchantProductKeywords,
  normalizeArabic,
  generateArabicVariations,
  clearProductCache
} from './product-search.js';

export type {
  ProductFilters,
  ProductOverviewRow,
  CatalogMetaSummary
} from './product-search.js';

// ==================== PRODUCT FORMATTER ====================
export {
  formatProduct,
  formatProducts,
  formatProductQuick,
  formatProductNames,
  formatProductCard,
  renderProducts
} from './product-formatter.js';

export type { FormatOptions } from './product-formatter.js';

// ==================== COLOR-AWARE IMAGE RESOLUTION ====================
export {
  resolveProductImageForBot,
  resolveImageSrcForServing,
  fetchProductGallery,
  pickGalleryImageForColor,
  canonicalizeColor,
  colorsMatch,
  extractColorFromText,
  normalizeColorToken
} from './resolve-product-image.js';

export type {
  ProductGalleryImage,
  ResolveProductImageInput,
  ResolveProductImageResult
} from './resolve-product-image.js';

// ==================== CACHE MANAGER ====================
export {
  getCachedData,
  setCachedData,
  clearCache,
  getCacheStats,
  getMerchantCacheKey,
  clearMerchantCache,
  startCacheCleanup
} from './cache-manager.js';

// ==================== STOCK CHECKER ====================
export {
  checkProductStock,
  checkMultipleProductsStock,
  isProductInStock,
  reserveStock,
  releaseStock,
  getLowStockProducts,
  getOutOfStockProducts,
  getStockStatusLabel,
  getStockMessage
} from './stock-checker.js';

export type {
  StockStatus,
  StockCheckResult
} from './stock-checker.js';

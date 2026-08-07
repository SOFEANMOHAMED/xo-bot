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

// ==================== COLOR OPTIONS (compound-safe) ====================
export {
  canonicalizeColor,
  colorsMatch,
  extractColorFromText,
  normalizeColorToken,
  matchColorOption,
  formatColorOptionsForDisplay,
  resolveColorEntity,
  extractAtomicColors,
  isCompoundColorOption
} from './color-options.js';

export type { ColorOptionMatch } from './color-options.js';

// ==================== COLOR-AWARE IMAGE RESOLUTION ====================
export {
  resolveProductImageForBot,
  resolveImageSrcForServing,
  fetchProductGallery,
  pickGalleryImageForColor
} from './resolve-product-image.js';

export type {
  ProductGalleryImage,
  ResolveProductImageInput,
  ResolveProductImageResult
} from './resolve-product-image.js';

// ==================== VISUAL (CLIP) IMAGE EMBEDDINGS ====================
export {
  ensureProductImageEmbeddingsTable,
  embedImageBuffer,
  searchProductsByImageEmbedding,
  searchProductsByImageRef,
  reindexProductImages,
  scheduleProductImageReindex,
  backfillProductImageEmbeddings,
  VISUAL_EMBEDDING_MODEL,
  VISUAL_EMBEDDING_DIMS
} from './visual-embeddings.js';

export type { VisualMatch } from './visual-embeddings.js';

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

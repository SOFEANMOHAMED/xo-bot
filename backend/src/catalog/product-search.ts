/**
 * Product Search - Smart product search with Arabic support
 * Optimized for SaaS with thousands of products
 */

import pool from '../database/connection.js';
import { logger } from '../utils/logger.js';
import type { Product } from '../core/types.js';
import { getCachedData, setCachedData, clearCache } from './cache-manager.js';

// ==================== ARABIC NORMALIZATION ====================

/**
 * Normalize Arabic text for search
 * Removes diacritics, normalizes letters
 */
export const normalizeArabic = (text: string): string => {
  if (!text) return '';

  return text
    // Remove Arabic diacritics (tashkeel)
    .replace(/[\u0617-\u061A\u064B-\u0652]/g, '')
    // Normalize alef variations
    .replace(/[أإآ]/g, 'ا')
    // Normalize taa marbuta
    .replace(/ة/g, 'ه')
    // Normalize alef maksura
    .replace(/ى/g, 'ي')
    // Remove tatweel
    .replace(/ـ/g, '')
    .trim()
    .toLowerCase();
};

/**
 * Generate Arabic word variations (singular/plural)
 */
export const generateArabicVariations = (word: string): string[] => {
  const variations: string[] = [word];
  const normalized = normalizeArabic(word);

  if (normalized.length < 2) return variations;

  // Common Arabic plural patterns
  const pluralPatterns: [RegExp, string][] = [
    [/(.+)ات$/, '$1'],      // ات ending
    [/(.+)ه$/, '$1ات'],     // ه → ات
    [/(.+)ة$/, '$1ات'],     // ة → ات
    [/(.+)ين$/, '$1'],      // ين ending
    [/(.+)ون$/, '$1'],      // ون ending
  ];

  for (const [pattern, replacement] of pluralPatterns) {
    if (pattern.test(normalized)) {
      const variation = normalized.replace(pattern, replacement);
      if (variation !== normalized && variation.length > 1) {
        variations.push(variation);
      }
    }
  }

  return [...new Set(variations)];
};

// ==================== PG_TRGM EXTENSION CHECK ====================

let hasPgTrgm: boolean | null = null;

const checkPgTrgm = async (): Promise<boolean> => {
  if (hasPgTrgm !== null) {
    return hasPgTrgm;
  }

  try {
    const result = await pool.query(
      `SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'`
    );
    hasPgTrgm = result.rows.length > 0;
    if (!hasPgTrgm) {
      logger.warn('pg_trgm extension not installed - trigram fuzzy search disabled. Install with: CREATE EXTENSION pg_trgm;');
    }
    return hasPgTrgm;
  } catch (error) {
    logger.warn('Failed to check pg_trgm extension', { error });
    hasPgTrgm = false;
    return false;
  }
};

// ==================== NORMALIZED COLUMNS CHECK ====================

let hasNormalizedColumns: boolean | null = null;

const checkNormalizedColumns = async (): Promise<boolean> => {
  if (hasNormalizedColumns !== null) {
    return hasNormalizedColumns;
  }

  try {
    const result = await pool.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_name = 'products'
         AND column_name IN ('normalized_name', 'normalized_category')`
    );
    hasNormalizedColumns = result.rows.length === 2;
    return hasNormalizedColumns;
  } catch (error) {
    logger.warn('Failed to check normalized columns', { error });
    hasNormalizedColumns = false;
    return false;
  }
};

// ==================== VARIANTS HELPER ====================

/**
 * Fetch variants for a product (performance-optimized)
 * Only called when has_variants = true
 */
const enrichProductWithVariants = async (
  product: Product,
  merchantId: string
): Promise<Product> => {
  if (!product.has_variants) {
    return product;
  }

  try {
    const variantsResult = await pool.query(
      `SELECT id, sku, title, price, inventory_quantity, option1, option2, option3
       FROM product_variants 
       WHERE product_id = $1 AND merchant_id = $2
       ORDER BY is_default DESC, id
       LIMIT 10`,
      [product.id, merchantId]
    );
    
    if (variantsResult.rows.length > 0) {
      product.variants = variantsResult.rows.map((v: any) => ({
        id: v.id,
        sku: v.sku,
        title: v.title,
        price: parseFloat(v.price),
        inventory_quantity: v.inventory_quantity,
        option1: v.option1,
        option2: v.option2,
        option3: v.option3
      }));

      // Extract options from variants
      const optionsMap = new Map<string, Set<string>>();
      variantsResult.rows.forEach((v: any) => {
        if (v.option1) {
          if (!optionsMap.has('option1')) optionsMap.set('option1', new Set());
          optionsMap.get('option1')!.add(v.option1);
        }
        if (v.option2) {
          if (!optionsMap.has('option2')) optionsMap.set('option2', new Set());
          optionsMap.get('option2')!.add(v.option2);
        }
        if (v.option3) {
          if (!optionsMap.has('option3')) optionsMap.set('option3', new Set());
          optionsMap.get('option3')!.add(v.option3);
        }
      });

      // Build options array
      product.options = Array.from(optionsMap.entries()).map(([key, values]) => ({
        name: key === 'option1' ? 'الخيار الأول' : key === 'option2' ? 'الخيار الثاني' : 'الخيار الثالث',
        values: Array.from(values)
      }));
    }
  } catch (error) {
    logger.warn('Failed to fetch variants', { productId: product.id, error });
  }

  return product;
};

// ==================== SEARCH FUNCTIONS ====================

export interface ProductFilters {
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  inStockOnly?: boolean;
  source?: string;
}

/**
 * Search products with smart matching
 * Uses trigram similarity and Arabic normalization
 */
export const searchProducts = async (
  merchantId: string,
  query: string,
  filters?: ProductFilters,
  limit: number = 5
): Promise<Product[]> => {
  try {
    if (!merchantId) {
      throw new Error('merchantId is required');
    }

    // Check cache first
    const cacheKey = `search:${merchantId}:${query}:${JSON.stringify(filters)}:${limit}`;
    const cached = getCachedData<Product[]>(cacheKey);
    if (cached) {
      logger.debug('Product search cache hit', { merchantId, query });
      return cached;
    }

    const conditions: string[] = ['merchant_id = $1'];
    const values: any[] = [merchantId];
    let paramIndex = 2;

    const useNormalizedColumns = await checkNormalizedColumns();
    const nameExpr = useNormalizedColumns
      ? 'COALESCE(normalized_name, LOWER(TRIM(name)))'
      : 'LOWER(TRIM(name))';
    const categoryExpr = useNormalizedColumns
      ? 'COALESCE(normalized_category, LOWER(TRIM(category)))'
      : 'LOWER(TRIM(category))';

    // Build search conditions
    if (query && query.trim()) {
      const searchTerm = query.trim();
      const normalizedTerm = normalizeArabic(searchTerm);
      const baseTerm = normalizedTerm.replace(/^ال/, '');
      const rawTerm = searchTerm.toLowerCase();
      const rawBase = rawTerm.replace(/^ال/, '');
      const variations = [
        ...generateArabicVariations(normalizedTerm),
        ...generateArabicVariations(baseTerm),
        rawTerm,
        rawBase
      ].filter(v => v && v.length > 1);
      const exactTerms = [...new Set([normalizedTerm, baseTerm, rawTerm, rawBase].filter(v => v && v.length > 1))];

      // --------------------
      // Phase 0: exact match on normalized name (fast path)
      // --------------------
      if (exactTerms.length > 0) {
        const placeholders = exactTerms.map((_, i) => `$${i + 2}`).join(', ');
        const exactSql = `
          SELECT 
            id, name, description, price, currency, category,
            stock, sizes, colors, image_url, external_id, source, handle,
            has_variants
          FROM products
          WHERE merchant_id = $1
            AND (${nameExpr} IN (${placeholders}) OR LOWER(TRIM(name)) IN (${placeholders}))
          ORDER BY stock DESC, created_at DESC
          LIMIT ${limit}
        `;
        const exactValues = [merchantId, ...exactTerms];
        const exactResult = await pool.query(exactSql, exactValues);
        if (exactResult.rows.length > 0) {
          let products: Product[] = exactResult.rows.map(row => ({
            id: row.id,
            name: row.name,
            price: parseFloat(row.price),
            currency: row.currency,
            stock: row.stock,
            sizes: row.sizes || null,
            colors: row.colors || null,
            imageUrl: convertImageUrl(row.image_url, row.id),
            externalId: row.external_id,
            source: row.source,
            description: row.description,
            category: row.category,
            handle: row.handle || null,
            has_variants: row.has_variants || false
          }));

          // 🚀 Enrich with variants if needed
          products = await Promise.all(
            products.map(p => enrichProductWithVariants(p, merchantId))
          );

          setCachedData(cacheKey, products, 5 * 60 * 1000); // 5 min cache
          return products;
        }
      }

      // --------------------
      // Phase 1: strict LIKE matching
      // --------------------
      const strictConditions: string[] = [];
      const strictValues: any[] = [merchantId];
      let strictParamIndex = 2;

      for (const variation of variations) {
        const likeTerm = `%${variation}%`;
        strictConditions.push(
          `(${nameExpr} LIKE $${strictParamIndex} OR 
            LOWER(description) LIKE $${strictParamIndex} OR 
            ${categoryExpr} LIKE $${strictParamIndex} OR
            LOWER(vendor) LIKE $${strictParamIndex} OR
            LOWER(product_type) LIKE $${strictParamIndex})`
        );
        strictValues.push(likeTerm);
        strictParamIndex++;
      }

      // Apply filters to strict phase as well
      const strictFilterConditions: string[] = [];
      if (filters) {
        if (filters.category) {
          strictFilterConditions.push(`${categoryExpr} = LOWER(TRIM($${strictParamIndex}))`);
          strictValues.push(filters.category);
          strictParamIndex++;
        }
        if (filters.minPrice !== undefined) {
          strictFilterConditions.push(`price >= $${strictParamIndex}`);
          strictValues.push(filters.minPrice);
          strictParamIndex++;
        }
        if (filters.maxPrice !== undefined) {
          strictFilterConditions.push(`price <= $${strictParamIndex}`);
          strictValues.push(filters.maxPrice);
          strictParamIndex++;
        }
        if (filters.inStockOnly) {
          strictFilterConditions.push(`stock > 0`);
        }
        if (filters.source) {
          strictFilterConditions.push(`source = $${strictParamIndex}`);
          strictValues.push(filters.source);
          strictParamIndex++;
        }
      }

      const strictWhere = [
        'merchant_id = $1',
        `(${strictConditions.join(' OR ')})`,
        ...strictFilterConditions
      ].join(' AND ');

      const strictSql = `
        SELECT 
          id, name, description, price, currency, category,
          stock, sizes, colors, image_url, external_id, source, handle, has_variants
        FROM products 
        WHERE ${strictWhere}
        ORDER BY stock DESC, created_at DESC
        LIMIT ${limit}
      `;

      const strictResult = await pool.query(strictSql, strictValues);
      if (strictResult.rows.length > 0) {
        let products: Product[] = strictResult.rows.map(row => ({
          id: row.id,
          name: row.name,
          price: parseFloat(row.price),
          currency: row.currency,
          stock: row.stock,
          sizes: row.sizes || null,
          colors: row.colors || null,
          imageUrl: convertImageUrl(row.image_url, row.id),
          externalId: row.external_id,
          source: row.source,
          description: row.description,
          category: row.category,
          handle: row.handle || null,
          has_variants: row.has_variants || false
        }));

        // 🚀 Enrich with variants if needed
        products = await Promise.all(
          products.map(p => enrichProductWithVariants(p, merchantId))
        );

        setCachedData(cacheKey, products, 5 * 60 * 1000); // 5 min cache
        return products;
      }

      // --------------------
      // Phase 2: fuzzy fallback (trigram) only if strict failed
      // --------------------
      const searchConditions: string[] = [];

      for (const variation of variations) {
        const likeTerm = `%${variation}%`;
        searchConditions.push(
          `(${nameExpr} LIKE $${paramIndex} OR 
            LOWER(description) LIKE $${paramIndex} OR 
            ${categoryExpr} LIKE $${paramIndex} OR
            LOWER(vendor) LIKE $${paramIndex} OR
            LOWER(product_type) LIKE $${paramIndex})`
        );
        values.push(likeTerm);
        paramIndex++;
      }

      const words = searchTerm.split(/\s+/).filter(w => w.length > 2);
      if (words.length > 1) {
        for (const word of words) {
          const likeWord = `%${normalizeArabic(word)}%`;
          searchConditions.push(`${nameExpr} LIKE $${paramIndex}`);
          values.push(likeWord);
          paramIndex++;
        }
      }

      // Try trigram similarity if pg_trgm extension is available
      // Falls back gracefully if extension is not installed
      const trgmAvailable = await checkPgTrgm();
      if (trgmAvailable) {
        searchConditions.push(`(${nameExpr} % $${paramIndex} OR ${categoryExpr} % $${paramIndex})`);
        values.push(searchTerm);
        paramIndex++;
      }

      conditions.push(`(${searchConditions.join(' OR ')})`);
    }

    // Apply filters
    if (filters) {
      if (filters.category) {
        conditions.push(`LOWER(category) = LOWER($${paramIndex})`);
        values.push(filters.category);
        paramIndex++;
      }

      if (filters.minPrice !== undefined) {
        conditions.push(`price >= $${paramIndex}`);
        values.push(filters.minPrice);
        paramIndex++;
      }

      if (filters.maxPrice !== undefined) {
        conditions.push(`price <= $${paramIndex}`);
        values.push(filters.maxPrice);
        paramIndex++;
      }

      if (filters.inStockOnly) {
        conditions.push(`stock > 0`);
      }

      if (filters.source) {
        conditions.push(`source = $${paramIndex}`);
        values.push(filters.source);
        paramIndex++;
      }
    }

    // Build ORDER BY
    let orderBy = '';
    if (query && query.trim()) {
      const searchTerm = query.trim().toLowerCase();
      orderBy = `
        ORDER BY 
          CASE 
            WHEN ${nameExpr} = $${paramIndex} THEN 0
            WHEN ${nameExpr} LIKE $${paramIndex + 1} THEN 1
            WHEN ${categoryExpr} = $${paramIndex} THEN 2
            ELSE 3
          END,
          stock DESC,
          created_at DESC
      `;
      values.push(searchTerm);
      values.push(`%${searchTerm}%`);
      paramIndex += 2;
    } else {
      orderBy = 'ORDER BY stock DESC, created_at DESC';
    }

    const sql = `
      SELECT 
        id, name, description, price, currency, category,
        stock, sizes, colors, image_url, external_id, source, handle, has_variants
      FROM products 
      WHERE ${conditions.join(' AND ')}
      ${orderBy}
      LIMIT ${limit}
    `;

    const result = await pool.query(sql, values);

    let products: Product[] = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      price: parseFloat(row.price),
      currency: row.currency,
      stock: row.stock,
      sizes: row.sizes || null,
      colors: row.colors || null,
      imageUrl: convertImageUrl(row.image_url, row.id),
      externalId: row.external_id,
      source: row.source,
      description: row.description,
      category: row.category,
      handle: row.handle || null,
      has_variants: row.has_variants || false
    }));

    // 🚀 Enrich with variants if needed
    products = await Promise.all(
      products.map(p => enrichProductWithVariants(p, merchantId))
    );

    // Cache result
    setCachedData(cacheKey, products, 5 * 60 * 1000); // 5 min cache

    logger.info('Product search completed', {
      merchantId,
      query,
      found: products.length
    });

    return products;
  } catch (error) {
    logger.error('Product search error', error as Error, { merchantId, query });
    throw error;
  }
};

/**
 * Get product by ID
 */
export const getProductById = async (
  merchantId: string,
  productId: string
): Promise<Product | null> => {
  try {
    const cacheKey = `product:${merchantId}:${productId}`;
    const cached = getCachedData<Product>(cacheKey);
    if (cached) return cached;

    const result = await pool.query(
      `SELECT id, name, description, price, currency, category,
              stock, sizes, colors, image_url, external_id, source, handle, has_variants
       FROM products 
       WHERE id = $1 AND merchant_id = $2`,
      [productId, merchantId]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    let product: Product = {
      id: row.id,
      name: row.name,
      price: parseFloat(row.price),
      currency: row.currency,
      stock: row.stock,
      sizes: row.sizes || null,
      colors: row.colors || null,
      imageUrl: convertImageUrl(row.image_url, row.id),
      externalId: row.external_id,
      source: row.source,
      description: row.description,
      category: row.category,
      handle: row.handle || null,
      has_variants: row.has_variants || false
    };

    // 🚀 Enrich with variants if needed
    product = await enrichProductWithVariants(product, merchantId);

    setCachedData(cacheKey, product, 10 * 60 * 1000); // 10 min cache
    return product;
  } catch (error) {
    logger.error('Get product by ID error', error as Error, { merchantId, productId });
    throw error;
  }
};

/**
 * Get top products (fallback when no search query)
 */
export const getTopProducts = async (
  merchantId: string,
  limit: number = 5
): Promise<Product[]> => {
  try {
    const cacheKey = `top:${merchantId}:${limit}`;
    const cached = getCachedData<Product[]>(cacheKey);
    if (cached) return cached;

    const result = await pool.query(
      `SELECT id, name, description, price, currency, category,
              stock, sizes, colors, image_url, external_id, source, handle, has_variants
       FROM products 
       WHERE merchant_id = $1 AND stock > 0
       ORDER BY created_at DESC
       LIMIT $2`,
      [merchantId, limit]
    );

    let products: Product[] = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      price: parseFloat(row.price),
      currency: row.currency,
      stock: row.stock,
      sizes: row.sizes || null,
      colors: row.colors || null,
      imageUrl: convertImageUrl(row.image_url, row.id),
      externalId: row.external_id,
      source: row.source,
      description: row.description,
      category: row.category,
      handle: row.handle || null,
      has_variants: row.has_variants || false
    }));

    // 🚀 Enrich with variants if needed
    products = await Promise.all(
      products.map(p => enrichProductWithVariants(p, merchantId))
    );

    setCachedData(cacheKey, products, 5 * 60 * 1000); // 5 min cache
    return products;
  } catch (error) {
    logger.error('Get top products error', error as Error, { merchantId });
    throw error;
  }
};

/**
 * Get merchant product keywords for AI hints
 */
export const getMerchantProductKeywords = async (merchantId: string): Promise<string[]> => {
  try {
    const cacheKey = `keywords:${merchantId}`;
    const cached = getCachedData<string[]>(cacheKey);
    if (cached) return cached;

    const result = await pool.query(
      `SELECT DISTINCT LOWER(name) as name, LOWER(category) as category
       FROM products WHERE merchant_id = $1 LIMIT 500`,
      [merchantId]
    );

    const keywords: string[] = [];
    result.rows.forEach(row => {
      if (row.name) {
        keywords.push(row.name);
        keywords.push(normalizeArabic(row.name));
        const words = row.name.split(/\s+/).filter((w: string) => w.length > 2);
        keywords.push(...words);
      }
      if (row.category) {
        keywords.push(row.category);
        keywords.push(normalizeArabic(row.category));
      }
    });

    const uniqueKeywords = [...new Set(keywords)].filter(k => k && k.length > 1);
    setCachedData(cacheKey, uniqueKeywords, 15 * 60 * 1000); // 15 min cache

    return uniqueKeywords;
  } catch (error) {
    logger.error('Get merchant keywords error', error as Error, { merchantId });
    return [];
  }
};

// ==================== HELPERS ====================

/**
 * Convert image URL to /api/products/:id/image endpoint
 * ALWAYS use this endpoint for Telegram/external platforms
 * This ensures images are accessible regardless of storage method (base64, /uploads/, HTTP)
 */
const convertImageUrl = (imageUrl: string | null, productId: string): string | null => {
  if (!imageUrl || imageUrl === 'N/A') return null;

  // ALWAYS use /api/products/:id/image endpoint for consistency
  // This endpoint handles all image types and ensures Telegram can access them
  const baseUrl = process.env.BACKEND_URL || process.env.BASE_URL || 'https://xo-bot.com';
  return `${baseUrl}/api/products/${productId}/image`;
};

/**
 * Clear product cache for merchant
 */
export const clearProductCache = (merchantId: string): void => {
  clearCache(`search:${merchantId}:`);
  clearCache(`product:${merchantId}:`);
  clearCache(`top:${merchantId}:`);
  clearCache(`keywords:${merchantId}`);
  clearCache(`overview:${merchantId}:`);
  clearCache(`catalog_meta:${merchantId}`);
  logger.info('Product cache cleared', { merchantId });
};

// ==================== CATALOG OVERVIEW (SaaS-friendly) ====================

/**
 * Compact row used to give the sales agent *awareness* of the catalog
 * without dumping full product records into the prompt.
 *
 * Multi-tenant safe: every query is scoped by merchantId, and the cache
 * key always includes the merchantId.
 */
export interface ProductOverviewRow {
  id: string;
  name: string;
  category: string | null;
  price: number;
  currency: string;
  inStock: boolean;
  hasImage: boolean;
  hasColors: boolean;
  hasSizes: boolean;
}

const OVERVIEW_HARD_LIMIT = 50;

/**
 * Lightweight, token-efficient overview of the merchant's catalog.
 *
 * Designed for hundreds of products per merchant: returns up to
 * `limit` rows ordered by stock availability then recency, so the
 * agent always "knows" what else exists without paying the cost of
 * the full product detail payload.
 */
export const getProductsOverview = async (
  merchantId: string,
  limit: number = 30
): Promise<ProductOverviewRow[]> => {
  if (!merchantId) {
    throw new Error('merchantId is required');
  }
  try {
    const cap = Math.min(Math.max(limit, 1), OVERVIEW_HARD_LIMIT);
    const cacheKey = `overview:${merchantId}:${cap}`;
    const cached = getCachedData<ProductOverviewRow[]>(cacheKey);
    if (cached) return cached;

    const result = await pool.query(
      `SELECT id, name, category, price, currency, stock, image_url,
              sizes, colors, has_variants
         FROM products
        WHERE merchant_id = $1
        ORDER BY (stock > 0) DESC, created_at DESC
        LIMIT $2`,
      [merchantId, cap]
    );

    const rows: ProductOverviewRow[] = result.rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      category: row.category || null,
      price: parseFloat(row.price),
      currency: row.currency,
      inStock: (row.stock || 0) > 0,
      hasImage: Boolean(row.image_url),
      hasColors: Array.isArray(row.colors) ? row.colors.length > 0 : Boolean(row.has_variants),
      hasSizes: Array.isArray(row.sizes) ? row.sizes.length > 0 : Boolean(row.has_variants)
    }));

    // Short TTL: new products propagate quickly even if invalidation
    // is missed somewhere; merchant scoping keeps tenants isolated.
    setCachedData(cacheKey, rows, 60 * 1000);
    return rows;
  } catch (error) {
    logger.error('Get products overview error', error as Error, { merchantId });
    return [];
  }
};

export interface CatalogMetaSummary {
  totalProducts: number;
  inStockProducts: number;
  categories: { name: string; count: number }[];
}

/**
 * Catalog-level metadata: counts and categories. Useful when the
 * catalog is larger than the overview limit so the agent can still
 * answer "how many products do you have?" / "what categories?" without
 * loading everything.
 */
export const getCatalogMeta = async (merchantId: string): Promise<CatalogMetaSummary> => {
  if (!merchantId) {
    throw new Error('merchantId is required');
  }
  try {
    const cacheKey = `catalog_meta:${merchantId}`;
    const cached = getCachedData<CatalogMetaSummary>(cacheKey);
    if (cached) return cached;

    const result = await pool.query(
      `SELECT COALESCE(NULLIF(TRIM(category), ''), 'غير مصنف') AS category,
              COUNT(*)::int AS count,
              SUM(CASE WHEN stock > 0 THEN 1 ELSE 0 END)::int AS in_stock
         FROM products
        WHERE merchant_id = $1
        GROUP BY 1
        ORDER BY count DESC
        LIMIT 20`,
      [merchantId]
    );

    const categories = result.rows.map((r: any) => ({
      name: r.category as string,
      count: r.count as number
    }));
    const totalProducts = categories.reduce((sum, c) => sum + c.count, 0);
    const inStockProducts = result.rows.reduce(
      (sum: number, r: any) => sum + (r.in_stock || 0),
      0
    );

    const summary: CatalogMetaSummary = { totalProducts, inStockProducts, categories };
    setCachedData(cacheKey, summary, 60 * 1000);
    return summary;
  } catch (error) {
    logger.error('Get catalog meta error', error as Error, { merchantId });
    return { totalProducts: 0, inStockProducts: 0, categories: [] };
  }
};

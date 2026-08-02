import pool from '../../database/connection.js';
import { logger } from '../../utils/logger.js';

// ==================== CACHING ====================
// Simple in-memory cache for product keywords (per merchant)
const productKeywordsCache = new Map<string, { keywords: string[], timestamp: number }>();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes - زيادة TTL لتقليل الاستعلامات المتكررة

// ==================== IMAGE URL CONVERSION ====================
/**
 * Convert image URL to /api/products/:id/image endpoint
 * Telegram/Facebook can't send base64 images directly or access /uploads/ reliably,
 * so we ALWAYS use the /api/products/:id/image endpoint which handles all cases
 */
const convertImageUrl = (imageUrl: string | null, productId: string): string | null => {
  if (!imageUrl || imageUrl === 'N/A') return null;
  
  // ALWAYS use /api/products/:id/image endpoint for consistency
  // This endpoint handles:
  // - base64 images (converts to buffer and sends)
  // - HTTP URLs (redirects to the actual URL)
  // - /uploads/ paths (will be handled by the endpoint)
  const baseUrl = process.env.BACKEND_URL || process.env.BASE_URL || 'https://xo-bot.com';
  return `${baseUrl}/api/products/${productId}/image`;
};

export interface Product {
  id: string;
  name: string;
  price: number;
  currency: string;
  stock: number;
  sizes: string[] | null;
  imageUrl: string | null;
  externalId: string | null;
  source: string;
  description?: string | null;
  category?: string | null;
  handle?: string | null;
}

export interface ProductFilters {
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  inStockOnly?: boolean;
  source?: string;
}

// ==================== ARABIC ROOTS & NORMALIZATION ====================

/**
 * Arabic word normalization - removes diacritics and normalizes letters
 * Critical for SaaS with Arabic-speaking customers
 */
const normalizeArabic = (text: string): string => {
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
 * Generate Arabic word variations (singular/plural patterns)
 * Helps find "ساعات" when searching for "ساعة" and vice versa
 */
const generateArabicVariations = (word: string): string[] => {
  const variations: string[] = [word];
  const normalized = normalizeArabic(word);
  
  if (normalized.length < 2) return variations;
  
  // Common Arabic plural patterns
  const pluralPatterns: [RegExp, string][] = [
    // ات ending (feminine plural)
    [/(.+)ات$/, '$1'],
    [/(.+)ه$/, '$1ات'],
    [/(.+)ة$/, '$1ات'],
    // ين/ون ending (masculine plural)
    [/(.+)ين$/, '$1'],
    [/(.+)ون$/, '$1'],
    // Common broken plurals
    [/^(.)(.)(.+)$/, '$1$2ا$3'], // فعال pattern
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

/**
 * Get product keywords for a merchant (cached)
 * Used by intentDetector to recognize products dynamically
 */
export const getMerchantProductKeywords = async (merchantId: string): Promise<string[]> => {
  // Check cache first
  const cached = productKeywordsCache.get(merchantId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.keywords;
  }
  
  try {
    // ✅ توسيع الاستعلام لتشمل المزيد من الحقول (vendor, product_type, tags, handle)
    const result = await pool.query(
      `SELECT DISTINCT 
        LOWER(name) as name, 
        LOWER(category) as category,
        LOWER(vendor) as vendor,
        LOWER(product_type) as product_type,
        tags,
        LOWER(handle) as handle
       FROM products 
       WHERE merchant_id = $1 
       LIMIT 500`,
      [merchantId]
    );
    
    const keywords: string[] = [];
    
    result.rows.forEach(row => {
      if (row.name) {
        // Add full name
        keywords.push(row.name);
        // Add individual words from name (for partial matching)
        const words = row.name.split(/\s+/).filter((w: string) => w.length > 2);
        keywords.push(...words);
        // Add normalized versions
        keywords.push(normalizeArabic(row.name));
      }
      if (row.category) {
        keywords.push(row.category);
        keywords.push(normalizeArabic(row.category));
      }
      // ✅ إضافة vendor (اسم البائع/العلامة التجارية)
      if (row.vendor) {
        keywords.push(row.vendor);
        keywords.push(normalizeArabic(row.vendor));
      }
      // ✅ إضافة product_type (نوع المنتج)
      if (row.product_type) {
        keywords.push(row.product_type);
        keywords.push(normalizeArabic(row.product_type));
      }
      // ✅ إضافة tags (الوسوم)
      if (row.tags && Array.isArray(row.tags)) {
        row.tags.forEach((tag: string) => {
          if (tag && tag.length > 1) {
            keywords.push(tag.toLowerCase());
            keywords.push(normalizeArabic(tag));
          }
        });
      }
      // ✅ إضافة handle (مقبض URL) - مفيد لمنتجات Shopify
      if (row.handle) {
        // تحويل handle من kebab-case إلى كلمات منفصلة
        const handleWords = row.handle.split('-').filter((w: string) => w.length > 2);
        keywords.push(...handleWords);
      }
    });
    
    // Remove duplicates and empty strings
    const uniqueKeywords = [...new Set(keywords)].filter(k => k && k.length > 1);
    
    // Cache the result
    productKeywordsCache.set(merchantId, {
      keywords: uniqueKeywords,
      timestamp: Date.now()
    });
    
    logger.info('Product keywords cached for merchant', {
      merchantId,
      keywordsCount: uniqueKeywords.length,
      source: 'expanded_query'
    });
    
    return uniqueKeywords;
  } catch (error) {
    logger.error('Error fetching merchant product keywords', error as Error, { merchantId });
    return [];
  }
};

/**
 * Smart search products using trigram similarity and Arabic normalization
 * Optimized for SaaS with thousands of products
 * 
 * @param merchantId - Merchant ID (required for SaaS isolation)
 * @param query - Search query (searches in name, description, category)
 * @param filters - Optional filters (category, price range, stock, source)
 * @returns Array of matching products
 */
export const searchProducts = async (
  merchantId: string,
  query: string,
  filters?: ProductFilters
): Promise<Product[]> => {
  try {
    if (!merchantId) {
      throw new Error('merchantId is required');
    }

    const conditions: string[] = ['merchant_id = $1'];
    const values: any[] = [merchantId];
    let paramIndex = 2;

    // ✅ Smart semantic search without fixed keywords
    // Uses multiple search strategies for intelligent matching
    if (query && query.trim()) {
      const searchTerm = query.trim();
      const normalizedTerm = normalizeArabic(searchTerm);
      const variations = generateArabicVariations(normalizedTerm);
      
      // ✅ Build comprehensive search conditions
      const searchConditions: string[] = [];
      
      // Strategy 1: Exact and partial matches in name, description, category, tags, vendor
      for (const variation of variations) {
        const likeTerm = `%${variation}%`;
        searchConditions.push(
          `(LOWER(name) LIKE $${paramIndex} OR 
            LOWER(description) LIKE $${paramIndex} OR 
            LOWER(category) LIKE $${paramIndex} OR
            LOWER(vendor) LIKE $${paramIndex} OR
            LOWER(product_type) LIKE $${paramIndex} OR
            EXISTS (
              SELECT 1 FROM unnest(tags) AS tag 
              WHERE LOWER(tag) LIKE $${paramIndex}
            ))`
        );
        values.push(likeTerm);
        paramIndex++;
      }
      
      // Strategy 2: Word-by-word matching (for multi-word queries)
      const words = searchTerm.split(/\s+/).filter(w => w.length > 2);
      if (words.length > 1) {
        for (const word of words) {
          const normalizedWord = normalizeArabic(word);
          const likeWord = `%${normalizedWord}%`;
          searchConditions.push(
            `(LOWER(name) LIKE $${paramIndex} OR 
              LOWER(description) LIKE $${paramIndex} OR
              LOWER(category) LIKE $${paramIndex})`
          );
          values.push(likeWord);
          paramIndex++;
        }
      }
      
      // Strategy 3: Trigram similarity for fuzzy matching (catches typos and variations)
      searchConditions.push(
        `(name % $${paramIndex} OR 
          category % $${paramIndex} OR
          description % $${paramIndex})`
      );
      values.push(searchTerm);
      paramIndex++;
      
      // Strategy 4: Handle search (for Shopify products)
      if (searchTerm.length > 3) {
        searchConditions.push(`LOWER(handle) LIKE $${paramIndex}`);
        values.push(`%${normalizedTerm}%`);
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

    // Smart ordering: exact match > similarity > stock > recent
    let orderBy = '';
    if (query && query.trim()) {
      const searchTerm = query.trim().toLowerCase();
      orderBy = `
        ORDER BY 
          CASE 
            WHEN LOWER(name) = $${paramIndex} THEN 0
            WHEN LOWER(name) LIKE $${paramIndex + 1} THEN 1
            WHEN LOWER(category) = $${paramIndex} THEN 2
            WHEN name % $${paramIndex} THEN 3
            ELSE 4
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

    const whereClause = conditions.join(' AND ');
    const querySQL = `
      SELECT 
        id,
        name,
        description,
        price,
        currency,
        category,
        stock,
        sizes,
        image_url,
        external_id,
        source,
        handle
      FROM products 
      WHERE ${whereClause}
      ${orderBy}
      LIMIT 5
    `;

    const result = await pool.query(querySQL, values);

    logger.info('Smart product search completed', {
      merchantId,
      query,
      found: result.rows.length
    });

    return result.rows.map(row => ({
      id: row.id,
      name: row.name,
      price: parseFloat(row.price),
      currency: row.currency,
      stock: row.stock,
      sizes: row.sizes || null,
      imageUrl: convertImageUrl(row.image_url, row.id),
      externalId: row.external_id,
      source: row.source,
      description: row.description,
      category: row.category,
      handle: row.handle || null
    }));
  } catch (error) {
    logger.error('Error in catalogTool.searchProducts', error as Error, {
      merchantId,
      query,
      filters
    });
    throw error;
  }
};

/**
 * Get detailed information about a specific product
 * 
 * @param merchantId - Merchant ID (required for SaaS isolation)
 * @param productId - Product ID
 * @returns Product details or null if not found
 */
export const getProductDetails = async (
  merchantId: string,
  productId: string
): Promise<Product | null> => {
  try {
    if (!merchantId || !productId) {
      throw new Error('merchantId and productId are required');
    }

    const result = await pool.query(
      `SELECT 
        id,
        name,
        description,
        price,
        currency,
        category,
        stock,
        sizes,
        image_url,
        external_id,
        source,
        handle
       FROM products 
       WHERE id = $1 AND merchant_id = $2`,
      [productId, merchantId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      price: parseFloat(row.price),
      currency: row.currency,
      stock: row.stock,
      sizes: row.sizes || null,
      imageUrl: convertImageUrl(row.image_url, row.id),
      externalId: row.external_id,
      source: row.source,
      description: row.description,
      category: row.category,
      handle: row.handle || null
    };
  } catch (error) {
    logger.error('Error in catalogTool.getProductDetails', error as Error, {
      merchantId,
      productId
    });
    throw error;
  }
};

/**
 * Get product by external ID (e.g., Shopify product ID)
 * 
 * @param merchantId - Merchant ID (required for SaaS isolation)
 * @param externalId - External product ID (e.g., Shopify product ID)
 * @param source - Source of the external ID (default: 'shopify')
 * @returns Product details or null if not found
 */
export const getProductByExternalId = async (
  merchantId: string,
  externalId: string,
  source: string = 'shopify'
): Promise<Product | null> => {
  try {
    if (!merchantId || !externalId) {
      throw new Error('merchantId and externalId are required');
    }

    const result = await pool.query(
      `SELECT 
        id,
        name,
        description,
        price,
        currency,
        category,
        stock,
        sizes,
        image_url,
        external_id,
        source,
        handle
       FROM products 
       WHERE merchant_id = $1 AND external_id = $2 AND source = $3`,
      [merchantId, externalId, source]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      price: parseFloat(row.price),
      currency: row.currency,
      stock: row.stock,
      sizes: row.sizes || null,
      imageUrl: convertImageUrl(row.image_url, row.id),
      externalId: row.external_id,
      source: row.source,
      description: row.description,
      category: row.category,
      handle: row.handle || null
    };
  } catch (error) {
    logger.error('Error in catalogTool.getProductByExternalId', error as Error, {
      merchantId,
      externalId,
      source
    });
    throw error;
  }
};

/**
 * Get product by internal ID (alias for getProductDetails for consistency)
 * 
 * @param merchantId - Merchant ID (required for SaaS isolation)
 * @param productId - Product ID
 * @returns Product details or null if not found
 */
export const getProductById = async (
  merchantId: string,
  productId: string
): Promise<Product | null> => {
  return getProductDetails(merchantId, productId);
};

/**
 * Get top products (fallback when search returns no results)
 * Returns up to 3 in-stock products, ordered by creation date
 * 
 * @param merchantId - Merchant ID
 * @returns Array of up to 3 products
 */
export const getTopProducts = async (
  merchantId: string
): Promise<Product[]> => {
  try {
    const result = await pool.query(
      `SELECT 
        id,
        name,
        description,
        price,
        currency,
        category,
        stock,
        sizes,
        image_url,
        external_id,
        source
       FROM products 
       WHERE merchant_id = $1 AND stock > 0
       ORDER BY created_at DESC
       LIMIT 5`,
      [merchantId]
    );

    return result.rows.map(row => ({
      id: row.id,
      name: row.name,
      price: parseFloat(row.price),
      currency: row.currency,
      stock: row.stock,
      sizes: row.sizes || null,
      imageUrl: convertImageUrl(row.image_url, row.id),
      externalId: row.external_id,
      source: row.source,
      description: row.description,
      category: row.category
    }));
  } catch (error) {
    logger.error('Error in catalogTool.getTopProducts', error as Error, {
      merchantId
    });
    throw error;
  }
};

/**
 * Clear product keywords cache for a merchant
 * Call this when products are added/updated/deleted
 */
export const clearProductKeywordsCache = (merchantId: string): void => {
  productKeywordsCache.delete(merchantId);
  logger.info('Product keywords cache cleared', { merchantId });
};

// ==================== TOOL IMPLEMENTATION ====================

import { Tool, ToolContext, ToolResult } from './tool.interface.js';

/**
 * Catalog Tool - Implements Tool interface
 * Handles product search and retrieval for various intents
 * Optimized for SaaS with smart caching and Arabic support
 */
export class CatalogTool implements Tool {
  name = 'catalog';
  description = 'Search and retrieve product information from catalog (supports Shopify-synced data)';

  /**
   * Catalog tool can handle product-related intents
   */
  canHandle(intent: string): boolean {
    return [
      'browse',
      'product_query',
      'price',
      'availability',
      'comparison',
      'order',
      'greeting' // ✅ إضافة greeting لضمان عرض المنتجات عند الطلب
    ].includes(intent);
  }

  /**
   * Execute catalog search or product retrieval
   * 
   * Input format:
   * - { productId: string } - Get specific product by ID
   * - { externalId: string, source?: string } - Get product by external ID (e.g., Shopify)
   * - { query: string, limit?: number, filters?: {...} } - Search products
   * - { top: number } - Get top products
   */
  async execute(input: any, ctx: ToolContext): Promise<ToolResult> {
    try {
      // Handle product ID lookup
      if (input.productId) {
        const product = await getProductById(ctx.merchantId, input.productId);
        
        if (!product) {
          logger.warn('Product not found by ID', {
            merchantId: ctx.merchantId,
            productId: input.productId
          });
          
          return {
            name: this.name,
            data: null,
            success: false,
            error: 'Product not found',
            metadata: { productId: input.productId, type: 'by_id' }
          };
        }

        logger.info('Product retrieved by ID', {
          merchantId: ctx.merchantId,
          productId: input.productId,
          productName: product.name
        });

        return {
          name: this.name,
          data: { product, products: [product] },
          success: true,
          metadata: { productId: input.productId, type: 'by_id' }
        };
      }

      // Handle external ID lookup (e.g., Shopify)
      if (input.externalId) {
        const source = input.source || 'shopify';
        const product = await getProductByExternalId(
          ctx.merchantId,
          input.externalId,
          source
        );
        
        if (!product) {
          logger.warn('Product not found by external ID', {
            merchantId: ctx.merchantId,
            externalId: input.externalId,
            source
          });
          
          return {
            name: this.name,
            data: null,
            success: false,
            error: 'Product not found',
            metadata: { externalId: input.externalId, source, type: 'by_external_id' }
          };
        }

        logger.info('Product retrieved by external ID', {
          merchantId: ctx.merchantId,
          externalId: input.externalId,
          source,
          productName: product.name
        });

        return {
          name: this.name,
          data: { product, products: [product] },
          success: true,
          metadata: { externalId: input.externalId, source, type: 'by_external_id' }
        };
      }

      // Handle top products request
      if (input.top) {
        const products = await getTopProducts(ctx.merchantId);
        const limitedProducts = products.slice(0, input.top || 3);
        
        logger.info('Top products retrieved', {
          merchantId: ctx.merchantId,
          requested: input.top,
          returned: limitedProducts.length
        });
        
        return {
          name: this.name,
          data: { products: limitedProducts },
          success: true,
          metadata: { type: 'top', count: limitedProducts.length }
        };
      }

      // Handle search query
      const query = input.query || input.search || '';
      const limit = input.limit || 5;
      const filters = input.filters || {};

      // ✅ CRITICAL: إذا لم يكن هناك query ولا filters، نعيد top products كـ fallback
      // هذا يضمن أن البوت يرى المنتجات حتى عند عدم وجود query محدد
      if (!query && Object.keys(filters).length === 0) {
        // No query or filters, return top products as fallback
        const products = await getTopProducts(ctx.merchantId);
        
        logger.info('No search query provided, returning top products as fallback', {
          merchantId: ctx.merchantId,
          count: products.length,
          products: products.map((p: any) => `${p.name} (${p.stock})`).join(', ')
        });
        
        return {
          name: this.name,
          data: { products },
          success: true,
          metadata: { type: 'fallback', count: products.length }
        };
      }

      // Smart search with Arabic support
      const products = await searchProducts(ctx.merchantId, query, filters);

      // Apply limit if specified
      const limitedProducts = limit ? products.slice(0, limit) : products;

      logger.info('Products searched', {
        merchantId: ctx.merchantId,
        query,
        filters,
        found: products.length,
        returned: limitedProducts.length
      });

      return {
        name: this.name,
        data: { products: limitedProducts },
        success: true,
        metadata: {
          type: 'search',
          query,
          filters,
          count: limitedProducts.length,
          totalFound: products.length
        }
      };
    } catch (error: any) {
      logger.error('Error in catalog tool', error as Error, {
        merchantId: ctx.merchantId,
        input,
        platform: ctx.platform
      });

      return {
        name: this.name,
        data: null,
        success: false,
        error: error.message || 'Catalog search failed',
        metadata: { input, platform: ctx.platform }
      };
    }
  }
}

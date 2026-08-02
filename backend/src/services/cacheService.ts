/**
 * Smart Cache Service for SaaS
 * In-memory caching with TTL for frequently accessed data
 * Optimized for multi-tenant architecture
 */

import { logger } from '../utils/logger.js';
import pool from '../database/connection.js';

// ==================== CACHE CONFIGURATION ====================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  hits: number;
}

interface CacheConfig {
  ttl: number; // Time to live in milliseconds
  maxSize: number; // Maximum number of entries
}

// Default cache configurations
// ✅ تحسين: زيادة TTL للكاش لتقليل الاستعلامات المتكررة
const CACHE_CONFIGS: Record<string, CacheConfig> = {
  merchantSettings: { ttl: 10 * 60 * 1000, maxSize: 500 },  // 10 minutes, 500 merchants (زيادة من 5)
  productKeywords: { ttl: 15 * 60 * 1000, maxSize: 500 },   // 15 minutes (زيادة من 5)
  topProducts: { ttl: 5 * 60 * 1000, maxSize: 500 },        // 5 minutes (زيادة من 2)
  conversationState: { ttl: 60 * 1000, maxSize: 10000 }     // 1 minute, 10k conversations (زيادة من 30 ثانية)
};

// ==================== GENERIC CACHE CLASS ====================

class SmartCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private config: CacheConfig;
  private name: string;

  constructor(name: string, config: CacheConfig) {
    this.name = name;
    this.config = config;
    
    // Periodic cleanup every minute
    setInterval(() => this.cleanup(), 60 * 1000);
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }

    // Check if expired
    if (Date.now() - entry.timestamp > this.config.ttl) {
      this.cache.delete(key);
      return null;
    }

    // Increment hit counter
    entry.hits++;
    
    return entry.data;
  }

  set(key: string, data: T): void {
    // Check if cache is full
    if (this.cache.size >= this.config.maxSize) {
      this.evictLeastUsed();
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      hits: 1
    });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    logger.info(`Cache ${this.name} cleared`);
  }

  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.config.ttl) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug(`Cache ${this.name}: cleaned ${cleaned} expired entries`);
    }
  }

  private evictLeastUsed(): void {
    let leastUsedKey: string | null = null;
    let leastHits = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.hits < leastHits) {
        leastHits = entry.hits;
        leastUsedKey = key;
      }
    }

    if (leastUsedKey) {
      this.cache.delete(leastUsedKey);
    }
  }

  getStats(): { size: number; maxSize: number; ttl: number } {
    return {
      size: this.cache.size,
      maxSize: this.config.maxSize,
      ttl: this.config.ttl
    };
  }
}

// ==================== CACHE INSTANCES ====================

export interface MerchantSettings {
  store_name: string;
  store_currency: string;
  system_prompt: string;
  bot_persona: string;
  shipping_policy: string;
  delivery_time: string;
  payment_methods: string;
  return_policy: string;
  additional_notes: string;
  enable_ai_injection: boolean;
  ai_mode?: 'hybrid' | 'full';
  telegram_bot_token?: string;
}

const merchantSettingsCache = new SmartCache<MerchantSettings>('merchantSettings', CACHE_CONFIGS.merchantSettings);
const productKeywordsCache = new SmartCache<string[]>('productKeywords', CACHE_CONFIGS.productKeywords);

// ==================== CACHE FUNCTIONS ====================

/**
 * Get merchant settings with caching
 */
export const getCachedMerchantSettings = async (merchantId: string): Promise<MerchantSettings | null> => {
  // Check cache first
  const cached = merchantSettingsCache.get(merchantId);
  if (cached) {
    return cached;
  }

  // Fetch from database
  try {
    let result;
    try {
      result = await pool.query(
        `SELECT store_name, store_currency, system_prompt, bot_persona,
                shipping_policy, delivery_time, payment_methods, return_policy,
                additional_notes, enable_ai_injection, ai_mode, telegram_bot_token
         FROM merchant_settings WHERE merchant_id = $1`,
        [merchantId]
      );
    } catch (error: any) {
      // Backward compatibility: ai_mode column may not exist in some databases
      if (error?.code === '42703' || error?.message?.includes('ai_mode')) {
        result = await pool.query(
          `SELECT store_name, store_currency, system_prompt, bot_persona,
                  shipping_policy, delivery_time, payment_methods, return_policy,
                  additional_notes, enable_ai_injection, telegram_bot_token
           FROM merchant_settings WHERE merchant_id = $1`,
          [merchantId]
        );
      } else {
        throw error;
      }
    }

    if (result.rows.length === 0) {
      return null;
    }

    const settings: MerchantSettings = {
      store_name: result.rows[0].store_name || 'المتجر',
      store_currency: result.rows[0].store_currency || 'USD',
      system_prompt: result.rows[0].system_prompt || '',
      bot_persona: result.rows[0].bot_persona || 'friendly',
      shipping_policy: result.rows[0].shipping_policy || '',
      delivery_time: result.rows[0].delivery_time || '',
      payment_methods: result.rows[0].payment_methods || '',
      return_policy: result.rows[0].return_policy || '',
      additional_notes: result.rows[0].additional_notes || '',
      enable_ai_injection: result.rows[0].enable_ai_injection || false,
      ai_mode: result.rows[0].ai_mode || 'hybrid',
      telegram_bot_token: result.rows[0].telegram_bot_token
    };

    // Cache the result
    merchantSettingsCache.set(merchantId, settings);

    return settings;
  } catch (error) {
    logger.error('Error fetching merchant settings', error as Error, { merchantId });
    return null;
  }
};

/**
 * Invalidate merchant settings cache
 * Call this when settings are updated
 */
export const invalidateMerchantSettings = (merchantId: string): void => {
  merchantSettingsCache.delete(merchantId);
  logger.info('Merchant settings cache invalidated', { merchantId });
};

/**
 * Get cached product keywords for merchant
 */
export const getCachedProductKeywords = async (merchantId: string): Promise<string[]> => {
  // Check cache first
  const cached = productKeywordsCache.get(merchantId);
  if (cached) {
    return cached;
  }

  // Fetch from database
  try {
    const result = await pool.query(
      `SELECT DISTINCT 
        LOWER(name) as name, 
        LOWER(category) as category
       FROM products 
       WHERE merchant_id = $1 
       LIMIT 200`,
      [merchantId]
    );

    const keywords: string[] = [];
    
    result.rows.forEach(row => {
      if (row.name) {
        keywords.push(row.name);
        // Add individual words
        const words = row.name.split(/\s+/).filter((w: string) => w.length > 2);
        keywords.push(...words);
      }
      if (row.category) {
        keywords.push(row.category);
      }
    });

    const uniqueKeywords = [...new Set(keywords)].filter(k => k && k.length > 1);
    
    // Cache the result
    productKeywordsCache.set(merchantId, uniqueKeywords);

    return uniqueKeywords;
  } catch (error) {
    logger.error('Error fetching product keywords', error as Error, { merchantId });
    return [];
  }
};

/**
 * Invalidate product keywords cache
 * Call this when products are added/updated/deleted
 */
export const invalidateProductKeywords = (merchantId: string): void => {
  productKeywordsCache.delete(merchantId);
  logger.info('Product keywords cache invalidated', { merchantId });
};

/**
 * Clear all caches
 */
export const clearAllCaches = (): void => {
  merchantSettingsCache.clear();
  productKeywordsCache.clear();
  logger.info('All caches cleared');
};

/**
 * Get cache statistics
 */
export const getCacheStats = () => {
  return {
    merchantSettings: merchantSettingsCache.getStats(),
    productKeywords: productKeywordsCache.getStats()
  };
};

// ==================== RATE LIMITING ====================

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const rateLimitCache = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 20; // 20 messages per minute per user

/**
 * Check if user is rate limited
 * @returns true if user is allowed, false if rate limited
 */
export const checkRateLimit = (userId: string, merchantId: string): boolean => {
  const key = `${merchantId}:${userId}`;
  const now = Date.now();
  
  const entry = rateLimitCache.get(key);
  
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW) {
    // New window
    rateLimitCache.set(key, { count: 1, windowStart: now });
    return true;
  }
  
  if (entry.count >= RATE_LIMIT_MAX) {
    logger.warn('Rate limit exceeded', { userId, merchantId, count: entry.count });
    return false;
  }
  
  entry.count++;
  return true;
};

/**
 * Clean up old rate limit entries (call periodically)
 */
export const cleanupRateLimits = (): void => {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [key, entry] of rateLimitCache.entries()) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW * 2) {
      rateLimitCache.delete(key);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    logger.debug(`Rate limit cache: cleaned ${cleaned} entries`);
  }
};

// Cleanup rate limits every 2 minutes
setInterval(cleanupRateLimits, 2 * 60 * 1000);


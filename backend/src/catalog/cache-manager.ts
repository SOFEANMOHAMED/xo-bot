/**
 * Cache Manager - In-memory caching for high performance
 * Optimized for SaaS with multi-tenant support
 */

import { logger } from '../utils/logger.js';

// ==================== TYPES ====================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

// ==================== CACHE STORE ====================

const cache = new Map<string, CacheEntry<any>>();

// Default TTL: 5 minutes
const DEFAULT_TTL = 5 * 60 * 1000;

// Max cache size
const MAX_CACHE_SIZE = 10000;

// ==================== CACHE OPERATIONS ====================

/**
 * Get cached data
 */
export const getCachedData = <T>(key: string): T | null => {
  const entry = cache.get(key);
  
  if (!entry) {
    return null;
  }
  
  // Check expiration
  if (Date.now() - entry.timestamp > entry.ttl) {
    cache.delete(key);
    return null;
  }
  
  return entry.data as T;
};

/**
 * Set cached data
 */
export const setCachedData = <T>(key: string, data: T, ttl: number = DEFAULT_TTL): void => {
  // Evict old entries if cache is too large
  if (cache.size >= MAX_CACHE_SIZE) {
    evictOldEntries();
  }
  
  cache.set(key, {
    data,
    timestamp: Date.now(),
    ttl
  });
};

/**
 * Clear cache entries matching prefix
 */
export const clearCache = (prefix?: string): void => {
  if (!prefix) {
    cache.clear();
    logger.info('Cache cleared completely');
    return;
  }
  
  let cleared = 0;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
      cleared++;
    }
  }
  
  if (cleared > 0) {
    logger.debug('Cache entries cleared', { prefix, count: cleared });
  }
};

/**
 * Get cache stats
 */
export const getCacheStats = (): { size: number; maxSize: number; hitRate: number } => {
  return {
    size: cache.size,
    maxSize: MAX_CACHE_SIZE,
    hitRate: 0 // Could implement hit rate tracking
  };
};

// ==================== INTERNAL FUNCTIONS ====================

/**
 * Evict old entries when cache is full
 */
const evictOldEntries = (): void => {
  const now = Date.now();
  let evicted = 0;
  
  // First pass: remove expired entries
  for (const [key, entry] of cache.entries()) {
    if (now - entry.timestamp > entry.ttl) {
      cache.delete(key);
      evicted++;
    }
  }
  
  // Second pass: remove oldest entries if still too large
  if (cache.size >= MAX_CACHE_SIZE) {
    const entries = Array.from(cache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);
    
    const toRemove = Math.floor(entries.length * 0.2); // Remove 20%
    for (let i = 0; i < toRemove; i++) {
      cache.delete(entries[i][0]);
      evicted++;
    }
  }
  
  if (evicted > 0) {
    logger.debug('Cache eviction completed', { evicted, newSize: cache.size });
  }
};

// ==================== MERCHANT-SPECIFIC CACHE ====================

/**
 * Get merchant-specific cache key
 */
export const getMerchantCacheKey = (merchantId: string, type: string, suffix?: string): string => {
  return suffix 
    ? `${type}:${merchantId}:${suffix}`
    : `${type}:${merchantId}`;
};

/**
 * Clear all cache for a merchant
 */
export const clearMerchantCache = (merchantId: string): void => {
  const prefixes = ['search:', 'product:', 'top:', 'keywords:', 'conversation:'];
  
  for (const prefix of prefixes) {
    clearCache(`${prefix}${merchantId}`);
  }
  
  logger.info('Merchant cache cleared', { merchantId });
};

// ==================== PERIODIC CLEANUP ====================

/**
 * Run periodic cache cleanup
 */
export const startCacheCleanup = (intervalMs: number = 60 * 1000): NodeJS.Timeout => {
  return setInterval(() => {
    const before = cache.size;
    evictOldEntries();
    const after = cache.size;
    
    if (before !== after) {
      logger.debug('Periodic cache cleanup', { 
        before, 
        after, 
        evicted: before - after 
      });
    }
  }, intervalMs);
};

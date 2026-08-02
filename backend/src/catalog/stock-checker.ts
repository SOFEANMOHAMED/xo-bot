/**
 * Stock Checker - Check product availability and stock levels
 * Provides real-time stock status
 */

import pool from '../database/connection.js';
import { logger } from '../utils/logger.js';
import { getCachedData, setCachedData } from './cache-manager.js';
import type { Product } from '../core/types.js';

// ==================== TYPES ====================

export interface StockStatus {
  productId: string;
  productName: string;
  inStock: boolean;
  quantity: number;
  status: 'available' | 'low_stock' | 'out_of_stock';
  lastUpdated: string;
}

export interface StockCheckResult {
  products: StockStatus[];
  allInStock: boolean;
  outOfStockCount: number;
  lowStockCount: number;
}

// ==================== CONSTANTS ====================

const LOW_STOCK_THRESHOLD = 5;
const STOCK_CACHE_TTL = 2 * 60 * 1000; // 2 minutes (shorter for stock data)

// ==================== STOCK STATUS ====================

/**
 * Determine stock status based on quantity
 */
export const getStockStatusLabel = (quantity: number): 'available' | 'low_stock' | 'out_of_stock' => {
  if (quantity <= 0) return 'out_of_stock';
  if (quantity < LOW_STOCK_THRESHOLD) return 'low_stock';
  return 'available';
};

/**
 * Get stock status message
 */
export const getStockMessage = (
  status: StockStatus,
  language: 'arabic' | 'english' = 'arabic'
): string => {
  if (language === 'arabic') {
    switch (status.status) {
      case 'available':
        return `✓ متوفر (${status.quantity} قطعة)`;
      case 'low_stock':
        return `⚠️ الكمية محدودة (${status.quantity} قطع فقط)`;
      case 'out_of_stock':
        return `✗ غير متوفر حالياً`;
    }
  }
  
  switch (status.status) {
    case 'available':
      return `✓ In stock (${status.quantity} units)`;
    case 'low_stock':
      return `⚠️ Limited stock (only ${status.quantity} left)`;
    case 'out_of_stock':
      return `✗ Out of stock`;
  }
};

// ==================== STOCK CHECKING ====================

/**
 * Check stock for a single product
 */
export const checkProductStock = async (
  merchantId: string,
  productId: string
): Promise<StockStatus | null> => {
  try {
    // Check cache first
    const cacheKey = `stock:${merchantId}:${productId}`;
    const cached = getCachedData<StockStatus>(cacheKey);
    if (cached) {
      return cached;
    }

    const result = await pool.query(
      `SELECT id, name, stock, updated_at 
       FROM products 
       WHERE id = $1 AND merchant_id = $2`,
      [productId, merchantId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    const status: StockStatus = {
      productId: row.id,
      productName: row.name,
      inStock: row.stock > 0,
      quantity: row.stock,
      status: getStockStatusLabel(row.stock),
      lastUpdated: row.updated_at?.toISOString() || new Date().toISOString()
    };

    // Cache result
    setCachedData(cacheKey, status, STOCK_CACHE_TTL);

    return status;
  } catch (error) {
    logger.error('Error checking product stock', error as Error, {
      merchantId,
      productId
    });
    return null;
  }
};

/**
 * Check stock for multiple products
 */
export const checkMultipleProductsStock = async (
  merchantId: string,
  productIds: string[]
): Promise<StockCheckResult> => {
  try {
    if (productIds.length === 0) {
      return {
        products: [],
        allInStock: true,
        outOfStockCount: 0,
        lowStockCount: 0
      };
    }

    const result = await pool.query(
      `SELECT id, name, stock, updated_at 
       FROM products 
       WHERE id = ANY($1) AND merchant_id = $2`,
      [productIds, merchantId]
    );

    const products: StockStatus[] = result.rows.map(row => ({
      productId: row.id,
      productName: row.name,
      inStock: row.stock > 0,
      quantity: row.stock,
      status: getStockStatusLabel(row.stock),
      lastUpdated: row.updated_at?.toISOString() || new Date().toISOString()
    }));

    const outOfStockCount = products.filter(p => p.status === 'out_of_stock').length;
    const lowStockCount = products.filter(p => p.status === 'low_stock').length;

    return {
      products,
      allInStock: outOfStockCount === 0,
      outOfStockCount,
      lowStockCount
    };
  } catch (error) {
    logger.error('Error checking multiple products stock', error as Error, {
      merchantId,
      productIds
    });
    return {
      products: [],
      allInStock: false,
      outOfStockCount: productIds.length,
      lowStockCount: 0
    };
  }
};

/**
 * Check if product is in stock
 */
export const isProductInStock = async (
  merchantId: string,
  productId: string
): Promise<boolean> => {
  const status = await checkProductStock(merchantId, productId);
  return status?.inStock ?? false;
};

// ==================== STOCK UPDATES ====================

/**
 * Reserve stock for an order (decrease available quantity)
 */
export const reserveStock = async (
  merchantId: string,
  productId: string,
  quantity: number = 1
): Promise<boolean> => {
  try {
    const result = await pool.query(
      `UPDATE products 
       SET stock = stock - $3, updated_at = NOW()
       WHERE id = $1 AND merchant_id = $2 AND stock >= $3
       RETURNING id`,
      [productId, merchantId, quantity]
    );

    if (result.rowCount === 0) {
      logger.warn('Failed to reserve stock - insufficient quantity', {
        merchantId,
        productId,
        requestedQuantity: quantity
      });
      return false;
    }

    // Invalidate cache
    const cacheKey = `stock:${merchantId}:${productId}`;
    setCachedData(cacheKey, null, 0);

    logger.info('Stock reserved', {
      merchantId,
      productId,
      quantity
    });

    return true;
  } catch (error) {
    logger.error('Error reserving stock', error as Error, {
      merchantId,
      productId,
      quantity
    });
    return false;
  }
};

/**
 * Release reserved stock (increase available quantity)
 */
export const releaseStock = async (
  merchantId: string,
  productId: string,
  quantity: number = 1
): Promise<boolean> => {
  try {
    await pool.query(
      `UPDATE products 
       SET stock = stock + $3, updated_at = NOW()
       WHERE id = $1 AND merchant_id = $2`,
      [productId, merchantId, quantity]
    );

    // Invalidate cache
    const cacheKey = `stock:${merchantId}:${productId}`;
    setCachedData(cacheKey, null, 0);

    logger.info('Stock released', {
      merchantId,
      productId,
      quantity
    });

    return true;
  } catch (error) {
    logger.error('Error releasing stock', error as Error, {
      merchantId,
      productId,
      quantity
    });
    return false;
  }
};

// ==================== LOW STOCK ALERTS ====================

/**
 * Get products with low stock
 */
export const getLowStockProducts = async (
  merchantId: string,
  threshold: number = LOW_STOCK_THRESHOLD
): Promise<Product[]> => {
  try {
    const result = await pool.query(
      `SELECT id, name, price, currency, stock, category
       FROM products 
       WHERE merchant_id = $1 AND stock > 0 AND stock < $2
       ORDER BY stock ASC
       LIMIT 20`,
      [merchantId, threshold]
    );

    return result.rows.map(row => ({
      id: row.id,
      name: row.name,
      price: parseFloat(row.price),
      currency: row.currency,
      stock: row.stock,
      category: row.category
    }));
  } catch (error) {
    logger.error('Error getting low stock products', error as Error, { merchantId });
    return [];
  }
};

/**
 * Get out of stock products
 */
export const getOutOfStockProducts = async (
  merchantId: string
): Promise<Product[]> => {
  try {
    const result = await pool.query(
      `SELECT id, name, price, currency, stock, category
       FROM products 
       WHERE merchant_id = $1 AND stock <= 0
       ORDER BY name
       LIMIT 50`,
      [merchantId]
    );

    return result.rows.map(row => ({
      id: row.id,
      name: row.name,
      price: parseFloat(row.price),
      currency: row.currency,
      stock: 0,
      category: row.category
    }));
  } catch (error) {
    logger.error('Error getting out of stock products', error as Error, { merchantId });
    return [];
  }
};

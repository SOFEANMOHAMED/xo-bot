/**
 * Sync Scheduler Service
 * Handles automatic synchronization of products and orders from external platforms
 */

import pool from '../database/connection.js';
import { logger } from '../utils/logger.js';
import { buildShopifyAdminApiUrl } from '../config/shopify.js';
import { invalidateProductKeywords } from './cacheService.js';
import { clearProductKeywordsCache } from './tools/catalogTool.js';

// =============================================
// TYPES
// =============================================

interface ShopifyStore {
  id: string;
  merchant_id: string;
  shop_domain: string;
  access_token: string;
  auto_sync: boolean;
  sync_interval: number;
  sync_products: boolean;
  sync_orders: boolean;
  sync_inventory: boolean;
  last_products_sync: Date | null;
  last_orders_sync: Date | null;
}

interface SyncResult {
  success: boolean;
  merchantId: string;
  platform: string;
  type: string;
  processed: number;
  created: number;
  updated: number;
  failed: number;
  error?: string;
}

// =============================================
// SCHEDULER STATE
// =============================================

let schedulerInterval: NodeJS.Timeout | null = null;
let isRunning = false;

// =============================================
// SYNC FUNCTIONS
// =============================================

/**
 * Sync products for a single store
 */
async function syncStoreProducts(store: ShopifyStore): Promise<SyncResult> {
  const result: SyncResult = {
    success: false,
    merchantId: store.merchant_id,
    platform: 'shopify',
    type: 'products',
    processed: 0,
    created: 0,
    updated: 0,
    failed: 0
  };

  try {
    logger.info('Starting scheduled products sync', {
      merchantId: store.merchant_id,
      shopDomain: store.shop_domain
    });

    // Fetch products from Shopify
    const products: any[] = [];
    let hasNextPage = true;
    let cursor: string | null = null;

    while (hasNextPage) {
      const query = cursor ? `?limit=250&page_info=${cursor}` : '?limit=250';
      const apiUrl = buildShopifyAdminApiUrl(store.shop_domain, 'products.json', query);
      
      const response = await fetch(apiUrl, {
        headers: {
          'X-Shopify-Access-Token': store.access_token,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Shopify API error: ${response.statusText}`);
      }

      const data = await response.json() as { products?: any[] };
      products.push(...(data.products || []));

      // Check for pagination
      const linkHeader = response.headers.get('link');
      if (linkHeader && linkHeader.includes('rel="next"')) {
        const nextMatch = linkHeader.match(/<[^>]*page_info=([^>&]+)[^>]*>;\s*rel="next"/);
        cursor = nextMatch ? nextMatch[1] : null;
        hasNextPage = !!cursor;
      } else {
        hasNextPage = false;
      }
    }

    // Helper: extract sizes/colors from Shopify product
    const extractSizes = (p: any): string[] => {
      const sizes = new Set<string>();
      // From variants (option1 usually size)
      p.variants?.forEach((v: any) => {
        if (v?.option1 && typeof v.option1 === 'string' && v.option1.trim()) {
          sizes.add(v.option1.trim());
        }
      });
      // From options array
      p.options?.forEach((opt: any) => {
        const name = (opt?.name || '').toLowerCase();
        if (name.includes('size') || name.includes('مقاس') || name.includes('حجم')) {
          opt?.values?.forEach((val: any) => {
            if (typeof val === 'string' && val.trim()) {
              sizes.add(val.trim());
            }
          });
        }
      });
      return Array.from(sizes);
    };

    const extractColors = (p: any): string[] => {
      const colors = new Set<string>();
      // From variants (option2 usually color)
      p.variants?.forEach((v: any) => {
        if (v?.option2 && typeof v.option2 === 'string' && v.option2.trim()) {
          colors.add(v.option2.trim());
        }
      });
      // From options array
      p.options?.forEach((opt: any) => {
        const name = (opt?.name || '').toLowerCase();
        if (name.includes('color') || name.includes('لون') || name.includes('ألوان')) {
          opt?.values?.forEach((val: any) => {
            if (typeof val === 'string' && val.trim()) {
              colors.add(val.trim());
            }
          });
        }
      });
      return Array.from(colors);
    };

    // Sync to database
    for (const product of products) {
      try {
        const totalInventory = product.variants?.reduce(
          (sum: number, v: any) => sum + (v.inventory_quantity || 0), 0
        ) || 0;
        
        const firstVariant = product.variants?.[0];
        const price = firstVariant?.price ? parseFloat(firstVariant.price) : 0;
        const imageUrl = product.images?.[0]?.src || null;
        const tags = product.tags ? product.tags.split(',').map((t: string) => t.trim()) : [];

        const sizes = extractSizes(product);
        const colors = extractColors(product);

        const existingResult = await pool.query(
          'SELECT id FROM products WHERE merchant_id = $1 AND external_id = $2',
          [store.merchant_id, product.id.toString()]
        );

        if (existingResult.rows.length > 0) {
          await pool.query(
            `UPDATE products SET 
              name = $1, description = $2, price = $3, image_url = $4,
              vendor = $5, product_type = $6, tags = $7, status = $8,
              total_inventory = $9, stock = $9, sizes = $10, colors = $11,
              updated_at = CURRENT_TIMESTAMP
             WHERE id = $12`,
            [
              product.title,
              product.body_html || '',
              price,
              imageUrl,
              product.vendor,
              product.product_type,
              tags,
              product.status || 'active',
              totalInventory,
              sizes,
              colors,
              existingResult.rows[0].id
            ]
          );
          result.updated++;
        } else {
          await pool.query(
            `INSERT INTO products (
              merchant_id, external_id, name, description, price, currency, 
              category, stock, sizes, colors, image_url, source, vendor, product_type,
              tags, status, total_inventory
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
            [
              store.merchant_id,
              product.id.toString(),
              product.title,
              product.body_html || '',
              price,
              'USD',
              product.product_type || null,
              totalInventory,
              sizes,
              colors,
              imageUrl,
              'shopify',
              product.vendor,
              product.product_type,
              tags,
              product.status || 'active',
              totalInventory
            ]
          );
          result.created++;
        }
        result.processed++;
      } catch (err) {
        result.failed++;
        logger.error('Error syncing product', err as Error, { productId: product.id });
      }
    }

    // Update last sync timestamp
    await pool.query(
      `UPDATE shopify_stores SET 
        last_products_sync = CURRENT_TIMESTAMP,
        products_count = $1
       WHERE id = $2`,
      [result.processed, store.id]
    );

    // ✅ إبطال كاش المنتجات بعد المزامنة لضمان تحديث الكلمات المفتاحية
    invalidateProductKeywords(store.merchant_id);
    clearProductKeywordsCache(store.merchant_id);
    logger.info('Product keywords cache invalidated after sync', { merchantId: store.merchant_id });

    result.success = true;
    logger.info('Scheduled products sync completed', {
      merchantId: store.merchant_id,
      processed: result.processed,
      created: result.created,
      updated: result.updated
    });
  } catch (error: any) {
    result.error = error.message;
    logger.error('Scheduled products sync failed', error as Error, {
      merchantId: store.merchant_id
    });
  }

  return result;
}

/**
 * Sync orders for a single store
 */
async function syncStoreOrders(store: ShopifyStore): Promise<SyncResult> {
  const result: SyncResult = {
    success: false,
    merchantId: store.merchant_id,
    platform: 'shopify',
    type: 'orders',
    processed: 0,
    created: 0,
    updated: 0,
    failed: 0
  };

  try {
    logger.info('Starting scheduled orders sync', {
      merchantId: store.merchant_id,
      shopDomain: store.shop_domain
    });

    // Fetch orders from Shopify
    const orders: any[] = [];
    let hasNextPage = true;
    let cursor: string | null = null;

    while (hasNextPage) {
      const query = cursor 
        ? `?limit=250&status=any&page_info=${cursor}` 
        : '?limit=250&status=any';
      const apiUrl = buildShopifyAdminApiUrl(store.shop_domain, 'orders.json', query);
      
      const response = await fetch(apiUrl, {
        headers: {
          'X-Shopify-Access-Token': store.access_token,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Shopify API error: ${response.statusText}`);
      }

      const data = await response.json() as { orders?: any[] };
      orders.push(...(data.orders || []));

      const linkHeader = response.headers.get('link');
      if (linkHeader && linkHeader.includes('rel="next"')) {
        const nextMatch = linkHeader.match(/<[^>]*page_info=([^>&]+)[^>]*>;\s*rel="next"/);
        cursor = nextMatch ? nextMatch[1] : null;
        hasNextPage = !!cursor;
      } else {
        hasNextPage = false;
      }
    }

    // Sync to database
    for (const order of orders) {
      try {
        const existingResult = await pool.query(
          'SELECT id FROM orders WHERE merchant_id = $1 AND external_id = $2',
          [store.merchant_id, order.id.toString()]
        );

        if (existingResult.rows.length > 0) {
          await pool.query(
            `UPDATE orders SET 
              customer_name = $1, customer_email = $2, total = $3,
              status = $4, updated_at = CURRENT_TIMESTAMP
             WHERE id = $5`,
            [
              `${order.customer?.first_name || ''} ${order.customer?.last_name || ''}`.trim(),
              order.email || null,
              parseFloat(order.total_price || '0'),
              order.financial_status === 'paid' ? 'paid' : 'pending',
              existingResult.rows[0].id
            ]
          );
          result.updated++;
        } else {
          await pool.query(
            `INSERT INTO orders (
              merchant_id, external_id, customer_name, customer_email, 
              customer_phone, customer_address, total, currency, status, source
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              store.merchant_id,
              order.id.toString(),
              `${order.customer?.first_name || ''} ${order.customer?.last_name || ''}`.trim(),
              order.email || null,
              order.phone || null,
              order.shipping_address ? 
                `${order.shipping_address.address1}, ${order.shipping_address.city}` : null,
              parseFloat(order.total_price || '0'),
              order.currency || 'USD',
              order.financial_status === 'paid' ? 'paid' : 'pending',
              'shopify'
            ]
          );
          result.created++;
        }
        result.processed++;
      } catch (err) {
        result.failed++;
        logger.error('Error syncing order', err as Error, { orderId: order.id });
      }
    }

    // Update last sync timestamp
    await pool.query(
      `UPDATE shopify_stores SET 
        last_orders_sync = CURRENT_TIMESTAMP,
        orders_count = $1
       WHERE id = $2`,
      [result.processed, store.id]
    );

    result.success = true;
    logger.info('Scheduled orders sync completed', {
      merchantId: store.merchant_id,
      processed: result.processed,
      created: result.created,
      updated: result.updated
    });
  } catch (error: any) {
    result.error = error.message;
    logger.error('Scheduled orders sync failed', error as Error, {
      merchantId: store.merchant_id
    });
  }

  return result;
}

/**
 * Run sync for all stores that need it
 */
async function runScheduledSync(): Promise<void> {
  if (isRunning) {
    logger.info('Scheduler already running, skipping this cycle');
    return;
  }

  isRunning = true;

  try {
    logger.info('Starting scheduled sync cycle');

    // Get all stores with auto_sync enabled
    const storesResult = await pool.query<ShopifyStore>(`
      SELECT id, merchant_id, shop_domain, access_token, auto_sync,
             sync_interval, sync_products, sync_orders, sync_inventory,
             last_products_sync, last_orders_sync
      FROM shopify_stores
      WHERE auto_sync = true
    `);

    const stores = storesResult.rows;
    logger.info(`Found ${stores.length} stores with auto-sync enabled`);

    const results: SyncResult[] = [];

    for (const store of stores) {
      const now = new Date();
      const syncIntervalMs = (store.sync_interval || 24) * 60 * 60 * 1000;

      // Check if products need sync
      if (store.sync_products) {
        const lastProductsSync = store.last_products_sync ? new Date(store.last_products_sync) : null;
        const needsProductSync = !lastProductsSync || (now.getTime() - lastProductsSync.getTime()) >= syncIntervalMs;

        if (needsProductSync) {
          const productResult = await syncStoreProducts(store);
          results.push(productResult);
        }
      }

      // Check if orders need sync
      if (store.sync_orders) {
        const lastOrdersSync = store.last_orders_sync ? new Date(store.last_orders_sync) : null;
        const needsOrderSync = !lastOrdersSync || (now.getTime() - lastOrdersSync.getTime()) >= syncIntervalMs;

        if (needsOrderSync) {
          const orderResult = await syncStoreOrders(store);
          results.push(orderResult);
        }
      }

      // Small delay between stores to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Log summary
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    
    logger.info('Scheduled sync cycle completed', {
      totalSyncs: results.length,
      successful: successCount,
      failed: failCount
    });

  } catch (error) {
    logger.error('Error in scheduled sync cycle', error as Error);
  } finally {
    isRunning = false;
  }
}

// =============================================
// SCHEDULER CONTROL
// =============================================

/**
 * Start the sync scheduler
 * @param intervalMinutes Check interval in minutes (default: 15)
 */
export function startSyncScheduler(intervalMinutes: number = 15): void {
  if (schedulerInterval) {
    logger.warn('Sync scheduler already running');
    return;
  }

  const intervalMs = intervalMinutes * 60 * 1000;

  logger.info(`Starting sync scheduler with ${intervalMinutes} minute check interval`);

  // Run immediately on start
  runScheduledSync();

  // Then run on interval
  schedulerInterval = setInterval(runScheduledSync, intervalMs);
}

/**
 * Stop the sync scheduler
 */
export function stopSyncScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    logger.info('Sync scheduler stopped');
  }
}

/**
 * Check if scheduler is running
 */
export function isSchedulerRunning(): boolean {
  return schedulerInterval !== null;
}

/**
 * Manually trigger sync for a specific merchant
 */
export async function triggerMerchantSync(merchantId: string): Promise<SyncResult[]> {
  const storeResult = await pool.query<ShopifyStore>(`
    SELECT id, merchant_id, shop_domain, access_token, auto_sync,
           sync_interval, sync_products, sync_orders, sync_inventory,
           last_products_sync, last_orders_sync
    FROM shopify_stores
    WHERE merchant_id = $1
  `, [merchantId]);

  if (storeResult.rows.length === 0) {
    return [{
      success: false,
      merchantId,
      platform: 'shopify',
      type: 'all',
      processed: 0,
      created: 0,
      updated: 0,
      failed: 0,
      error: 'Store not connected'
    }];
  }

  const store = storeResult.rows[0];
  const results: SyncResult[] = [];

  if (store.sync_products) {
    results.push(await syncStoreProducts(store));
  }
  if (store.sync_orders) {
    results.push(await syncStoreOrders(store));
  }

  return results;
}

// Export for testing
export { runScheduledSync, syncStoreProducts, syncStoreOrders };


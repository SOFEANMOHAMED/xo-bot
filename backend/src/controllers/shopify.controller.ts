import { Response, NextFunction } from 'express';
import crypto from 'crypto';
import pool from '../database/connection.js';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import { buildShopifyAdminApiUrl } from '../config/shopify.js';
import { invalidateProductKeywords } from '../services/cacheService.js';
import { clearProductKeywordsCache } from '../services/tools/catalogTool.js';
import { notifyMerchantNewOrderAsync } from '../services/notifyMerchantNewOrder.js';
import { scheduleProductImageReindex } from '../catalog/visual-embeddings.js';

// =============================================
// TYPES & INTERFACES
// =============================================

interface ShopifyVariant {
  id: number;
  product_id: number;
  title: string;
  price: string;
  compare_at_price: string | null;
  sku: string | null;
  position: number;
  inventory_policy: string;
  inventory_quantity: number;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  barcode: string | null;
  weight: number;
  weight_unit: string;
  requires_shipping: boolean;
  taxable: boolean;
}

interface ShopifyImage {
  id: number;
  product_id: number;
  position: number;
  src: string;
  alt: string | null;
  width: number;
  height: number;
  variant_ids: number[];
}

interface ShopifyOption {
  id: number;
  product_id: number;
  name: string;
  position: number;
  values: string[];
}

interface ShopifyProduct {
  id: number;
  title: string;
  body_html: string | null;
  vendor: string | null;
  product_type: string | null;
  handle: string;
  status: string;
  tags: string;
  variants: ShopifyVariant[];
  images: ShopifyImage[];
  options: ShopifyOption[];
  created_at: string;
  updated_at: string;
}

interface SyncProgress {
  jobId: string;
  totalItems: number;
  processedItems: number;
  createdItems: number;
  updatedItems: number;
  failedItems: number;
  currentPage: number;
  totalPages: number;
  status: 'running' | 'completed' | 'failed';
}

// =============================================
// HELPER FUNCTIONS
// =============================================

// Verify Shopify webhook signature
const verifyShopifySignature = (req: any, secret: string): boolean => {
  const hmacHeader = req.headers['x-shopify-hmac-sha256'];
  if (!hmacHeader) {
    logger.debug('Shopify webhook missing HMAC header');
    return false;
  }

  let rawBody: Buffer;
  if (Buffer.isBuffer(req.body)) {
    rawBody = req.body;
  } else {
    logger.warn('Shopify webhook: body is not a Buffer, verification may fail');
    rawBody = Buffer.from(JSON.stringify(req.body), 'utf8');
  }

  const calculatedHash = crypto.createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64');

  let receivedHmac: Buffer;
  let calculatedHmac: Buffer;
  
  try {
    receivedHmac = Buffer.from(hmacHeader, 'base64');
    calculatedHmac = Buffer.from(calculatedHash, 'base64');
  } catch (error) {
    logger.error('Failed to decode HMAC from base64', error as Error);
    return false;
  }

  if (receivedHmac.length !== calculatedHmac.length) {
    logger.warn('Shopify webhook HMAC length mismatch');
    return false;
  }

  return crypto.timingSafeEqual(receivedHmac, calculatedHmac);
};

// Create or update sync job
const createSyncJob = async (
  merchantId: string, 
  platform: string, 
  jobType: string
): Promise<string> => {
  const result = await pool.query(
    `INSERT INTO sync_jobs (merchant_id, platform, job_type, status, started_at)
     VALUES ($1, $2, $3, 'running', CURRENT_TIMESTAMP)
     RETURNING id`,
    [merchantId, platform, jobType]
  );
  return result.rows[0].id;
};

// Update sync job progress
const updateSyncJob = async (
  jobId: string,
  updates: Partial<SyncProgress>
): Promise<void> => {
  const setClauses: string[] = ['updated_at = CURRENT_TIMESTAMP'];
  const values: any[] = [];
  let paramIndex = 1;

  if (updates.totalItems !== undefined) {
    setClauses.push(`total_items = $${paramIndex++}`);
    values.push(updates.totalItems);
  }
  if (updates.processedItems !== undefined) {
    setClauses.push(`processed_items = $${paramIndex++}`);
    values.push(updates.processedItems);
  }
  if (updates.createdItems !== undefined) {
    setClauses.push(`created_items = $${paramIndex++}`);
    values.push(updates.createdItems);
  }
  if (updates.updatedItems !== undefined) {
    setClauses.push(`updated_items = $${paramIndex++}`);
    values.push(updates.updatedItems);
  }
  if (updates.failedItems !== undefined) {
    setClauses.push(`failed_items = $${paramIndex++}`);
    values.push(updates.failedItems);
  }
  if (updates.currentPage !== undefined) {
    setClauses.push(`current_page = $${paramIndex++}`);
    values.push(updates.currentPage);
  }
  if (updates.totalPages !== undefined) {
    setClauses.push(`total_pages = $${paramIndex++}`);
    values.push(updates.totalPages);
  }
  if (updates.status !== undefined) {
    setClauses.push(`status = $${paramIndex++}`);
    values.push(updates.status);
    if (updates.status === 'completed' || updates.status === 'failed') {
      setClauses.push(`completed_at = CURRENT_TIMESTAMP`);
    }
  }

  values.push(jobId);

  await pool.query(
    `UPDATE sync_jobs SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
    values
  );
};

// =============================================
// FETCH FUNCTIONS
// =============================================

// Fetch products from Shopify with full details
const fetchShopifyProducts = async (
  shopDomain: string, 
  accessToken: string,
  onPageFetched?: (page: number, count: number, nextCursor: string | null) => void
): Promise<{ products: ShopifyProduct[]; pages: number; nextCursor: string | null }> => {
  let pageCount = 0;
  try {
    const products: ShopifyProduct[] = [];
    let hasNextPage = true;
    let cursor: string | null = null;

    while (hasNextPage) {
      pageCount++;
      const query = cursor
        ? `?limit=250&page_info=${cursor}`
        : '?limit=250';

      logger.info('Fetching Shopify products page', {
        shopDomain,
        page: pageCount,
        cursor: cursor ? cursor.substring(0, 20) + '...' : null
      });

      const apiUrl = buildShopifyAdminApiUrl(shopDomain, 'products.json', query);
      const response = await fetch(apiUrl, {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Shopify API error: ${response.statusText}`);
      }

      const data = await response.json() as { products?: ShopifyProduct[] };
      const pageProducts = data.products || [];
      products.push(...pageProducts);

      // Check for pagination using Link header
      const linkHeader = response.headers.get('link');
      let nextCursor: string | null = null;
      
      if (linkHeader && linkHeader.includes('rel="next"')) {
        const nextMatch = linkHeader.match(/<[^>]*page_info=([^>&]+)[^>]*>;\s*rel="next"/);
        nextCursor = nextMatch ? nextMatch[1] : null;
        hasNextPage = !!nextCursor;
      } else {
        hasNextPage = false;
      }

      if (onPageFetched) {
        onPageFetched(pageCount, pageProducts.length, nextCursor);
      }

      logger.info('Shopify products page fetched', {
        shopDomain,
        page: pageCount,
        productsInPage: pageProducts.length,
        totalProducts: products.length,
        hasNextPage
      });

      cursor = nextCursor;
    }

    return { products, pages: pageCount, nextCursor: null };
  } catch (error) {
    logger.error('Error fetching Shopify products', error as Error, { shopDomain, pageCount });
    throw error;
  }
};

// =============================================
// SYNC FUNCTIONS
// =============================================

// Save product variants to database
const saveProductVariants = async (
  productId: string,
  merchantId: string,
  variants: ShopifyVariant[]
): Promise<void> => {
  // Delete existing variants
  await pool.query(
    'DELETE FROM product_variants WHERE product_id = $1 AND merchant_id = $2',
    [productId, merchantId]
  );

  // Insert new variants
  for (const variant of variants) {
    await pool.query(
      `INSERT INTO product_variants (
        product_id, merchant_id, external_id, sku, title, price, compare_at_price,
        currency, inventory_quantity, inventory_policy, weight, weight_unit,
        option1, option2, option3, barcode, requires_shipping, taxable, is_default
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      [
        productId,
        merchantId,
        variant.id.toString(),
        variant.sku,
        variant.title,
        parseFloat(variant.price) || 0,
        variant.compare_at_price ? parseFloat(variant.compare_at_price) : null,
        'USD',
        variant.inventory_quantity || 0,
        variant.inventory_policy || 'deny',
        variant.weight || 0,
        variant.weight_unit || 'kg',
        variant.option1,
        variant.option2,
        variant.option3,
        variant.barcode,
        variant.requires_shipping ?? true,
        variant.taxable ?? true,
        variant.position === 1
      ]
    );
  }
};

// Save product images to database (maps Shopify variant_ids → local product_variants UUIDs)
const saveProductImages = async (
  productId: string,
  merchantId: string,
  images: ShopifyImage[]
): Promise<void> => {
  // Delete existing images
  await pool.query(
    'DELETE FROM product_images WHERE product_id = $1 AND merchant_id = $2',
    [productId, merchantId]
  );

  // Map Shopify numeric variant IDs → local UUIDs (for color-aware bot images)
  const variantMapResult = await pool.query(
    `SELECT id, external_id FROM product_variants
     WHERE product_id = $1 AND merchant_id = $2 AND external_id IS NOT NULL`,
    [productId, merchantId]
  );
  const shopifyVariantToUuid = new Map<string, string>();
  for (const row of variantMapResult.rows) {
    if (row.external_id) {
      shopifyVariantToUuid.set(String(row.external_id), row.id);
    }
  }

  // Insert new images
  for (const image of images) {
    const localVariantIds = (image.variant_ids || [])
      .map((vid) => shopifyVariantToUuid.get(String(vid)))
      .filter((id): id is string => Boolean(id));

    await pool.query(
      `INSERT INTO product_images (
        product_id, merchant_id, external_id, src, alt, position, width, height, is_primary, variant_ids
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        productId,
        merchantId,
        image.id.toString(),
        image.src,
        image.alt,
        image.position || 0,
        image.width || null,
        image.height || null,
        image.position === 1,
        localVariantIds.length > 0 ? localVariantIds : null
      ]
    );
  }
};

// Save product options to database
const saveProductOptions = async (
  productId: string,
  merchantId: string,
  options: ShopifyOption[]
): Promise<void> => {
  // Delete existing options
  await pool.query(
    'DELETE FROM product_options WHERE product_id = $1 AND merchant_id = $2',
    [productId, merchantId]
  );

  // Insert new options
  for (const option of options) {
    await pool.query(
      `INSERT INTO product_options (
        product_id, merchant_id, external_id, name, position, values
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        productId,
        merchantId,
        option.id.toString(),
        option.name,
        option.position || 0,
        option.values
      ]
    );
  }
};

// Enhanced sync Shopify products to database
export const syncShopifyProducts = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  let jobId: string | null = null;
  
  try {
    if (!req.merchantId) {
      return next(createError('Unauthorized', 401));
    }

    // Get Shopify store info
    const storeResult = await pool.query(
      'SELECT id, shop_domain, access_token FROM shopify_stores WHERE merchant_id = $1 LIMIT 1',
      [req.merchantId]
    );

    if (storeResult.rows.length === 0) {
      return next(createError('Shopify store not connected', 400));
    }

    const { id: storeId, shop_domain, access_token } = storeResult.rows[0];

    // Create sync job
    jobId = await createSyncJob(req.merchantId, 'shopify', 'products');

    logger.info('Starting enhanced Shopify products sync', { 
      merchantId: req.merchantId, 
      shopDomain: shop_domain,
      jobId
    });

    // Fetch products from Shopify with pagination tracking
    const fetchResult = await fetchShopifyProducts(
      shop_domain, 
      access_token,
      async (page, count, nextCursor) => {
        if (jobId) {
          await updateSyncJob(jobId, { currentPage: page });
        }
        logger.info('Shopify sync progress', {
          merchantId: req.merchantId,
          page,
          productsInPage: count
        });
      }
    );

    const shopifyProducts = fetchResult.products;
    const totalPages = fetchResult.pages;

    // Update job with total items
    await updateSyncJob(jobId, {
      totalItems: shopifyProducts.length,
      totalPages
    });

    logger.info('Shopify products fetched', {
      merchantId: req.merchantId,
      totalProducts: shopifyProducts.length,
      totalPages
    });

    // Sync products to database
    let processedCount = 0;
    let createdCount = 0;
    let updatedCount = 0;
    let failedCount = 0;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const shopifyProduct of shopifyProducts) {
        try {
          // Calculate total inventory
          const totalInventory = shopifyProduct.variants?.reduce(
            (sum, v) => sum + (v.inventory_quantity || 0), 0
          ) || 0;

          // Get first variant for primary price
          const firstVariant = shopifyProduct.variants?.[0];
          const price = firstVariant?.price ? parseFloat(firstVariant.price) : 0;
          const primaryImageUrl = shopifyProduct.images?.[0]?.src || null;

          // Parse tags
          const tags = shopifyProduct.tags 
            ? shopifyProduct.tags.split(',').map(t => t.trim()).filter(t => t)
            : [];

          // Check if product exists
          const existingResult = await client.query(
            'SELECT id FROM products WHERE merchant_id = $1 AND external_id = $2',
            [req.merchantId, shopifyProduct.id.toString()]
          );

          let productId: string;

          if (existingResult.rows.length > 0) {
            // Update existing product
            productId = existingResult.rows[0].id;
            await client.query(
              `UPDATE products SET 
                name = $1, description = $2, price = $3, image_url = $4,
                vendor = $5, product_type = $6, tags = $7, status = $8,
                handle = $9, total_inventory = $10, has_variants = $11,
                stock = $12, category = $13, updated_at = CURRENT_TIMESTAMP
               WHERE id = $14 AND merchant_id = $15`,
              [
                shopifyProduct.title,
                shopifyProduct.body_html || '',
                price,
                primaryImageUrl,
                shopifyProduct.vendor,
                shopifyProduct.product_type,
                tags,
                shopifyProduct.status || 'active',
                shopifyProduct.handle,
                totalInventory,
                (shopifyProduct.variants?.length || 0) > 1,
                totalInventory,
                shopifyProduct.product_type,
                productId,
                req.merchantId
              ]
            );
            updatedCount++;
          } else {
            // Create new product
            const insertResult = await client.query(
              `INSERT INTO products (
                merchant_id, external_id, name, description, price, currency, 
                category, stock, image_url, source, vendor, product_type,
                tags, status, handle, total_inventory, has_variants
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
              RETURNING id`,
              [
                req.merchantId,
                shopifyProduct.id.toString(),
                shopifyProduct.title,
                shopifyProduct.body_html || '',
                price,
                'USD',
                shopifyProduct.product_type || null,
                totalInventory,
                primaryImageUrl,
                'shopify',
                shopifyProduct.vendor,
                shopifyProduct.product_type,
                tags,
                shopifyProduct.status || 'active',
                shopifyProduct.handle,
                totalInventory,
                (shopifyProduct.variants?.length || 0) > 1
              ]
            );
            productId = insertResult.rows[0].id;
            createdCount++;
          }

          // Save variants
          if (shopifyProduct.variants && shopifyProduct.variants.length > 0) {
            await saveProductVariants(productId, req.merchantId, shopifyProduct.variants);
          }

          // Save images
          if (shopifyProduct.images && shopifyProduct.images.length > 0) {
            await saveProductImages(productId, req.merchantId, shopifyProduct.images);
          }
          scheduleProductImageReindex(req.merchantId!, productId);

          // Save options
          if (shopifyProduct.options && shopifyProduct.options.length > 0) {
            await saveProductOptions(productId, req.merchantId, shopifyProduct.options);
          }

          processedCount++;

          // Update job progress every 10 products
          if (processedCount % 10 === 0 && jobId) {
            await updateSyncJob(jobId, {
              processedItems: processedCount,
              createdItems: createdCount,
              updatedItems: updatedCount,
              failedItems: failedCount
            });
          }
        } catch (productError) {
          logger.error('Error syncing individual product', productError as Error, {
            productId: shopifyProduct.id,
            productTitle: shopifyProduct.title
          });
          failedCount++;
        }
      }

      await client.query('COMMIT');

      // Update store stats
      await pool.query(
        `UPDATE shopify_stores SET 
          last_sync = CURRENT_TIMESTAMP,
          last_products_sync = CURRENT_TIMESTAMP,
          products_count = $1
         WHERE id = $2`,
        [processedCount, storeId]
      );

      // Update job as completed
      await updateSyncJob(jobId, {
        status: 'completed',
        processedItems: processedCount,
        createdItems: createdCount,
        updatedItems: updatedCount,
        failedItems: failedCount
      });

      logger.info('Shopify products sync completed', {
        merchantId: req.merchantId,
        shopDomain: shop_domain,
        processed: processedCount,
        created: createdCount,
        updated: updatedCount,
        failed: failedCount,
        pages: totalPages
      });

      // ✅ إبطال كاش المنتجات بعد المزامنة لضمان تحديث الكلمات المفتاحية
      invalidateProductKeywords(req.merchantId!);
      clearProductKeywordsCache(req.merchantId!);
      logger.info('Product keywords cache invalidated after Shopify sync', { merchantId: req.merchantId });

      // Get products for response
      const productsResult = await pool.query(
        `SELECT id, external_id as "externalId", name, description, price, currency,
                category, stock, image_url as "imageUrl", source, vendor, product_type as "productType",
                tags, status, handle, total_inventory as "totalInventory", has_variants as "hasVariants"
         FROM products WHERE merchant_id = $1 AND source = 'shopify'
         ORDER BY updated_at DESC
         LIMIT 100`,
        [req.merchantId]
      );

      res.json({
        success: true,
        data: {
          jobId,
          imported: processedCount,
          created: createdCount,
          updated: updatedCount,
          failed: failedCount,
          pages: totalPages,
          completed: true,
          synced: processedCount,
          message: `تم مزامنة ${processedCount} منتج من Shopify (${createdCount} جديد، ${updatedCount} محدث)`,
          products: productsResult.rows
        }
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error: any) {
    if (jobId) {
      await updateSyncJob(jobId, {
        status: 'failed'
      });
      // Update error in separate query
      await pool.query(
        'UPDATE sync_jobs SET error_message = $1 WHERE id = $2',
        [error.message, jobId]
      );
    }
    logger.error('Error syncing Shopify products', error as Error, { merchantId: req.merchantId });
    next(error);
  }
};

// Get sync job status
export const getSyncJobStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const { jobId } = req.params;

    const result = await pool.query(
      `SELECT id, platform, job_type, status, total_items, processed_items,
              created_items, updated_items, failed_items, current_page, total_pages,
              error_message, started_at, completed_at, created_at
       FROM sync_jobs WHERE id = $1 AND merchant_id = $2`,
      [jobId, req.merchantId]
    );

    if (result.rows.length === 0) {
      return next(createError('Sync job not found', 404));
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    logger.error('Error getting sync job status', error as Error);
    next(error);
  }
};

// Get sync history
export const getSyncHistory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const { platform, limit = '20' } = req.query;

    let query = `
      SELECT id, platform, job_type, status, total_items, processed_items,
             created_items, updated_items, failed_items, error_message,
             started_at, completed_at, created_at
      FROM sync_jobs WHERE merchant_id = $1
    `;
    const params: any[] = [req.merchantId];

    if (platform) {
      query += ` AND platform = $2`;
      params.push(platform);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit as string));

    const result = await pool.query(query, params);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    logger.error('Error getting sync history', error as Error);
    next(error);
  }
};

// Fetch orders from Shopify
const fetchShopifyOrders = async (shopDomain: string, accessToken: string): Promise<any[]> => {
  try {
    const orders: any[] = [];
    let hasNextPage = true;
    let cursor = null;

    while (hasNextPage) {
      const query = cursor
        ? `?limit=250&status=any&page_info=${cursor}`
        : '?limit=250&status=any';

      const apiUrl = buildShopifyAdminApiUrl(shopDomain, 'orders.json', query);
      const response = await fetch(apiUrl, {
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Shopify API error: ${response.statusText}`);
      }

      const data = await response.json() as { orders?: Array<any> };
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

    return orders;
  } catch (error) {
    logger.error('Error fetching Shopify orders', error as Error, { shopDomain });
    throw error;
  }
};

// Sync Shopify orders to database
export const syncShopifyOrders = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  let jobId: string | null = null;

  try {
    if (!req.merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const storeResult = await pool.query(
      'SELECT id, shop_domain, access_token FROM shopify_stores WHERE merchant_id = $1 LIMIT 1',
      [req.merchantId]
    );

    if (storeResult.rows.length === 0) {
      return next(createError('Shopify store not connected', 400));
    }

    const { id: storeId, shop_domain, access_token } = storeResult.rows[0];

    // Create sync job
    jobId = await createSyncJob(req.merchantId, 'shopify', 'orders');

    logger.info('Starting Shopify orders sync', { merchantId: req.merchantId, shopDomain: shop_domain });

    const shopifyOrders = await fetchShopifyOrders(shop_domain, access_token);

    await updateSyncJob(jobId, { totalItems: shopifyOrders.length });

    let syncedCount = 0;
    let createdCount = 0;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const shopifyOrder of shopifyOrders) {
        const existingResult = await client.query(
          'SELECT id FROM orders WHERE merchant_id = $1 AND external_id = $2',
          [req.merchantId, shopifyOrder.id.toString()]
        );

        if (existingResult.rows.length > 0) {
          await client.query(
            `UPDATE orders SET 
              customer_name = $1, customer_email = $2, customer_phone = $3,
              customer_address = $4, total = $5, status = $6, updated_at = CURRENT_TIMESTAMP
             WHERE id = $7`,
            [
              `${shopifyOrder.customer?.first_name || ''} ${shopifyOrder.customer?.last_name || ''}`.trim(),
              shopifyOrder.email || null,
              shopifyOrder.phone || null,
              shopifyOrder.shipping_address ? 
                `${shopifyOrder.shipping_address.address1}, ${shopifyOrder.shipping_address.city}, ${shopifyOrder.shipping_address.country}` : null,
              parseFloat(shopifyOrder.total_price || '0'),
              shopifyOrder.financial_status === 'paid' ? 'paid' : 'pending',
              existingResult.rows[0].id
            ]
          );
        } else {
          const orderResult = await client.query(
            `INSERT INTO orders (
              merchant_id, external_id, customer_name, customer_email, 
              customer_phone, customer_address, total, currency, status, source
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id`,
            [
              req.merchantId,
              shopifyOrder.id.toString(),
              `${shopifyOrder.customer?.first_name || ''} ${shopifyOrder.customer?.last_name || ''}`.trim(),
              shopifyOrder.email || null,
              shopifyOrder.phone || null,
              shopifyOrder.shipping_address ? 
                `${shopifyOrder.shipping_address.address1}, ${shopifyOrder.shipping_address.city}, ${shopifyOrder.shipping_address.country}` : null,
              parseFloat(shopifyOrder.total_price || '0'),
              shopifyOrder.currency || 'USD',
              shopifyOrder.financial_status === 'paid' ? 'paid' : 'pending',
              'shopify'
            ]
          );

          const orderId = orderResult.rows[0].id;

          for (const lineItem of shopifyOrder.line_items || []) {
            await client.query(
              `INSERT INTO order_items (order_id, product_name, quantity, price, currency)
               VALUES ($1, $2, $3, $4, $5)`,
              [orderId, lineItem.name, lineItem.quantity, parseFloat(lineItem.price || '0'), shopifyOrder.currency || 'USD']
            );
          }

          createdCount++;
        }
        syncedCount++;
      }

      await client.query('COMMIT');

      // Update store stats
      await pool.query(
        `UPDATE shopify_stores SET 
          last_sync = CURRENT_TIMESTAMP,
          last_orders_sync = CURRENT_TIMESTAMP,
          orders_count = $1
         WHERE id = $2`,
        [syncedCount, storeId]
      );

      await updateSyncJob(jobId, {
        status: 'completed',
        processedItems: syncedCount,
        createdItems: createdCount,
        updatedItems: syncedCount - createdCount
      });

      logger.info('Shopify orders sync completed', {
        merchantId: req.merchantId,
        total: syncedCount,
        created: createdCount
      });

      res.json({
        success: true,
        data: {
          jobId,
          synced: syncedCount,
          created: createdCount,
          message: `تم مزامنة ${syncedCount} طلب من Shopify (${createdCount} جديد)`
        }
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error: any) {
    if (jobId) {
      await updateSyncJob(jobId, { status: 'failed' });
      await pool.query('UPDATE sync_jobs SET error_message = $1 WHERE id = $2', [error.message, jobId]);
    }
    logger.error('Error syncing Shopify orders', error as Error, { merchantId: req.merchantId });
    next(error);
  }
};

// Shopify OAuth callback
export const shopifyCallback = async (
  req: any,
  res: Response,
  next: NextFunction
) => {
  try {
    const { code, shop, state } = req.query;

    if (!code || !shop || !state) {
      return next(createError('Missing authorization code, shop, or state', 400));
    }

    let stateData: { merchantId?: string; shopDomain?: string };
    try {
      stateData = JSON.parse(Buffer.from(state, 'base64').toString());
    } catch (error) {
      return next(createError('Invalid state parameter format', 400));
    }

    const merchantId = stateData.merchantId;
    if (!merchantId) {
      return next(createError('Invalid state parameter: missing merchantId', 400));
    }

    const normalizedShop = shop.includes('.myshopify.com') ? shop : `${shop}.myshopify.com`;
    const shopDomain = normalizedShop;

    const shopifyApiKey = process.env.SHOPIFY_API_KEY;
    const shopifyApiSecret = process.env.SHOPIFY_API_SECRET;

    const tokenResponse = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: shopifyApiKey,
        client_secret: shopifyApiSecret,
        code
      })
    });

    const tokenData = await tokenResponse.json() as { access_token?: string };

    if (!tokenResponse.ok || !tokenData.access_token) {
      return next(createError('Failed to exchange authorization code', 400));
    }

    await pool.query(
      `INSERT INTO shopify_stores (merchant_id, shop_domain, access_token, auto_sync, sync_products, sync_orders)
       VALUES ($1, $2, $3, true, true, true)
       ON CONFLICT (merchant_id, shop_domain)
       DO UPDATE SET access_token = $3, updated_at = CURRENT_TIMESTAMP`,
      [merchantId, shopDomain, tokenData.access_token]
    );

    // Register webhooks
    await registerShopifyWebhooks(shopDomain, tokenData.access_token, merchantId);

    logger.info('Shopify OAuth completed successfully', { merchantId, shopDomain });

    res.redirect(`${process.env.CORS_ORIGIN}/app/integrations?shopify=connected`);
  } catch (error) {
    logger.error('Error in Shopify OAuth callback', error as Error);
    next(error);
  }
};

// Register Shopify webhooks
const registerShopifyWebhooks = async (
  shopDomain: string,
  accessToken: string,
  merchantId: string
): Promise<void> => {
  const webhookTopics = [
    'products/create',
    'products/update',
    'products/delete',
    'orders/create',
    'orders/updated',
    'inventory_levels/update'
  ];

  const webhookUrl = `${process.env.BACKEND_URL || process.env.CORS_ORIGIN}/api/webhooks/shopify`;

  for (const topic of webhookTopics) {
    try {
      const apiUrl = buildShopifyAdminApiUrl(shopDomain, 'webhooks.json', '');
      await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          webhook: {
            topic,
            address: webhookUrl,
            format: 'json'
          }
        })
      });
      logger.info('Shopify webhook registered', { shopDomain, topic });
    } catch (error) {
      logger.warn('Failed to register Shopify webhook', { shopDomain, topic, error });
    }
  }

  await pool.query(
    'UPDATE shopify_stores SET webhooks_registered = true WHERE merchant_id = $1 AND shop_domain = $2',
    [merchantId, shopDomain]
  );
};

// Enhanced Shopify webhook handler
export const shopifyWebhook = async (
  req: any,
  res: Response,
  next: NextFunction
) => {
  try {
    let rawBodyForVerification: Buffer;
    if (Buffer.isBuffer(req.body)) {
      rawBodyForVerification = req.body;
      try {
        req.body = JSON.parse(req.body.toString('utf8'));
      } catch (parseError) {
        return next(createError('Invalid JSON body', 400));
      }
    } else {
      rawBodyForVerification = Buffer.from(JSON.stringify(req.body), 'utf8');
    }

    const shopifySecret = process.env.SHOPIFY_API_SECRET;
    if (shopifySecret) {
      const originalBody = req.body;
      req.body = rawBodyForVerification;
      const isValid = verifyShopifySignature(req, shopifySecret);
      req.body = originalBody;
      
      if (!isValid) {
        logger.warn('Invalid Shopify webhook signature');
        return next(createError('Invalid signature', 403));
      }
    }

    const topic = req.headers['x-shopify-topic'];
    const shopDomain = req.headers['x-shopify-shop-domain'];

    logger.info('Shopify webhook received', { topic, shopDomain });

    const merchantResult = await pool.query(
      'SELECT merchant_id FROM shopify_stores WHERE shop_domain = $1 LIMIT 1',
      [shopDomain]
    );

    if (merchantResult.rows.length === 0) {
      return res.json({ success: true });
    }

    const merchantId = merchantResult.rows[0].merchant_id;

    switch (topic) {
      case 'products/create':
      case 'products/update':
        await handleProductWebhook(merchantId, req.body);
        break;

      case 'products/delete':
        await handleProductDeleteWebhook(merchantId, req.body);
        break;

      case 'orders/create':
      case 'orders/updated':
        await handleOrderWebhook(merchantId, req.body);
        break;

      case 'inventory_levels/update':
        await handleInventoryWebhook(merchantId, req.body);
        break;

      default:
        logger.info('Unhandled Shopify webhook topic', { topic, shopDomain });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Error in Shopify webhook', error as Error);
    next(error);
  }
};

// Handle product webhook
const handleProductWebhook = async (merchantId: string, product: any): Promise<void> => {
  const totalInventory = product.variants?.reduce(
    (sum: number, v: any) => sum + (v.inventory_quantity || 0), 0
  ) || 0;

  const firstVariant = product.variants?.[0];
  const price = firstVariant?.price ? parseFloat(firstVariant.price) : 0;
  const primaryImageUrl = product.images?.[0]?.src || null;
  const tags = product.tags ? product.tags.split(',').map((t: string) => t.trim()).filter((t: string) => t) : [];

  const result = await pool.query(
    `INSERT INTO products (
      merchant_id, external_id, name, description, price, currency, 
      category, stock, image_url, source, vendor, product_type,
      tags, status, handle, total_inventory, has_variants
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    ON CONFLICT (merchant_id, external_id) 
    DO UPDATE SET 
      name = $3, description = $4, price = $5, category = $7, stock = $8, 
      image_url = $9, vendor = $11, product_type = $12, tags = $13,
      status = $14, handle = $15, total_inventory = $16, has_variants = $17,
      updated_at = CURRENT_TIMESTAMP
    RETURNING id`,
    [
      merchantId,
      product.id.toString(),
      product.title,
      product.body_html || '',
      price,
      'USD',
      product.product_type || null,
      totalInventory,
      primaryImageUrl,
      'shopify',
      product.vendor,
      product.product_type,
      tags,
      product.status || 'active',
      product.handle,
      totalInventory,
      (product.variants?.length || 0) > 1
    ]
  );

  const productId = result.rows[0].id;

  if (product.variants?.length > 0) {
    await saveProductVariants(productId, merchantId, product.variants);
  }
  if (product.images?.length > 0) {
    await saveProductImages(productId, merchantId, product.images);
  }
  if (product.options?.length > 0) {
    await saveProductOptions(productId, merchantId, product.options);
  }

  scheduleProductImageReindex(merchantId, productId);

  // ✅ إبطال كاش المنتجات بعد تحديث/إضافة منتج عبر webhook
  invalidateProductKeywords(merchantId);
  clearProductKeywordsCache(merchantId);

  logger.info('Shopify product synced via webhook', { merchantId, productId: product.id });
};

// Handle product delete webhook
const handleProductDeleteWebhook = async (merchantId: string, data: any): Promise<void> => {
  await pool.query(
    'DELETE FROM products WHERE merchant_id = $1 AND external_id = $2',
    [merchantId, data.id.toString()]
  );

  // ✅ إبطال كاش المنتجات بعد حذف منتج
  invalidateProductKeywords(merchantId);
  clearProductKeywordsCache(merchantId);

  logger.info('Shopify product deleted via webhook', { merchantId, productId: data.id });
};

// Handle order webhook
const handleOrderWebhook = async (merchantId: string, order: any): Promise<void> => {
  const existingOrder = await pool.query(
    'SELECT id FROM orders WHERE merchant_id = $1 AND external_id = $2',
    [merchantId, order.id.toString()]
  );

  if (existingOrder.rows.length === 0) {
    const orderResult = await pool.query(
      `INSERT INTO orders (
        merchant_id, external_id, customer_name, customer_email, 
        customer_phone, customer_address, total, currency, status, source
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id`,
      [
        merchantId,
        order.id.toString(),
        `${order.customer?.first_name || ''} ${order.customer?.last_name || ''}`.trim(),
        order.email || null,
        order.phone || null,
        order.shipping_address ? 
          `${order.shipping_address.address1}, ${order.shipping_address.city}, ${order.shipping_address.country}` : null,
        parseFloat(order.total_price || '0'),
        order.currency || 'USD',
        order.financial_status === 'paid' ? 'paid' : 'pending',
        'shopify'
      ]
    );

    for (const lineItem of order.line_items || []) {
      await pool.query(
        `INSERT INTO order_items (order_id, product_name, quantity, price, currency)
         VALUES ($1, $2, $3, $4, $5)`,
        [orderResult.rows[0].id, lineItem.name, lineItem.quantity, parseFloat(lineItem.price || '0'), order.currency || 'USD']
      );
    }

    const shippingAddress = order.shipping_address
      ? `${order.shipping_address.address1 || ''}, ${order.shipping_address.city || ''}, ${order.shipping_address.country || ''}`.trim()
      : null;

    notifyMerchantNewOrderAsync({
      merchantId,
      orderId: orderResult.rows[0].id,
      customerName: `${order.customer?.first_name || ''} ${order.customer?.last_name || ''}`.trim() || null,
      customerPhone: order.phone || null,
      customerEmail: order.email || null,
      customerAddress: shippingAddress,
      total: parseFloat(order.total_price || '0'),
      currency: order.currency || 'USD',
      source: 'shopify',
      items: (order.line_items || []).map((lineItem: any) => ({
        productName: lineItem.name,
        quantity: lineItem.quantity || 1,
        price: parseFloat(lineItem.price || '0'),
      })),
    });

    logger.info('Shopify order synced via webhook', { merchantId, orderId: order.id });
  }
};

// Handle inventory webhook
const handleInventoryWebhook = async (merchantId: string, data: any): Promise<void> => {
  // Update variant inventory
  if (data.inventory_item_id) {
    await pool.query(
      `UPDATE product_variants SET inventory_quantity = $1, updated_at = CURRENT_TIMESTAMP
       WHERE merchant_id = $2 AND external_id IN (
         SELECT external_id FROM product_variants WHERE merchant_id = $2
       )`,
      [data.available || 0, merchantId]
    );
    logger.info('Shopify inventory updated via webhook', { merchantId, inventoryItemId: data.inventory_item_id });
  }
};

// Shopify health check endpoint
export const shopifyHealth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.merchantId) {
      return next(createError('Unauthorized', 401));
    }

    let dbConnected = false;
    try {
      await pool.query('SELECT 1');
      dbConnected = true;
    } catch (error) {
      logger.error('Database connectivity check failed', error as Error);
    }

    const result = await pool.query(
      `SELECT shop_domain, last_sync, last_products_sync, last_orders_sync,
              products_count, orders_count, auto_sync, sync_interval,
              webhooks_registered
       FROM shopify_stores WHERE merchant_id = $1 LIMIT 1`,
      [req.merchantId]
    );

    const shopifyStoreExists = result.rows.length > 0;
    const storeData = result.rows[0] || {};

    res.json({
      success: true,
      data: {
        database: { connected: dbConnected },
        shopify: {
          connected: shopifyStoreExists,
          shopDomain: storeData.shop_domain || null,
          lastSync: storeData.last_sync || null,
          lastProductsSync: storeData.last_products_sync || null,
          lastOrdersSync: storeData.last_orders_sync || null,
          productsCount: storeData.products_count || 0,
          ordersCount: storeData.orders_count || 0,
          autoSync: storeData.auto_sync || false,
          syncInterval: storeData.sync_interval || 24,
          webhooksRegistered: storeData.webhooks_registered || false
        }
      }
    });
  } catch (error) {
    logger.error('Error in Shopify health check', error as Error);
    next(error);
  }
};

// Update Shopify store settings
export const updateShopifySettings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const { autoSync, syncInterval, syncProducts, syncOrders, syncInventory } = req.body;

    await pool.query(
      `UPDATE shopify_stores SET 
        auto_sync = COALESCE($1, auto_sync),
        sync_interval = COALESCE($2, sync_interval),
        sync_products = COALESCE($3, sync_products),
        sync_orders = COALESCE($4, sync_orders),
        sync_inventory = COALESCE($5, sync_inventory),
        updated_at = CURRENT_TIMESTAMP
       WHERE merchant_id = $6`,
      [autoSync, syncInterval, syncProducts, syncOrders, syncInventory, req.merchantId]
    );

    res.json({
      success: true,
      message: 'تم تحديث إعدادات Shopify بنجاح'
    });
  } catch (error) {
    logger.error('Error updating Shopify settings', error as Error);
    next(error);
  }
};

// Get product with variants and images
export const getProductDetails = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const { productId } = req.params;

    // Get product
    const productResult = await pool.query(
      `SELECT id, external_id, name, description, price, currency, category, stock,
              image_url, source, vendor, product_type, tags, status, handle,
              total_inventory, has_variants, created_at, updated_at
       FROM products WHERE id = $1 AND merchant_id = $2`,
      [productId, req.merchantId]
    );

    if (productResult.rows.length === 0) {
      return next(createError('Product not found', 404));
    }

    const product = productResult.rows[0];

    // Get variants
    const variantsResult = await pool.query(
      `SELECT id, external_id, sku, title, price, compare_at_price, currency,
              inventory_quantity, inventory_policy, weight, weight_unit,
              option1, option2, option3, barcode, requires_shipping, taxable, is_default
       FROM product_variants WHERE product_id = $1 AND merchant_id = $2
       ORDER BY is_default DESC, id`,
      [productId, req.merchantId]
    );

    // Get images
    const imagesResult = await pool.query(
      `SELECT id, external_id, src, alt, position, width, height, is_primary
       FROM product_images WHERE product_id = $1 AND merchant_id = $2
       ORDER BY position`,
      [productId, req.merchantId]
    );

    // Get options
    const optionsResult = await pool.query(
      `SELECT id, external_id, name, position, values
       FROM product_options WHERE product_id = $1 AND merchant_id = $2
       ORDER BY position`,
      [productId, req.merchantId]
    );

    res.json({
      success: true,
      data: {
        ...product,
        variants: variantsResult.rows,
        images: imagesResult.rows,
        options: optionsResult.rows
      }
    });
  } catch (error) {
    logger.error('Error getting product details', error as Error);
    next(error);
  }
};

// Push product to Shopify (bidirectional sync)
export const pushProductToShopify = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const { productId } = req.params;

    // Get Shopify store info
    const storeResult = await pool.query(
      'SELECT shop_domain, access_token FROM shopify_stores WHERE merchant_id = $1 LIMIT 1',
      [req.merchantId]
    );

    if (storeResult.rows.length === 0) {
      return next(createError('Shopify store not connected', 400));
    }

    const { shop_domain, access_token } = storeResult.rows[0];

    // Get product with variants
    const productResult = await pool.query(
      `SELECT * FROM products WHERE id = $1 AND merchant_id = $2`,
      [productId, req.merchantId]
    );

    if (productResult.rows.length === 0) {
      return next(createError('Product not found', 404));
    }

    const product = productResult.rows[0];

    // Get variants
    const variantsResult = await pool.query(
      `SELECT * FROM product_variants WHERE product_id = $1 AND merchant_id = $2`,
      [productId, req.merchantId]
    );

    // Get images
    const imagesResult = await pool.query(
      `SELECT * FROM product_images WHERE product_id = $1 AND merchant_id = $2 ORDER BY position`,
      [productId, req.merchantId]
    );

    // Prepare Shopify product data
    const shopifyProduct: any = {
      title: product.name,
      body_html: product.description,
      vendor: product.vendor,
      product_type: product.product_type,
      tags: product.tags?.join(', ') || '',
      status: product.status || 'active',
      variants: variantsResult.rows.map(v => ({
        price: v.price.toString(),
        compare_at_price: v.compare_at_price?.toString() || null,
        sku: v.sku,
        inventory_quantity: v.inventory_quantity,
        option1: v.option1,
        option2: v.option2,
        option3: v.option3,
        weight: v.weight,
        weight_unit: v.weight_unit,
        requires_shipping: v.requires_shipping,
        taxable: v.taxable
      })),
      images: imagesResult.rows.map(i => ({
        src: i.src,
        alt: i.alt,
        position: i.position
      }))
    };

    let apiUrl: string;
    let method: string;

    if (product.external_id) {
      // Update existing product
      apiUrl = buildShopifyAdminApiUrl(shop_domain, `products/${product.external_id}.json`, '');
      method = 'PUT';
    } else {
      // Create new product
      apiUrl = buildShopifyAdminApiUrl(shop_domain, 'products.json', '');
      method = 'POST';
    }

    const response = await fetch(apiUrl, {
      method,
      headers: {
        'X-Shopify-Access-Token': access_token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ product: shopifyProduct })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Shopify API error: ${JSON.stringify(errorData)}`);
    }

    const responseData = await response.json() as { product: any };

    // Update local product with Shopify ID
    if (!product.external_id) {
      await pool.query(
        'UPDATE products SET external_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [responseData.product.id.toString(), productId]
      );
    }

    logger.info('Product pushed to Shopify', { merchantId: req.merchantId, productId, shopifyId: responseData.product.id });

    res.json({
      success: true,
      message: 'تم رفع المنتج إلى Shopify بنجاح',
      data: {
        shopifyId: responseData.product.id,
        handle: responseData.product.handle
      }
    });
  } catch (error) {
    logger.error('Error pushing product to Shopify', error as Error);
    next(error);
  }
};

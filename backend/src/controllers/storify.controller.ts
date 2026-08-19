import { Response, NextFunction } from 'express';
import pool from '../database/connection.js';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';
import { invalidateProductKeywords } from '../services/cacheService.js';
import { clearProductKeywordsCache } from '../services/tools/catalogTool.js';
import { scheduleProductImageReindex } from '../catalog/visual-embeddings.js';

interface StorifyStoreConfig {
  storeDomain: string;
  apiBaseUrl: string;
  accessToken: string;
  productsEndpoint: string;
}

interface SyncProgress {
  totalItems: number;
  processedItems: number;
  createdItems: number;
  updatedItems: number;
  failedItems: number;
  currentPage: number;
  totalPages: number;
  status: 'running' | 'completed' | 'failed';
}

type GenericRecord = Record<string, any>;

type NormalizedStorifyProduct = {
  externalId: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  category: string | null;
  stock: number;
  primaryImageUrl: string | null;
  imageUrls: string[];
  sizes: string[];
  colors: string[];
  options: Array<{ name: string; position: number; values: string[] }>;
};

const DEFAULT_PRODUCTS_ENDPOINT = '/api/storefront/products';

export function normalizeStorifyStoreDomain(rawValue: string): string {
  return rawValue
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '')
    .toLowerCase();
}

function normalizeApiBaseUrl(rawValue: string, storeDomain: string): string {
  const trimmed = (rawValue || '').trim();
  if (!trimmed) {
    return `https://${storeDomain}`;
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, '');
}

function normalizeProductsEndpoint(rawValue?: string): string {
  const trimmed = (rawValue || '').trim();
  if (!trimmed) {
    return DEFAULT_PRODUCTS_ENDPOINT;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function buildStorifyProductsUrl(
  apiBaseUrl: string,
  productsEndpoint: string,
  params?: Record<string, string>
): string {
  const endpoint = /^https?:\/\//i.test(productsEndpoint)
    ? productsEndpoint
    : `${apiBaseUrl}${productsEndpoint}`;
  const url = new URL(endpoint);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (!url.searchParams.has(key)) {
        url.searchParams.set(key, value);
      }
    }
  }

  return url.toString();
}

function buildStorifyHeaders(accessToken: string): HeadersInit {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  };
}

function asArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function extractProductList(payload: unknown): GenericRecord[] {
  if (Array.isArray(payload)) {
    return payload.filter(Boolean) as GenericRecord[];
  }

  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const record = payload as GenericRecord;
  const directKeys = ['products', 'items', 'results', 'data', 'catalog'];
  for (const key of directKeys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter(Boolean) as GenericRecord[];
    }
  }

  if (record.data && typeof record.data === 'object') {
    const nestedData = record.data as GenericRecord;
    for (const key of ['products', 'items', 'results']) {
      const value = nestedData[key];
      if (Array.isArray(value)) {
        return value.filter(Boolean) as GenericRecord[];
      }
    }
  }

  return [];
}

function toStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => {
      if (typeof value === 'string') return value.trim();
      if (value && typeof value === 'object') {
        const label = (value as GenericRecord).name ?? (value as GenericRecord).value ?? (value as GenericRecord).label;
        return typeof label === 'string' ? label.trim() : '';
      }
      return '';
    })
    .filter(Boolean);
}

function extractImageUrls(product: GenericRecord): string[] {
  const images = asArray(product.images);
  const collected: string[] = [];

  for (const image of images) {
    if (typeof image === 'string' && image.trim()) {
      collected.push(image.trim());
      continue;
    }

    if (image && typeof image === 'object') {
      const src = (image as GenericRecord).src
        ?? (image as GenericRecord).url
        ?? (image as GenericRecord).image
        ?? (image as GenericRecord).thumbnail;
      if (typeof src === 'string' && src.trim()) {
        collected.push(src.trim());
      }
    }
  }

  const singleImage = product.image ?? product.image_url ?? product.thumbnail ?? product.thumbnail_url;
  if (typeof singleImage === 'string' && singleImage.trim()) {
    collected.unshift(singleImage.trim());
  }

  return [...new Set(collected)].slice(0, 10);
}

function parseNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const normalized = value.replace(/,/g, '').trim();
    if (!normalized) return fallback;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function normalizeCategory(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (value && typeof value === 'object') {
    const name = (value as GenericRecord).name ?? (value as GenericRecord).title;
    if (typeof name === 'string' && name.trim()) return name.trim();
  }
  return null;
}

function normalizeProductOptions(product: GenericRecord): Array<{ name: string; position: number; values: string[] }> {
  const rawOptions = asArray(product.options);
  const options = rawOptions
    .map((option, index) => {
      if (!option || typeof option !== 'object') return null;
      const optionRecord = option as GenericRecord;
      const name = typeof optionRecord.name === 'string'
        ? optionRecord.name.trim()
        : typeof optionRecord.title === 'string'
          ? optionRecord.title.trim()
          : '';
      if (!name) return null;
      const values = toStringArray(optionRecord.values ?? optionRecord.items);
      return {
        name,
        position: Number.isFinite(optionRecord.position) ? optionRecord.position : index + 1,
        values
      };
    })
    .filter((option): option is { name: string; position: number; values: string[] } => Boolean(option));

  return options;
}

function normalizeProduct(product: GenericRecord): NormalizedStorifyProduct | null {
  const rawId = product.id ?? product.product_id ?? product.uuid ?? product.sku ?? product.handle ?? product.slug;
  const externalId = rawId != null ? String(rawId).trim() : '';
  const name = typeof product.title === 'string'
    ? product.title.trim()
    : typeof product.name === 'string'
      ? product.name.trim()
      : '';

  if (!externalId || !name) {
    return null;
  }

  const variants = asArray(product.variants);
  const firstVariant = variants[0] && typeof variants[0] === 'object' ? variants[0] as GenericRecord : null;
  const stockFromVariants = variants.reduce((sum, variant) => {
    if (!variant || typeof variant !== 'object') return sum;
    return sum + parseNumber((variant as GenericRecord).inventory_quantity ?? (variant as GenericRecord).stock ?? (variant as GenericRecord).quantity, 0);
  }, 0);

  const options = normalizeProductOptions(product);
  const sizes = options
    .filter((option) => /(size|مقاس|قياس)/i.test(option.name))
    .flatMap((option) => option.values);
  const colors = options
    .filter((option) => /(color|colour|لون)/i.test(option.name))
    .flatMap((option) => option.values);

  const imageUrls = extractImageUrls(product);
  const price = parseNumber(
    product.price
      ?? product.sale_price
      ?? product.current_price
      ?? firstVariant?.price
      ?? firstVariant?.sale_price,
    0
  );

  return {
    externalId,
    name,
    description: String(product.description ?? product.body_html ?? product.summary ?? ''),
    price,
    currency: String(product.currency ?? product.currency_code ?? firstVariant?.currency ?? 'USD'),
    category: normalizeCategory(product.category ?? product.product_type ?? product.collection),
    stock: parseNumber(
      product.inventory_quantity
        ?? product.stock
        ?? product.quantity
        ?? product.total_inventory,
      stockFromVariants
    ),
    primaryImageUrl: imageUrls[0] || null,
    imageUrls,
    sizes: [...new Set(sizes)],
    colors: [...new Set(colors)],
    options
  };
}

async function createSyncJob(merchantId: string, platform: string, jobType: string): Promise<string> {
  const result = await pool.query(
    `INSERT INTO sync_jobs (merchant_id, platform, job_type, status, started_at)
     VALUES ($1, $2, $3, 'running', CURRENT_TIMESTAMP)
     RETURNING id`,
    [merchantId, platform, jobType]
  );
  return result.rows[0].id;
}

async function updateSyncJob(jobId: string, updates: Partial<SyncProgress>): Promise<void> {
  const setClauses: string[] = ['updated_at = CURRENT_TIMESTAMP'];
  const values: unknown[] = [];
  let index = 1;

  if (updates.totalItems !== undefined) {
    setClauses.push(`total_items = $${index++}`);
    values.push(updates.totalItems);
  }
  if (updates.processedItems !== undefined) {
    setClauses.push(`processed_items = $${index++}`);
    values.push(updates.processedItems);
  }
  if (updates.createdItems !== undefined) {
    setClauses.push(`created_items = $${index++}`);
    values.push(updates.createdItems);
  }
  if (updates.updatedItems !== undefined) {
    setClauses.push(`updated_items = $${index++}`);
    values.push(updates.updatedItems);
  }
  if (updates.failedItems !== undefined) {
    setClauses.push(`failed_items = $${index++}`);
    values.push(updates.failedItems);
  }
  if (updates.currentPage !== undefined) {
    setClauses.push(`current_page = $${index++}`);
    values.push(updates.currentPage);
  }
  if (updates.totalPages !== undefined) {
    setClauses.push(`total_pages = $${index++}`);
    values.push(updates.totalPages);
  }
  if (updates.status !== undefined) {
    setClauses.push(`status = $${index++}`);
    values.push(updates.status);
    if (updates.status === 'completed' || updates.status === 'failed') {
      setClauses.push('completed_at = CURRENT_TIMESTAMP');
    }
  }

  values.push(jobId);
  await pool.query(
    `UPDATE sync_jobs SET ${setClauses.join(', ')} WHERE id = $${index}`,
    values
  );
}

async function replaceProductImages(
  client: { query: (sql: string, params?: unknown[]) => Promise<any> },
  productId: string,
  merchantId: string,
  imageUrls: string[]
): Promise<void> {
  await client.query(
    'DELETE FROM product_images WHERE product_id = $1 AND merchant_id = $2',
    [productId, merchantId]
  );

  for (let index = 0; index < imageUrls.length; index++) {
    await client.query(
      `INSERT INTO product_images (product_id, merchant_id, src, position, is_primary)
       VALUES ($1, $2, $3, $4, $5)`,
      [productId, merchantId, imageUrls[index], index, index === 0]
    );
  }
}

async function replaceProductOptions(
  client: { query: (sql: string, params?: unknown[]) => Promise<any> },
  productId: string,
  merchantId: string,
  options: Array<{ name: string; position: number; values: string[] }>
): Promise<void> {
  await client.query(
    'DELETE FROM product_options WHERE product_id = $1 AND merchant_id = $2',
    [productId, merchantId]
  );

  for (const option of options) {
    await client.query(
      `INSERT INTO product_options (product_id, merchant_id, name, position, values)
       VALUES ($1, $2, $3, $4, $5)`,
      [productId, merchantId, option.name, option.position, option.values]
    );
  }
}

export async function validateStorifyCatalogAccess(config: StorifyStoreConfig): Promise<{ sampleCount: number }> {
  const validationUrl = buildStorifyProductsUrl(config.apiBaseUrl, config.productsEndpoint, { limit: '1' });
  const response = await fetch(validationUrl, {
    method: 'GET',
    headers: buildStorifyHeaders(config.accessToken)
  });

  if (!response.ok) {
    throw createError(`تعذر الوصول إلى واجهة Storify (${response.status})`, 400);
  }

  const payload = await response.json();
  const products = extractProductList(payload);

  if (!Array.isArray(products)) {
    throw createError('استجابة Storify لا تحتوي على قائمة منتجات قابلة للقراءة', 400);
  }

  return { sampleCount: products.length };
}

export const syncStorifyProducts = async (
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
      `SELECT id, store_domain, api_base_url, access_token, products_endpoint
       FROM storify_stores
       WHERE merchant_id = $1
       LIMIT 1`,
      [req.merchantId]
    );

    if (storeResult.rows.length === 0) {
      return next(createError('Storify store not connected', 400));
    }

    const store = storeResult.rows[0];
    jobId = await createSyncJob(req.merchantId, 'storify', 'products');

    const productsUrl = buildStorifyProductsUrl(
      store.api_base_url,
      store.products_endpoint,
      { limit: '250' }
    );

    const response = await fetch(productsUrl, {
      method: 'GET',
      headers: buildStorifyHeaders(store.access_token)
    });

    if (!response.ok) {
      throw createError(`فشل جلب منتجات Storify (${response.status})`, 400);
    }

    const payload = await response.json();
    const externalProducts = extractProductList(payload);
    const normalizedProducts = externalProducts
      .map((product) => normalizeProduct(product))
      .filter((product): product is NormalizedStorifyProduct => Boolean(product));

    await updateSyncJob(jobId, {
      totalItems: normalizedProducts.length,
      currentPage: 1,
      totalPages: 1
    });

    let processedCount = 0;
    let createdCount = 0;
    let updatedCount = 0;
    let failedCount = 0;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const product of normalizedProducts) {
        try {
          const existingResult = await client.query(
            `SELECT id FROM products
             WHERE merchant_id = $1 AND external_id = $2`,
            [req.merchantId, product.externalId]
          );

          let productId: string;
          if (existingResult.rows.length > 0) {
            productId = existingResult.rows[0].id;
            await client.query(
              `UPDATE products SET
                 name = $1,
                 description = $2,
                 price = $3,
                 currency = $4,
                 category = $5,
                 stock = $6,
                 sizes = $7,
                 colors = $8,
                 image_url = $9,
                 source = 'storify',
                 updated_at = CURRENT_TIMESTAMP
               WHERE id = $10 AND merchant_id = $11`,
              [
                product.name,
                product.description,
                product.price,
                product.currency,
                product.category,
                product.stock,
                product.sizes,
                product.colors,
                product.primaryImageUrl,
                productId,
                req.merchantId
              ]
            );
            updatedCount++;
          } else {
            const insertResult = await client.query(
              `INSERT INTO products (
                 merchant_id, external_id, name, description, price, currency,
                 category, stock, sizes, colors, image_url, source
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'storify')
               RETURNING id`,
              [
                req.merchantId,
                product.externalId,
                product.name,
                product.description,
                product.price,
                product.currency,
                product.category,
                product.stock,
                product.sizes,
                product.colors,
                product.primaryImageUrl
              ]
            );
            productId = insertResult.rows[0].id;
            createdCount++;
          }

          await replaceProductImages(client, productId, req.merchantId, product.imageUrls);
          await replaceProductOptions(client, productId, req.merchantId, product.options);
          scheduleProductImageReindex(req.merchantId, productId);
          processedCount++;

          if (processedCount % 10 === 0) {
            await updateSyncJob(jobId, {
              processedItems: processedCount,
              createdItems: createdCount,
              updatedItems: updatedCount,
              failedItems: failedCount
            });
          }
        } catch (productError) {
          failedCount++;
          logger.error('Failed to sync Storify product', productError as Error, {
            merchantId: req.merchantId,
            externalId: product.externalId
          });
        }
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    await pool.query(
      `UPDATE storify_stores SET
         last_sync = CURRENT_TIMESTAMP,
         last_products_sync = CURRENT_TIMESTAMP,
         products_count = $1,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [processedCount, store.id]
    );

    await updateSyncJob(jobId, {
      status: 'completed',
      processedItems: processedCount,
      createdItems: createdCount,
      updatedItems: updatedCount,
      failedItems: failedCount
    });

    invalidateProductKeywords(req.merchantId);
    clearProductKeywordsCache(req.merchantId);

    const productsResult = await pool.query(
      `SELECT id, external_id as "externalId", name, description, price, currency,
              category, stock, image_url as "imageUrl", source
       FROM products
       WHERE merchant_id = $1 AND source = 'storify'
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
        pages: 1,
        completed: true,
        synced: processedCount,
        message: `تمت مزامنة ${processedCount} منتج من Storify (${createdCount} جديد، ${updatedCount} محدث)`,
        products: productsResult.rows
      }
    });
  } catch (error: any) {
    if (jobId) {
      await updateSyncJob(jobId, { status: 'failed' });
      await pool.query(
        'UPDATE sync_jobs SET error_message = $1 WHERE id = $2',
        [error.message, jobId]
      );
    }
    next(error);
  }
};

export const storifyHealth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const storeResult = await pool.query(
      `SELECT store_domain, api_base_url, products_endpoint, last_sync,
              last_products_sync, products_count
       FROM storify_stores
       WHERE merchant_id = $1
       LIMIT 1`,
      [req.merchantId]
    );

    const store = storeResult.rows[0];

    res.json({
      success: true,
      data: {
        storify: store ? {
          connected: true,
          storeDomain: store.store_domain,
          apiBaseUrl: store.api_base_url,
          productsEndpoint: store.products_endpoint,
          lastSync: store.last_sync,
          lastProductsSync: store.last_products_sync,
          productsCount: store.products_count || 0
        } : {
          connected: false,
          storeDomain: null,
          apiBaseUrl: null,
          productsEndpoint: null,
          lastSync: null,
          lastProductsSync: null,
          productsCount: 0
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

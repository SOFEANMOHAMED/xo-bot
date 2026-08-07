/**
 * Visual product image embeddings (CLIP) for accurate photo → catalog matching.
 *
 * SaaS rules:
 * - Every read/write is scoped by merchant_id
 * - Never compare embeddings across merchants
 * - Product delete cascades via FK
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import pool from '../database/connection.js';
import { logger } from '../utils/logger.js';
import type { Product } from '../core/types.js';

export const VISUAL_EMBEDDING_MODEL =
  process.env.VISUAL_EMBEDDING_MODEL || 'Xenova/clip-vit-base-patch32';
export const VISUAL_EMBEDDING_DIMS = 512;

const DEFAULT_MIN_SCORE = Number(process.env.VISUAL_MATCH_MIN_SCORE || '0.28');
const DEFAULT_CANDIDATE_CAP = Number(process.env.VISUAL_MATCH_CANDIDATE_CAP || '2500');

type FeaturePipeline = (
  image: unknown,
  options?: Record<string, unknown>
) => Promise<{ data: Float32Array | number[]; dims?: number[] } | Float32Array | number[]>;

let featurePipeline: FeaturePipeline | null = null;
let pipelineLoading: Promise<FeaturePipeline> | null = null;
let tableReady: boolean | null = null;
let ensuringTable: Promise<boolean> | null = null;

export async function ensureProductImageEmbeddingsTable(): Promise<boolean> {
  if (tableReady === true) return true;
  if (ensuringTable) return ensuringTable;

  ensuringTable = (async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS product_image_embeddings (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
          product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          image_url TEXT NOT NULL,
          content_hash VARCHAR(64) NOT NULL,
          embedding real[] NOT NULL,
          model VARCHAR(96) NOT NULL DEFAULT 'Xenova/clip-vit-base-patch32',
          dims INTEGER NOT NULL DEFAULT 512,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT uq_product_image_embeddings_merchant_product_hash
            UNIQUE (merchant_id, product_id, content_hash)
        )
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_product_image_embeddings_merchant
          ON product_image_embeddings (merchant_id)
      `);
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_product_image_embeddings_merchant_product
          ON product_image_embeddings (merchant_id, product_id)
      `);
      tableReady = true;
      return true;
    } catch (error) {
      logger.error('Failed to ensure product_image_embeddings table', error as Error);
      tableReady = false;
      return false;
    } finally {
      ensuringTable = null;
    }
  })();

  return ensuringTable;
}

async function getFeaturePipeline(): Promise<FeaturePipeline> {
  if (featurePipeline) return featurePipeline;
  if (pipelineLoading) return pipelineLoading;

  pipelineLoading = (async () => {
    const { pipeline, env } = await import('@xenova/transformers');
    // Cache models under backend/.cache to keep downloads tenant-agnostic and local
    env.cacheDir = path.join(process.cwd(), '.cache', 'xenova');
    env.allowLocalModels = true;

    const pipe = (await pipeline(
      'image-feature-extraction',
      VISUAL_EMBEDDING_MODEL,
      { quantized: true }
    )) as unknown as FeaturePipeline;

    featurePipeline = pipe;
    logger.info('CLIP visual embedding pipeline ready', { model: VISUAL_EMBEDDING_MODEL });
    return pipe;
  })();

  try {
    return await pipelineLoading;
  } finally {
    pipelineLoading = null;
  }
}

function l2Normalize(vector: number[]): number[] {
  let sumSq = 0;
  for (const v of vector) sumSq += v * v;
  const norm = Math.sqrt(sumSq);
  if (!norm || !Number.isFinite(norm)) return vector;
  return vector.map((v) => v / norm);
}

function flattenFeatureOutput(
  output: { data: Float32Array | number[]; dims?: number[] } | Float32Array | number[]
): number[] {
  if (Array.isArray(output)) return output.map(Number);
  if (output instanceof Float32Array) return Array.from(output);
  if (output && typeof output === 'object' && 'data' in output) {
    const data = output.data;
    if (data instanceof Float32Array) return Array.from(data);
    if (Array.isArray(data)) return data.map(Number);
  }
  throw new Error('Unexpected CLIP feature output shape');
}

/** Hash image bytes so we skip re-embedding unchanged files. */
export function hashImageBuffer(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function embeddingToPgLiteral(embedding: number[]): string {
  return `{${embedding.map((n) => Number(n).toFixed(8)).join(',')}}`;
}

export function parseEmbedding(raw: unknown): number[] | null {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const nums = raw.map(Number).filter((n) => !Number.isNaN(n));
    return nums.length > 0 ? nums : null;
  }
  if (typeof raw === 'string') {
    const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '').replace(/^\{/, '').replace(/\}$/, '');
    if (!inner) return null;
    const nums = inner.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));
    return nums.length > 0 ? nums : null;
  }
  return null;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Load image bytes from data-URL, local /uploads path, or remote http(s) URL.
 */
export async function resolveImageToBuffer(imageRef: string): Promise<Buffer | null> {
  if (!imageRef || !imageRef.trim()) return null;
  const ref = imageRef.trim();

  try {
    if (ref.startsWith('data:image/')) {
      const match = ref.match(/^data:image\/[^;]+;base64,(.+)$/);
      if (!match?.[1]) return null;
      return Buffer.from(match[1], 'base64');
    }

    if (ref.startsWith('/uploads/') || ref.startsWith('uploads/')) {
      const relative = ref.startsWith('/') ? ref.slice(1) : ref;
      const localPath = path.join(process.cwd(), relative);
      if (fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
        return fs.readFileSync(localPath);
      }
      return null;
    }

    if (/^https?:\/\//i.test(ref)) {
      const resp = await fetch(ref, { signal: AbortSignal.timeout(20_000) });
      if (!resp.ok) return null;
      return Buffer.from(await resp.arrayBuffer());
    }

    // Absolute local path fallback
    if (path.isAbsolute(ref) && fs.existsSync(ref)) {
      return fs.readFileSync(ref);
    }

    return null;
  } catch (error) {
    logger.warn('resolveImageToBuffer failed', {
      preview: ref.substring(0, 80),
      error: (error as Error).message
    });
    return null;
  }
}

/**
 * Embed an image buffer with CLIP (L2-normalized 512-d vector).
 */
export async function embedImageBuffer(buffer: Buffer): Promise<number[] | null> {
  if (!buffer?.length) return null;

  try {
    // Normalize geometry/colors for CLIP (224×224 RGB)
    const { data, info } = await sharp(buffer)
      .rotate()
      .resize(224, 224, { fit: 'cover' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    if (info.channels !== 3) {
      logger.warn('CLIP embed expected 3 channels', { channels: info.channels });
    }

    const { RawImage } = await import('@xenova/transformers');
    const image = new RawImage(
      new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
      info.width,
      info.height,
      info.channels
    );

    const pipe = await getFeaturePipeline();
    const output = await pipe(image, { pooling: 'mean', normalize: true });
    const vector = l2Normalize(flattenFeatureOutput(output));

    if (vector.length < 64) {
      logger.warn('CLIP embedding unexpectedly short', { dims: vector.length });
      return null;
    }

    // Some CLIP feature pipelines return flattened patches (e.g. 7×7×512).
    // If so, mean-pool to a single 512-d vector.
    if (vector.length !== VISUAL_EMBEDDING_DIMS && vector.length % VISUAL_EMBEDDING_DIMS === 0) {
      const patches = vector.length / VISUAL_EMBEDDING_DIMS;
      const pooled = new Array(VISUAL_EMBEDDING_DIMS).fill(0);
      for (let p = 0; p < patches; p++) {
        const offset = p * VISUAL_EMBEDDING_DIMS;
        for (let d = 0; d < VISUAL_EMBEDDING_DIMS; d++) {
          pooled[d] += vector[offset + d];
        }
      }
      for (let d = 0; d < VISUAL_EMBEDDING_DIMS; d++) pooled[d] /= patches;
      return l2Normalize(pooled);
    }

    if (vector.length > VISUAL_EMBEDDING_DIMS) {
      return l2Normalize(vector.slice(0, VISUAL_EMBEDDING_DIMS));
    }

    return vector;
  } catch (error) {
    logger.error('embedImageBuffer failed', error as Error);
    return null;
  }
}

export async function embedImageRef(imageRef: string): Promise<{ embedding: number[]; contentHash: string; buffer: Buffer } | null> {
  const buffer = await resolveImageToBuffer(imageRef);
  if (!buffer) return null;
  const embedding = await embedImageBuffer(buffer);
  if (!embedding) return null;
  return { embedding, contentHash: hashImageBuffer(buffer), buffer };
}

export interface VisualMatch {
  productId: string;
  score: number;
  imageUrl: string;
}

/**
 * Upsert CLIP embedding for one product image (merchant-scoped).
 */
export async function upsertProductImageEmbedding(
  merchantId: string,
  productId: string,
  imageUrl: string
): Promise<boolean> {
  if (!merchantId || !productId || !imageUrl) return false;
  if (!(await ensureProductImageEmbeddingsTable())) return false;

  try {
    // Ownership check (SaaS isolation)
    const owned = await pool.query(
      `SELECT 1 FROM products WHERE id = $1 AND merchant_id = $2 LIMIT 1`,
      [productId, merchantId]
    );
    if (owned.rows.length === 0) return false;

    const resolved = await embedImageRef(imageUrl);
    if (!resolved) {
      logger.warn('Could not embed product image', {
        merchantId,
        productId,
        imagePreview: imageUrl.substring(0, 80)
      });
      return false;
    }

    const { embedding, contentHash } = resolved;

    const existing = await pool.query(
      `SELECT content_hash FROM product_image_embeddings
       WHERE merchant_id = $1 AND product_id = $2 AND content_hash = $3
       LIMIT 1`,
      [merchantId, productId, contentHash]
    );
    if (existing.rows.length > 0) return true;

    // Replace prior embeddings for this product+url when hash changed
    await pool.query(
      `DELETE FROM product_image_embeddings
       WHERE merchant_id = $1 AND product_id = $2 AND image_url = $3`,
      [merchantId, productId, imageUrl]
    );

    await pool.query(
      `INSERT INTO product_image_embeddings (
         merchant_id, product_id, image_url, content_hash, embedding, model, dims, updated_at
       ) VALUES ($1, $2, $3, $4, $5::real[], $6, $7, NOW())
       ON CONFLICT (merchant_id, product_id, content_hash) DO UPDATE SET
         image_url = EXCLUDED.image_url,
         embedding = EXCLUDED.embedding,
         model = EXCLUDED.model,
         dims = EXCLUDED.dims,
         updated_at = NOW()`,
      [
        merchantId,
        productId,
        imageUrl,
        contentHash,
        embeddingToPgLiteral(embedding),
        VISUAL_EMBEDDING_MODEL,
        embedding.length
      ]
    );

    logger.info('Product image embedding upserted', {
      merchantId,
      productId,
      dims: embedding.length
    });
    return true;
  } catch (error) {
    logger.error('upsertProductImageEmbedding failed', error as Error, {
      merchantId,
      productId
    });
    return false;
  }
}

/** Collect all image URLs for a product (primary + gallery), merchant-scoped. */
export async function listProductImageUrls(
  merchantId: string,
  productId: string
): Promise<string[]> {
  const product = await pool.query(
    `SELECT image_url FROM products WHERE id = $1 AND merchant_id = $2`,
    [productId, merchantId]
  );
  if (product.rows.length === 0) return [];

  const urls: string[] = [];
  const primary = product.rows[0].image_url as string | null;
  if (primary && primary.trim()) urls.push(primary.trim());

  const gallery = await pool.query(
    `SELECT src FROM product_images
     WHERE product_id = $1 AND merchant_id = $2
     ORDER BY position ASC NULLS LAST, created_at ASC`,
    [productId, merchantId]
  );
  for (const row of gallery.rows) {
    const src = String(row.src || '').trim();
    if (src) urls.push(src);
  }

  return [...new Set(urls)];
}

/**
 * Re-index all images for one product. Removes stale embedding rows for that product.
 */
export async function reindexProductImages(
  merchantId: string,
  productId: string
): Promise<{ indexed: number; failed: number }> {
  const stats = { indexed: 0, failed: 0 };
  if (!(await ensureProductImageEmbeddingsTable())) return stats;

  const urls = await listProductImageUrls(merchantId, productId);
  const hashesKept = new Set<string>();

  for (const url of urls) {
    const ok = await upsertProductImageEmbedding(merchantId, productId, url);
    if (ok) {
      stats.indexed += 1;
      const buf = await resolveImageToBuffer(url);
      if (buf) hashesKept.add(hashImageBuffer(buf));
    } else {
      stats.failed += 1;
    }
  }

  // Drop embeddings for images no longer on the product
  if (hashesKept.size > 0) {
    await pool.query(
      `DELETE FROM product_image_embeddings
       WHERE merchant_id = $1 AND product_id = $2
         AND content_hash <> ALL($3::text[])`,
      [merchantId, productId, [...hashesKept]]
    );
  } else if (urls.length === 0) {
    await pool.query(
      `DELETE FROM product_image_embeddings WHERE merchant_id = $1 AND product_id = $2`,
      [merchantId, productId]
    );
  }

  return stats;
}

/** Fire-and-forget reindex — never blocks the request path. */
export function scheduleProductImageReindex(merchantId: string, productId: string): void {
  void reindexProductImages(merchantId, productId).catch((err) => {
    logger.warn('Background visual reindex failed', {
      merchantId,
      productId,
      error: (err as Error).message
    });
  });
}

/**
 * Nearest-neighbour visual search within ONE merchant catalog.
 */
export async function searchProductsByImageEmbedding(
  merchantId: string,
  queryEmbedding: number[],
  options: {
    limit?: number;
    minScore?: number;
    candidateCap?: number;
    inStockOnly?: boolean;
  } = {}
): Promise<VisualMatch[]> {
  const limit = options.limit ?? 5;
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const candidateCap = options.candidateCap ?? DEFAULT_CANDIDATE_CAP;

  if (!merchantId || !queryEmbedding?.length) return [];
  if (!(await ensureProductImageEmbeddingsTable())) return [];

  const stockClause = options.inStockOnly === false ? '' : 'AND p.stock > 0';

  try {
    const result = await pool.query(
      `SELECT pie.product_id, pie.image_url, pie.embedding
       FROM product_image_embeddings pie
       INNER JOIN products p
         ON p.id = pie.product_id AND p.merchant_id = pie.merchant_id
       WHERE pie.merchant_id = $1
         ${stockClause}
       ORDER BY (p.stock > 0) DESC, pie.updated_at DESC
       LIMIT $2`,
      [merchantId, candidateCap]
    );

    const bestByProduct = new Map<string, VisualMatch>();

    for (const row of result.rows) {
      const emb = parseEmbedding(row.embedding);
      if (!emb) continue;
      const score = cosineSimilarity(queryEmbedding, emb);
      if (score < minScore) continue;

      const productId = row.product_id as string;
      const prev = bestByProduct.get(productId);
      if (!prev || score > prev.score) {
        bestByProduct.set(productId, {
          productId,
          score,
          imageUrl: row.image_url as string
        });
      }
    }

    return [...bestByProduct.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  } catch (error) {
    logger.error('searchProductsByImageEmbedding failed', error as Error, { merchantId });
    return [];
  }
}

export async function searchProductsByImageRef(
  merchantId: string,
  imageRef: string,
  options?: Parameters<typeof searchProductsByImageEmbedding>[2]
): Promise<{ matches: VisualMatch[]; queryEmbedding: number[] | null }> {
  const resolved = await embedImageRef(imageRef);
  if (!resolved) return { matches: [], queryEmbedding: null };
  const matches = await searchProductsByImageEmbedding(
    merchantId,
    resolved.embedding,
    options
  );
  return { matches, queryEmbedding: resolved.embedding };
}

/** Load full Product rows for matched IDs (merchant-scoped, preserves score order). */
export async function loadProductsByIdsOrdered(
  merchantId: string,
  productIds: string[]
): Promise<Product[]> {
  if (!merchantId || productIds.length === 0) return [];

  const result = await pool.query(
    `SELECT id, name, description, price, currency, category, stock,
            sizes, colors, image_url, external_id, source, handle
     FROM products
     WHERE merchant_id = $1 AND id = ANY($2::uuid[])`,
    [merchantId, productIds]
  );

  const byId = new Map<string, Product>();
  for (const row of result.rows) {
    byId.set(row.id, {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      price: Number(row.price) || 0,
      currency: row.currency || 'USD',
      category: row.category || undefined,
      stock: Number(row.stock) || 0,
      sizes: row.sizes || undefined,
      colors: row.colors || undefined,
      imageUrl: row.image_url || undefined,
      externalId: row.external_id || undefined,
      source: row.source || undefined,
      handle: row.handle || undefined
    } as Product);
  }

  return productIds.map((id) => byId.get(id)).filter(Boolean) as Product[];
}

export async function backfillProductImageEmbeddings(options: {
  merchantId?: string;
  maxProducts?: number;
  batchSize?: number;
} = {}): Promise<{ processed: number; indexed: number; failed: number }> {
  const maxProducts = options.maxProducts ?? 500;
  const stats = { processed: 0, indexed: 0, failed: 0 };
  if (!(await ensureProductImageEmbeddingsTable())) return stats;

  const params: unknown[] = [];
  let where = `WHERE (p.image_url IS NOT NULL AND TRIM(p.image_url) <> '')
                 OR EXISTS (
                   SELECT 1 FROM product_images pi
                   WHERE pi.product_id = p.id AND pi.merchant_id = p.merchant_id
                 )`;
  if (options.merchantId) {
    params.push(options.merchantId);
    where += ` AND p.merchant_id = $${params.length}`;
  }
  params.push(maxProducts);

  const result = await pool.query(
    `SELECT p.id, p.merchant_id
     FROM products p
     ${where}
     ORDER BY p.updated_at DESC
     LIMIT $${params.length}`,
    params
  );

  for (const row of result.rows) {
    stats.processed += 1;
    const r = await reindexProductImages(row.merchant_id, row.id);
    stats.indexed += r.indexed;
    stats.failed += r.failed;
  }

  return stats;
}

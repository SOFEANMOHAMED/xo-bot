/**
 * Prepare bot outbound image URLs so Meta Graph (Messenger / Instagram DM)
 * can fetch them. Reuses prepareImageUrlForMeta (JPEG for WebP); resolves
 * /api/products/:id/image to the underlying upload first.
 */

import pool from '../../database/connection.js';
import { resolveImageSrcForServing } from '../../catalog/resolve-product-image.js';
import { prepareImageUrlForMeta } from '../contentPublishing/preparePublishMedia.js';
import { logger } from '../../utils/logger.js';

const PRODUCT_IMAGE_PATH =
  /\/api\/products\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/image/i;

const PUBLIC_BASE =
  process.env.BACKEND_URL || process.env.BASE_URL || 'https://xo-bot.com';

/**
 * Turn a product-image API URL into a public /uploads URL (or relative path)
 * that prepareImageUrlForMeta can convert to JPEG when needed.
 */
async function resolveProductApiImageToUploadSrc(
  imageUrl: string
): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    return null;
  }

  const match = parsed.pathname.match(PRODUCT_IMAGE_PATH);
  if (!match?.[1]) return null;

  const productId = match[1];
  const imageId =
    typeof parsed.searchParams.get('img') === 'string' &&
    parsed.searchParams.get('img')!.trim()
      ? parsed.searchParams.get('img')!.trim()
      : null;
  const colorQuery =
    typeof parsed.searchParams.get('color') === 'string' &&
    parsed.searchParams.get('color')!.trim()
      ? parsed.searchParams.get('color')!.trim()
      : null;
  const sizeQuery =
    typeof parsed.searchParams.get('size') === 'string' &&
    parsed.searchParams.get('size')!.trim()
      ? parsed.searchParams.get('size')!.trim()
      : null;

  const result = await pool.query(
    `SELECT image_url, merchant_id, colors, sizes
     FROM products
     WHERE id = $1`,
    [productId]
  );
  if (result.rows.length === 0) return null;

  const product = result.rows[0];
  const src = await resolveImageSrcForServing({
    merchantId: product.merchant_id as string,
    productId,
    primaryImageUrl: product.image_url || null,
    imageId,
    color: colorQuery,
    size: sizeQuery,
    colors: product.colors || null,
    sizes: product.sizes || null,
  });

  if (!src) return null;

  if (src.startsWith('/uploads/')) {
    return `${PUBLIC_BASE.replace(/\/$/, '')}${src}`;
  }
  if (src.startsWith('uploads/')) {
    return `${PUBLIC_BASE.replace(/\/$/, '')}/${src}`;
  }
  return src;
}

/**
 * Single entry for FB/IG outbound images: Meta-fetchable JPEG/PNG public URL.
 */
export async function prepareMetaOutboundImageUrl(
  imageUrl: string
): Promise<string> {
  if (!imageUrl?.trim()) return imageUrl;

  try {
    const uploadSrc = await resolveProductApiImageToUploadSrc(imageUrl.trim());
    const prepared = await prepareImageUrlForMeta(uploadSrc || imageUrl.trim());
    if (prepared !== imageUrl) {
      logger.debug('Prepared Meta outbound image URL', {
        fromPreview: imageUrl.slice(0, 100),
        toPreview: prepared.slice(0, 100),
      });
    }
    return prepared;
  } catch (error) {
    logger.warn('prepareMetaOutboundImageUrl failed; using original URL', {
      error: (error as Error).message,
      urlPreview: imageUrl.slice(0, 100),
    });
    return imageUrl;
  }
}

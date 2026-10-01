/**
 * Resolve bot product-image URLs to local bytes for channels that cannot
 * reliably HTTP-fetch our own public URL (e.g. WhatsApp Web / Baileys hairpin).
 *
 * Loads ONLY the image referenced by the URL (img/color/size) — never swaps in
 * a different gallery row (wrong color/size).
 */

import pool from '../../database/connection.js';
import { resolveImageSrcForServing } from '../../catalog/resolve-product-image.js';
import { readUploadSrcMedia } from '../../catalog/upload-local-media.js';
import { logger } from '../../utils/logger.js';

export type OutboundImageMedia = {
  buffer: Buffer;
  mimetype: string;
};

const PRODUCT_IMAGE_PATH =
  /\/api\/products\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/image/i;

/**
 * Load image bytes for an outbound bot image URL.
 * Returns null when the URL is not our product-image endpoint or the file is missing
 * (caller may fall back to URL fetch).
 */
export async function loadOutboundImageMedia(
  imageUrl: string
): Promise<OutboundImageMedia | null> {
  if (!imageUrl || !imageUrl.trim()) return null;

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

  try {
    const result = await pool.query(
      `SELECT image_url, merchant_id, colors, sizes
       FROM products
       WHERE id = $1`,
      [productId]
    );
    if (result.rows.length === 0) return null;

    const product = result.rows[0];
    const merchantId = (product.merchant_id as string) || null;
    const imageSrc = await resolveImageSrcForServing({
      merchantId: merchantId || '',
      productId,
      primaryImageUrl: product.image_url || null,
      imageId,
      color: colorQuery,
      size: sizeQuery,
      colors: product.colors || null,
      sizes: product.sizes || null,
    });

    if (!imageSrc) return null;

    const media = readUploadSrcMedia(imageSrc, merchantId);
    if (!media) {
      logger.warn('Outbound image media: local file not found for product image', {
        productId,
        imageId,
        color: colorQuery,
        size: sizeQuery,
        srcPreview: String(imageSrc).slice(0, 120),
      });
      return null;
    }
    return { buffer: media.buffer, mimetype: media.mimetype };
  } catch (error) {
    logger.warn('Outbound image media: failed to load product image', {
      productId,
      error: (error as Error).message,
    });
    return null;
  }
}

/**
 * Resolve the best product image for bot delivery (all channels).
 * Prefers a gallery/variant image matching the requested color; falls back to primary.
 * Multi-tenant safe: always scopes by merchant_id.
 */

import pool from '../database/connection.js';
import type { Product } from '../core/types.js';
import { logger } from '../utils/logger.js';

export interface ProductGalleryImage {
  id: string;
  src: string;
  alt: string | null;
  position: number;
  isPrimary: boolean;
  variantIds: string[];
}

export interface ResolveProductImageInput {
  merchantId: string;
  product: Pick<Product, 'id' | 'imageUrl' | 'colors' | 'variants'>;
  requestedColor?: string | null;
  /** Raw user message — used to extract color if not already collected */
  messageText?: string | null;
}

export interface ResolveProductImageResult {
  /** Public URL for [IMAGE: ...] tags across FB/IG/TG/WA */
  botImageUrl: string;
  matchedColor: string | null;
  galleryImageId: string | null;
  strategy: 'variant' | 'alt' | 'color_index' | 'primary' | 'none';
}

const COLOR_CANONICAL: Array<{ canonical: string; aliases: string[] }> = [
  { canonical: 'احمر', aliases: ['احمر', 'أحمر', 'حمرا', 'حمراء', 'حمره', 'red', 'maroon', 'burgundy'] },
  { canonical: 'ازرق', aliases: ['ازرق', 'أزرق', 'زرقا', 'زرقاء', 'زرقه', 'blue', 'navy', 'كحلي', 'كحليه'] },
  { canonical: 'اخضر', aliases: ['اخضر', 'أخضر', 'خضرا', 'خضراء', 'خضره', 'green', 'olive'] },
  { canonical: 'اصفر', aliases: ['اصفر', 'أصفر', 'صفرا', 'صفراء', 'صفره', 'yellow', 'gold', 'ذهبي', 'ذهبيه'] },
  { canonical: 'اسود', aliases: ['اسود', 'أسود', 'سودا', 'سوداء', 'سوده', 'black'] },
  { canonical: 'ابيض', aliases: ['ابيض', 'أبيض', 'بيضا', 'بيضاء', 'بيضه', 'white', 'offwhite', 'ivory'] },
  { canonical: 'بني', aliases: ['بني', 'بنيه', 'brown', 'beige', 'بيج', 'بيجه'] },
  { canonical: 'رمادي', aliases: ['رمادي', 'رماديه', 'gray', 'grey', 'silver', 'فضي', 'فضيه'] },
  { canonical: 'برتقالي', aliases: ['برتقالي', 'برتقاليه', 'orange'] },
  { canonical: 'وردي', aliases: ['وردي', 'ورديه', 'زهري', 'زهريه', 'روز', 'pink', 'rose'] },
  { canonical: 'بنفسجي', aliases: ['بنفسجي', 'بنفسجيه', 'موف', 'purple', 'violet', 'lilac'] }
];

export function normalizeColorToken(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u0652]/g, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function canonicalizeColor(input: string | null | undefined): string | null {
  if (!input?.trim()) return null;
  const n = normalizeColorToken(input);
  for (const entry of COLOR_CANONICAL) {
    for (const alias of entry.aliases) {
      const a = normalizeColorToken(alias);
      if (n === a || n.includes(a) || a.includes(n)) {
        return entry.canonical;
      }
    }
  }
  return n;
}

/** Fuzzy match between requested color and a catalog color/option/alt string */
export function colorsMatch(requested: string, candidate: string): boolean {
  const a = canonicalizeColor(requested);
  const b = canonicalizeColor(candidate);
  if (!a || !b) return false;
  if (a === b) return true;
  const an = normalizeColorToken(requested);
  const bn = normalizeColorToken(candidate);
  return an === bn || an.includes(bn) || bn.includes(an);
}

/** Extract a color mention from free text (Arabic/English) */
export function extractColorFromText(text: string | null | undefined): string | null {
  if (!text?.trim()) return null;
  for (const entry of COLOR_CANONICAL) {
    for (const alias of entry.aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(^|\\s|[,،/])${escaped}(?=$|\\s|[,،/.!?])`, 'i');
      if (re.test(text) || text.toLowerCase().includes(alias.toLowerCase())) {
        // Prefer whole-word-ish for short English tokens
        if (/^[a-z]+$/i.test(alias)) {
          const wordRe = new RegExp(`\\b${escaped}\\b`, 'i');
          if (!wordRe.test(text)) continue;
        }
        return entry.canonical;
      }
    }
  }
  return null;
}

export async function fetchProductGallery(
  merchantId: string,
  productId: string
): Promise<ProductGalleryImage[]> {
  const result = await pool.query(
    `SELECT id, src, alt, position, is_primary, variant_ids
     FROM product_images
     WHERE product_id = $1 AND merchant_id = $2
     ORDER BY position ASC, created_at ASC`,
    [productId, merchantId]
  );

  return result.rows.map((row: any) => ({
    id: row.id,
    src: row.src,
    alt: row.alt || null,
    position: row.position ?? 0,
    isPrimary: Boolean(row.is_primary),
    variantIds: Array.isArray(row.variant_ids)
      ? row.variant_ids.map(String)
      : []
  }));
}

function buildBotImageUrl(
  productId: string,
  opts?: { imageId?: string | null; color?: string | null }
): string {
  const baseUrl = process.env.BACKEND_URL || process.env.BASE_URL || 'https://xo-bot.com';
  const params = new URLSearchParams();
  if (opts?.imageId) params.set('img', opts.imageId);
  if (opts?.color) params.set('color', opts.color);
  params.set('v', String(Date.now()));
  const qs = params.toString();
  return `${baseUrl}/api/products/${productId}/image${qs ? `?${qs}` : ''}`;
}

function variantOptionColors(product: ResolveProductImageInput['product']): Array<{
  variantId: string;
  colorText: string;
}> {
  const out: Array<{ variantId: string; colorText: string }> = [];
  const variants = product.variants || [];
  for (const v of variants) {
    for (const opt of [v.option1, v.option2, v.option3]) {
      if (!opt) continue;
      // Prefer options that look like colors (canonical match or listed in product.colors)
      const isKnownColor =
        canonicalizeColor(opt) !== normalizeColorToken(opt) ||
        (product.colors || []).some((c) => colorsMatch(opt, c));
      if (isKnownColor || (product.colors || []).length === 0) {
        out.push({ variantId: v.id, colorText: opt });
      }
    }
  }
  return out;
}

/**
 * Pick gallery image matching color, or null if no match.
 */
export function pickGalleryImageForColor(
  gallery: ProductGalleryImage[],
  product: ResolveProductImageInput['product'],
  requestedColor: string
): { image: ProductGalleryImage; strategy: 'variant' | 'alt' | 'color_index' } | null {
  if (!gallery.length || !requestedColor.trim()) return null;

  // 1) Variant-linked images (Shopify)
  const colorVariants = variantOptionColors(product).filter((v) =>
    colorsMatch(requestedColor, v.colorText)
  );
  if (colorVariants.length > 0) {
    const variantIdSet = new Set(colorVariants.map((v) => v.variantId));
    const byVariant = gallery.find((img) =>
      img.variantIds.some((id) => variantIdSet.has(id))
    );
    if (byVariant) {
      return { image: byVariant, strategy: 'variant' };
    }
  }

  // 2) Alt text contains the color (manual products after alt=color sync)
  const byAlt = gallery.find((img) => img.alt && colorsMatch(requestedColor, img.alt));
  if (byAlt) {
    return { image: byAlt, strategy: 'alt' };
  }

  // 3) Parallel colors[] ↔ gallery[] by index (only when counts match)
  const colors = product.colors || [];
  if (colors.length > 0 && gallery.length === colors.length) {
    const colorIndex = colors.findIndex((c) => colorsMatch(requestedColor, c));
    if (colorIndex >= 0 && gallery[colorIndex]) {
      return { image: gallery[colorIndex], strategy: 'color_index' };
    }
  }

  return null;
}

/**
 * Resolve bot-deliverable image URL for a product, optionally by color.
 */
export async function resolveProductImageForBot(
  input: ResolveProductImageInput
): Promise<ResolveProductImageResult> {
  const { merchantId, product } = input;
  const productId = product.id;

  if (!productId) {
    return {
      botImageUrl: '',
      matchedColor: null,
      galleryImageId: null,
      strategy: 'none'
    };
  }

  const requestedColor =
    canonicalizeColor(input.requestedColor) ||
    extractColorFromText(input.messageText) ||
    null;

  try {
    const gallery = await fetchProductGallery(merchantId, productId);

    if (requestedColor && gallery.length > 0) {
      const picked = pickGalleryImageForColor(gallery, product, requestedColor);
      if (picked) {
        logger.info('Resolved product image by color', {
          merchantId,
          productId,
          color: requestedColor,
          strategy: picked.strategy,
          imageId: picked.image.id
        });
        return {
          botImageUrl: buildBotImageUrl(productId, {
            imageId: picked.image.id,
            color: requestedColor
          }),
          matchedColor: requestedColor,
          galleryImageId: picked.image.id,
          strategy: picked.strategy
        };
      }
    }

    // Primary: prefer is_primary gallery row, else product.imageUrl proxy
    const primaryRow = gallery.find((g) => g.isPrimary) || gallery[0];
    if (primaryRow) {
      return {
        botImageUrl: buildBotImageUrl(productId, { imageId: primaryRow.id }),
        matchedColor: requestedColor,
        galleryImageId: primaryRow.id,
        strategy: 'primary'
      };
    }

    if (product.imageUrl) {
      return {
        botImageUrl: buildBotImageUrl(productId),
        matchedColor: requestedColor,
        galleryImageId: null,
        strategy: 'primary'
      };
    }

    return {
      botImageUrl: '',
      matchedColor: requestedColor,
      galleryImageId: null,
      strategy: 'none'
    };
  } catch (error) {
    logger.warn('resolveProductImageForBot failed; falling back to primary', {
      merchantId,
      productId,
      error
    });
    return {
      botImageUrl: product.imageUrl ? buildBotImageUrl(productId) : '',
      matchedColor: requestedColor,
      galleryImageId: null,
      strategy: product.imageUrl ? 'primary' : 'none'
    };
  }
}

/**
 * Resolve raw image src for HTTP serving (used by getProductImage).
 * Scoped by merchant_id via product ownership check in the caller.
 */
export async function resolveImageSrcForServing(params: {
  merchantId: string;
  productId: string;
  primaryImageUrl: string | null;
  imageId?: string | null;
  color?: string | null;
  colors?: string[] | null;
}): Promise<string | null> {
  const { merchantId, productId, primaryImageUrl, imageId, color, colors } = params;

  if (imageId) {
    const byId = await pool.query(
      `SELECT src FROM product_images
       WHERE id = $1 AND product_id = $2 AND merchant_id = $3
       LIMIT 1`,
      [imageId, productId, merchantId]
    );
    if (byId.rows[0]?.src) return byId.rows[0].src as string;
  }

  if (color) {
    const gallery = await fetchProductGallery(merchantId, productId);
    // Load variants lightly for matching
    let variants: Product['variants'] = null;
    try {
      const vRes = await pool.query(
        `SELECT id, sku, title, price, inventory_quantity, option1, option2, option3
         FROM product_variants
         WHERE product_id = $1 AND merchant_id = $2
         ORDER BY is_default DESC, id
         LIMIT 50`,
        [productId, merchantId]
      );
      variants = vRes.rows.map((v: any) => ({
        id: v.id,
        sku: v.sku,
        title: v.title,
        price: parseFloat(v.price),
        inventory_quantity: v.inventory_quantity,
        option1: v.option1,
        option2: v.option2,
        option3: v.option3
      }));
    } catch {
      variants = null;
    }

    const picked = pickGalleryImageForColor(
      gallery,
      { id: productId, imageUrl: primaryImageUrl, colors: colors || null, variants },
      color
    );
    if (picked?.image.src) return picked.image.src;
  }

  return primaryImageUrl;
}

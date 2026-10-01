/**
 * Resolve the best product image for bot delivery (all channels).
 * Prefers a gallery/variant image matching the requested color/size; never
 * substitutes a differently tagged variant image when a color/size was requested.
 * Multi-tenant safe: always scopes by merchant_id.
 */

import pool from '../database/connection.js';
import type { Product } from '../core/types.js';
import { logger } from '../utils/logger.js';
import { normalizeArabic } from './product-search.js';
import {
  canonicalizeColor,
  colorsMatch,
  extractColorFromText,
  matchColorOption,
  normalizeColorToken
} from './color-options.js';

export {
  canonicalizeColor,
  colorsMatch,
  extractColorFromText,
  normalizeColorToken,
  matchColorOption,
  formatColorOptionsForDisplay,
  resolveColorEntity,
  extractAtomicColors,
  isCompoundColorOption
} from './color-options.js';

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
  product: Pick<Product, 'id' | 'imageUrl' | 'colors' | 'sizes' | 'variants'>;
  requestedColor?: string | null;
  requestedSize?: string | null;
  /** Raw user message — used to extract color if not already collected */
  messageText?: string | null;
}

export interface ResolveProductImageResult {
  /** Public URL for [IMAGE: ...] tags across FB/IG/TG/WA */
  botImageUrl: string;
  matchedColor: string | null;
  matchedSize: string | null;
  galleryImageId: string | null;
  strategy:
    | 'variant'
    | 'alt'
    | 'color_index'
    | 'size_index'
    | 'primary'
    | 'none';
  /** True when gallery images are tied to color/size options */
  variantBound: boolean;
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

  return result.rows.map((row: {
    id: string;
    src: string;
    alt: string | null;
    position: number | null;
    is_primary: boolean;
    variant_ids: unknown;
  }) => ({
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
  opts?: { imageId?: string | null; color?: string | null; size?: string | null }
): string {
  const baseUrl = process.env.BACKEND_URL || process.env.BASE_URL || 'https://xo-bot.com';
  const params = new URLSearchParams();
  if (opts?.imageId) params.set('img', opts.imageId);
  if (opts?.color) params.set('color', opts.color);
  if (opts?.size) params.set('size', opts.size);
  params.set('v', String(Date.now()));
  const qs = params.toString();
  return `${baseUrl}/api/products/${productId}/image${qs ? `?${qs}` : ''}`;
}

function sizesMatch(a: string, b: string): boolean {
  const na = normalizeArabic(a).toLowerCase().trim();
  const nb = normalizeArabic(b).toLowerCase().trim();
  if (!na || !nb) return false;
  return na === nb || a.trim().toLowerCase() === b.trim().toLowerCase();
}

function variantOptionValues(
  product: ResolveProductImageInput['product'],
  kind: 'color' | 'size'
): Array<{ variantId: string; value: string }> {
  const out: Array<{ variantId: string; value: string }> = [];
  const variants = product.variants || [];
  const catalog =
    kind === 'color' ? product.colors || [] : product.sizes || [];

  for (const v of variants) {
    for (const opt of [v.option1, v.option2, v.option3]) {
      if (!opt) continue;
      if (kind === 'color') {
        const isKnownColor =
          canonicalizeColor(opt) !== normalizeColorToken(opt) ||
          catalog.some((c) => colorsMatch(opt, c));
        if (isKnownColor || catalog.length === 0) {
          out.push({ variantId: v.id, value: opt });
        }
      } else {
        const isKnownSize =
          catalog.some((s) => sizesMatch(opt, s)) ||
          /^(xx?s|xx?l|s|m|l|\d{2,3})$/i.test(opt.trim());
        if (isKnownSize || catalog.length === 0) {
          out.push({ variantId: v.id, value: opt });
        }
      }
    }
  }
  return out;
}

/**
 * True when the gallery is tied to distinct color/size options — sending a
 * non-matching primary would show the wrong variant photo.
 */
export function galleryIsVariantBound(
  gallery: ProductGalleryImage[],
  product: Pick<Product, 'colors' | 'sizes'>
): boolean {
  if (gallery.length <= 1) return false;
  const colors = product.colors || [];
  const sizes = product.sizes || [];

  if (gallery.some((img) => img.variantIds.length > 0)) return true;

  if (
    colors.length > 1 &&
    gallery.some((img) => img.alt && colors.some((c) => colorsMatch(c, img.alt || '')))
  ) {
    return true;
  }
  if (
    sizes.length > 1 &&
    gallery.some((img) => img.alt && sizes.some((s) => sizesMatch(s, img.alt || '')))
  ) {
    return true;
  }
  if (colors.length > 1 && gallery.length === colors.length) return true;
  if (sizes.length > 1 && gallery.length === sizes.length) return true;
  return false;
}

/**
 * Pick gallery image matching color and/or size. Never returns a differently
 * tagged variant image.
 */
export function pickGalleryImageForVariant(
  gallery: ProductGalleryImage[],
  product: ResolveProductImageInput['product'],
  opts: { color?: string | null; size?: string | null }
): {
  image: ProductGalleryImage;
  strategy: 'variant' | 'alt' | 'color_index' | 'size_index';
} | null {
  if (!gallery.length) return null;
  const requestedColor = opts.color?.trim() || null;
  const requestedSize = opts.size?.trim() || null;
  if (!requestedColor && !requestedSize) return null;

  const colors = product.colors || [];
  const sizes = product.sizes || [];

  let resolvedColor: string | null = null;
  if (requestedColor) {
    const optionMatch = matchColorOption(requestedColor, colors);
    if (optionMatch.ambiguous.length > 1) return null;
    resolvedColor = optionMatch.matched || requestedColor;
  }

  let resolvedSize: string | null = null;
  if (requestedSize) {
    const hit = sizes.find((s) => sizesMatch(requestedSize, s));
    resolvedSize = hit || requestedSize;
  }

  // 1) Variant-linked images (prefer both axes when present)
  if (resolvedColor || resolvedSize) {
    const colorVariantIds = resolvedColor
      ? new Set(
          variantOptionValues(product, 'color')
            .filter((v) => colorsMatch(resolvedColor!, v.value))
            .map((v) => v.variantId)
        )
      : null;
    const sizeVariantIds = resolvedSize
      ? new Set(
          variantOptionValues(product, 'size')
            .filter((v) => sizesMatch(resolvedSize!, v.value))
            .map((v) => v.variantId)
        )
      : null;

    const bothIds =
      colorVariantIds && sizeVariantIds
        ? [...colorVariantIds].filter((id) => sizeVariantIds.has(id))
        : null;

    const byVariant = gallery.find((img) => {
      if (!img.variantIds.length) return false;
      if (bothIds && bothIds.length > 0) {
        return img.variantIds.some((id) => bothIds.includes(id));
      }
      const colorOk =
        !colorVariantIds ||
        img.variantIds.some((id) => colorVariantIds.has(id));
      const sizeOk =
        !sizeVariantIds || img.variantIds.some((id) => sizeVariantIds.has(id));
      return colorOk && sizeOk;
    });
    if (byVariant) {
      return { image: byVariant, strategy: 'variant' };
    }
  }

  // 2) Alt text match (color and/or size labels on gallery rows)
  if (resolvedColor || resolvedSize) {
    const byAlt = gallery.find((img) => {
      if (!img.alt) return false;
      const colorOk = !resolvedColor || colorsMatch(resolvedColor, img.alt);
      const sizeOk = !resolvedSize || sizesMatch(resolvedSize, img.alt);
      return colorOk && sizeOk;
    });
    if (byAlt) {
      return { image: byAlt, strategy: 'alt' };
    }
  }

  // 3) Parallel colors[] ↔ gallery[] by index
  if (resolvedColor && colors.length > 0 && gallery.length === colors.length) {
    const colorIndex = colors.findIndex((c) => colorsMatch(resolvedColor!, c));
    if (colorIndex >= 0 && gallery[colorIndex]) {
      return { image: gallery[colorIndex], strategy: 'color_index' };
    }
  }

  // 4) Parallel sizes[] ↔ gallery[] by index
  if (resolvedSize && sizes.length > 0 && gallery.length === sizes.length) {
    const sizeIndex = sizes.findIndex((s) => sizesMatch(resolvedSize!, s));
    if (sizeIndex >= 0 && gallery[sizeIndex]) {
      return { image: gallery[sizeIndex], strategy: 'size_index' };
    }
  }

  return null;
}

/** @deprecated Prefer pickGalleryImageForVariant — kept for existing imports/tests. */
export function pickGalleryImageForColor(
  gallery: ProductGalleryImage[],
  product: ResolveProductImageInput['product'],
  requestedColor: string
): { image: ProductGalleryImage; strategy: 'variant' | 'alt' | 'color_index' } | null {
  const picked = pickGalleryImageForVariant(gallery, product, { color: requestedColor });
  if (!picked) return null;
  if (picked.strategy === 'size_index') return null;
  return {
    image: picked.image,
    strategy: picked.strategy,
  };
}

/**
 * Resolve bot-deliverable image URL for a product, optionally by color/size.
 */
export async function resolveProductImageForBot(
  input: ResolveProductImageInput
): Promise<ResolveProductImageResult> {
  const { merchantId, product } = input;
  const productId = product.id;

  const empty = (
    partial: Partial<ResolveProductImageResult> & {
      matchedColor: string | null;
      matchedSize: string | null;
      variantBound: boolean;
    }
  ): ResolveProductImageResult => ({
    botImageUrl: '',
    galleryImageId: null,
    strategy: 'none',
    ...partial,
  });

  if (!productId) {
    return empty({
      matchedColor: null,
      matchedSize: null,
      variantBound: false,
    });
  }

  const fromMessage = extractColorFromText(input.messageText, product.colors);
  const optionResolved = input.requestedColor
    ? matchColorOption(input.requestedColor, product.colors).matched
    : null;
  const requestedColor =
    optionResolved ||
    fromMessage ||
    (input.requestedColor ? canonicalizeColor(input.requestedColor) : null) ||
    null;
  const requestedSize = input.requestedSize?.trim() || null;

  try {
    const gallery = await fetchProductGallery(merchantId, productId);
    const variantBound = galleryIsVariantBound(gallery, product);

    if ((requestedColor || requestedSize) && gallery.length > 0) {
      const picked = pickGalleryImageForVariant(gallery, product, {
        color: requestedColor,
        size: requestedSize,
      });
      if (picked) {
        logger.info('Resolved product image by variant', {
          merchantId,
          productId,
          color: requestedColor,
          size: requestedSize,
          strategy: picked.strategy,
          imageId: picked.image.id,
        });
        return {
          botImageUrl: buildBotImageUrl(productId, {
            imageId: picked.image.id,
            color: requestedColor,
            size: requestedSize,
          }),
          matchedColor: requestedColor,
          matchedSize: requestedSize,
          galleryImageId: picked.image.id,
          strategy: picked.strategy,
          variantBound,
        };
      }

      // Color/size was requested but no matching gallery row — do NOT send another
      // variant's photo (e.g. black primary when customer asked for red).
      if (variantBound) {
        logger.info('No matching variant image; refusing wrong-image fallback', {
          merchantId,
          productId,
          color: requestedColor,
          size: requestedSize,
        });
        return empty({
          matchedColor: requestedColor,
          matchedSize: requestedSize,
          variantBound,
        });
      }
    }

    // Generic photo (no color/size constraint): primary is safe.
    const primaryRow = gallery.find((g) => g.isPrimary) || gallery[0];
    if (primaryRow) {
      return {
        botImageUrl: buildBotImageUrl(productId, { imageId: primaryRow.id }),
        matchedColor: requestedColor,
        matchedSize: requestedSize,
        galleryImageId: primaryRow.id,
        strategy: 'primary',
        variantBound,
      };
    }

    if (product.imageUrl) {
      return {
        botImageUrl: buildBotImageUrl(productId),
        matchedColor: requestedColor,
        matchedSize: requestedSize,
        galleryImageId: null,
        strategy: 'primary',
        variantBound,
      };
    }

    return empty({
      matchedColor: requestedColor,
      matchedSize: requestedSize,
      variantBound,
    });
  } catch (error) {
    logger.warn('resolveProductImageForBot failed; falling back to primary', {
      merchantId,
      productId,
      error,
    });
    if (requestedColor || requestedSize) {
      return empty({
        matchedColor: requestedColor,
        matchedSize: requestedSize,
        variantBound: false,
      });
    }
    return {
      botImageUrl: product.imageUrl ? buildBotImageUrl(productId) : '',
      matchedColor: requestedColor,
      matchedSize: requestedSize,
      galleryImageId: null,
      strategy: product.imageUrl ? 'primary' : 'none',
      variantBound: false,
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
  size?: string | null;
  colors?: string[] | null;
  sizes?: string[] | null;
}): Promise<string | null> {
  const { merchantId, productId, primaryImageUrl, imageId, color, size, colors, sizes } =
    params;

  if (imageId) {
    const byId = await pool.query(
      `SELECT src FROM product_images
       WHERE id = $1 AND product_id = $2 AND merchant_id = $3
       LIMIT 1`,
      [imageId, productId, merchantId]
    );
    if (byId.rows[0]?.src) return byId.rows[0].src as string;
  }

  if (color || size) {
    const gallery = await fetchProductGallery(merchantId, productId);
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
      variants = vRes.rows.map((v: {
        id: string;
        sku: string | null;
        title: string | null;
        price: string | number;
        inventory_quantity: number | null;
        option1: string | null;
        option2: string | null;
        option3: string | null;
      }) => ({
        id: v.id,
        sku: v.sku || '',
        title: v.title || '',
        price: parseFloat(String(v.price)),
        inventory_quantity: v.inventory_quantity ?? 0,
        option1: v.option1,
        option2: v.option2,
        option3: v.option3,
      }));
    } catch {
      variants = null;
    }

    const picked = pickGalleryImageForVariant(
      gallery,
      {
        id: productId,
        imageUrl: primaryImageUrl,
        colors: colors || null,
        sizes: sizes || null,
        variants,
      },
      { color, size }
    );
    if (picked?.image.src) return picked.image.src;

    if (galleryIsVariantBound(gallery, { colors: colors || null, sizes: sizes || null })) {
      return null;
    }
  }

  return primaryImageUrl;
}

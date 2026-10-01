/**
 * Bot-facing product image URL helpers for SalesGPT.
 */
import { resolveProductImageForBot } from '../../../catalog/resolve-product-image.js';
import type { Product } from '../../../core/types.js';
import { logger } from '../../../utils/logger.js';

export function convertImageUrlForBot(imageUrl: string | null, productId: string): string {
  if (!imageUrl || imageUrl === 'N/A') return '';
  const fromEnv = process.env.BACKEND_URL || process.env.BASE_URL;
  if (!fromEnv) {
    logger.warn(
      'SalesGPT: BACKEND_URL/BASE_URL unset — falling back to https://xo-bot.com for product image URL',
      { productId }
    );
  }
  const baseUrl = fromEnv || 'https://xo-bot.com';
  let cacheBuster = '';
  if (imageUrl && imageUrl.includes('product-image-')) {
    const match = imageUrl.match(/product-image-(\d+)-/);
    if (match && match[1]) cacheBuster = `?v=${match[1]}`;
  }
  return `${baseUrl}/api/products/${productId}/image${cacheBuster}`;
}

export type ColorAwareImageResult = {
  url: string;
  strategy: string;
  variantBound: boolean;
  matchedColor: string | null;
  matchedSize: string | null;
};

/**
 * Resolve the correct bot image URL for a product.
 * When a color/size is requested and the gallery is variant-bound, never falls
 * back to a different variant's primary image.
 */
export async function buildColorAwareImageTag(
  merchantId: string,
  product: Product,
  requestedColor: string | null | undefined,
  messageText: string,
  requestedSize?: string | null
): Promise<string> {
  const resolved = await resolveProductImageForBot({
    merchantId,
    product,
    requestedColor,
    requestedSize,
    messageText,
  });
  if (resolved.botImageUrl) return resolved.botImageUrl;

  // Do not attach the wrong primary when a specific color/size was requested.
  if (requestedColor || requestedSize || resolved.variantBound) {
    return '';
  }

  return convertImageUrlForBot(product.imageUrl || null, product.id);
}

export async function resolveColorAwareImage(
  merchantId: string,
  product: Product,
  requestedColor: string | null | undefined,
  messageText: string,
  requestedSize?: string | null
): Promise<ColorAwareImageResult> {
  const resolved = await resolveProductImageForBot({
    merchantId,
    product,
    requestedColor,
    requestedSize,
    messageText,
  });
  if (resolved.botImageUrl) {
    return {
      url: resolved.botImageUrl,
      strategy: resolved.strategy,
      variantBound: resolved.variantBound,
      matchedColor: resolved.matchedColor,
      matchedSize: resolved.matchedSize,
    };
  }
  if (!(requestedColor || requestedSize || resolved.variantBound)) {
    const fallback = convertImageUrlForBot(product.imageUrl || null, product.id);
    if (fallback) {
      return {
        url: fallback,
        strategy: 'primary',
        variantBound: false,
        matchedColor: null,
        matchedSize: null,
      };
    }
  }
  return {
    url: '',
    strategy: 'none',
    variantBound: resolved.variantBound,
    matchedColor: resolved.matchedColor,
    matchedSize: resolved.matchedSize,
  };
}

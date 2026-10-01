/**
 * Attach [IMAGE] tags when resolvePhotoDecision says so.
 * Never attaches a differently tagged color/size gallery image.
 */
import type { Language, Product } from '../../../core/types.js';
import { sanitizeCaptionWhenImageSent } from '../../../response/image-caption.js';
import { findProductsMentionedInText } from '../conversationCart.js';
import {
  buildMultiProductPhotoClarifyMessage,
  buildPhotoUnavailableMessage,
  buildProductNotFoundPhotoMessage,
  buildVariantPhotoClarifyMessage,
} from '../replyPolicy.js';
import { logReplyOwnership } from '../replyOwnership.js';
import { logger } from '../../../utils/logger.js';
import { resolveColorAwareImage } from './imageUrls.js';

function ownReply(
  phase: Parameters<typeof logReplyOwnership>[0]['phase'],
  reason: string,
  nextAction: string | undefined,
  replyText: string
): string {
  logReplyOwnership({ phase, reason, nextAction, replyText });
  return replyText;
}

export type ApplyImageDecisionInput = {
  merchantId: string;
  messageText: string;
  language: Language;
  shouldAttachImage: boolean;
  noMatchForSpecificQuery: boolean;
  responseText: string;
  collectedProductName?: string;
  collectedColor?: string | null;
  storedColor?: string | null;
  collectedSize?: string | null;
  storedSize?: string | null;
  activeProductId: string | null;
  products: Product[];
  mentionedInMessage: Product[];
  catalogForMention: Product[];
};

export type ApplyImageDecisionResult = {
  replyText: string;
  products: Product[];
  activeProductId: string | null;
};

export async function applyImageDecision(
  input: ApplyImageDecisionInput
): Promise<ApplyImageDecisionResult> {
  let { products, activeProductId } = input;
  let finalReplyText = input.responseText;

  if (input.shouldAttachImage && input.noMatchForSpecificQuery) {
    return { replyText: finalReplyText, products, activeProductId };
  }
  if (!input.shouldAttachImage) {
    return { replyText: finalReplyText, products, activeProductId };
  }

  const imageProduct =
    input.mentionedInMessage[0] ||
    (input.collectedProductName
      ? findProductsMentionedInText(String(input.collectedProductName), input.catalogForMention)[0]
      : undefined) ||
    (activeProductId
      ? products.find((p) => p.id === activeProductId) ||
        input.catalogForMention.find((p) => p.id === activeProductId)
      : undefined) ||
    products[0];

  if (imageProduct) {
    const requestedColor = input.collectedColor || input.storedColor || null;
    const requestedSize = input.collectedSize || input.storedSize || null;
    const resolved = await resolveColorAwareImage(
      input.merchantId,
      imageProduct,
      requestedColor,
      input.messageText,
      requestedSize
    );

    if (resolved.url) {
      const caption = sanitizeCaptionWhenImageSent(
        input.responseText,
        input.language,
        imageProduct.name
      );
      finalReplyText = `${caption}\n\n[IMAGE: ${resolved.url}]`;
      products = [imageProduct, ...products.filter((p) => p.id !== imageProduct.id)];
      activeProductId = imageProduct.id;
      logger.debug('SalesGPT: color-aware image attached', {
        product: imageProduct.name,
        productId: imageProduct.id,
        requestedColor,
        requestedSize,
        strategy: resolved.strategy,
        imageUrlForBot: resolved.url,
        captionLength: caption.length,
      });
    } else if (
      resolved.variantBound &&
      !requestedColor &&
      !requestedSize &&
      ((imageProduct.colors?.length || 0) > 1 || (imageProduct.sizes?.length || 0) > 1)
    ) {
      finalReplyText = ownReply(
        'post_photo',
        'photo_variant_clarify',
        'ask_clarify',
        buildVariantPhotoClarifyMessage(input.language, {
          colors: imageProduct.colors,
          sizes: imageProduct.sizes,
        })
      );
    } else if (requestedColor || requestedSize) {
      // Had a color/size but no matching gallery image — do not attach another variant.
      finalReplyText = ownReply(
        'post_photo',
        'photo_variant_missing',
        'present_product',
        buildVariantPhotoClarifyMessage(input.language, {
          colors: imageProduct.colors,
          sizes: imageProduct.sizes,
        })
      );
    } else if (imageProduct.imageUrl) {
      finalReplyText = ownReply(
        'post_photo',
        'photo_file_missing',
        'present_product',
        buildPhotoUnavailableMessage(input.language)
      );
    } else {
      finalReplyText = ownReply(
        'post_photo',
        'photo_not_found',
        'present_product',
        buildProductNotFoundPhotoMessage(input.language)
      );
    }
  } else if (products.length > 1) {
    const productList = products.slice(0, 3).map((p) => p.name).join('، ');
    finalReplyText = ownReply(
      'post_photo',
      'photo_clarify',
      'send_image',
      buildMultiProductPhotoClarifyMessage(input.language, productList)
    );
  } else {
    finalReplyText = ownReply(
      'post_photo',
      'photo_not_found',
      'present_product',
      buildProductNotFoundPhotoMessage(input.language)
    );
  }

  return { replyText: finalReplyText, products, activeProductId };
}

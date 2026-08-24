/**
 * Shared merchantConfig builder for all channels + bot playground.
 * Ensures Facebook, Instagram, Telegram, and تجربة البوت use the same brain flags.
 */

import type { MerchantConfig, Persona } from '../core/types.js';
import { shouldAppendOrderData, sanitizeCollectedText } from './salesgpt/orderConfirmationPolicy.js';
import { buildMerchantOrderNotes } from '../orders/merchantOrderNotes.js';

export type MerchantSettingsLike = {
  store_name?: string | null;
  store_currency?: string | null;
  system_prompt?: string | null;
  bot_persona?: string | null;
  shipping_policy?: string | null;
  delivery_time?: string | null;
  payment_methods?: string | null;
  return_policy?: string | null;
  additional_notes?: string | null;
};

export type BuildMerchantBotConfigOptions = {
  merchantId: string;
  settings: MerchantSettingsLike;
  /** Extra system-prompt notes (e.g. ad acquisition context on Meta) */
  systemPromptSuffix?: string;
  /** Optional overrides (playground persona selector, etc.) */
  overrides?: Partial<Pick<MerchantConfig, 'persona' | 'storeName' | 'storeCurrency' | 'systemPrompt'>>;
};

/**
 * Build Partial<MerchantConfig> matching channel controllers (FB / IG / Telegram).
 * SalesGPT (Full AI) is always enabled for merchant bot turns.
 */
export function buildMerchantBotConfig(options: BuildMerchantBotConfigOptions): Partial<MerchantConfig> {
  const { merchantId, settings, systemPromptSuffix = '', overrides = {} } = options;

  const basePrompt = overrides.systemPrompt ?? settings.system_prompt ?? '';
  const systemPrompt = [basePrompt, systemPromptSuffix].filter(Boolean).join('\n\n');

  return {
    merchantId,
    storeName: overrides.storeName || settings.store_name || 'المتجر',
    storeCurrency: overrides.storeCurrency || settings.store_currency || 'USD',
    systemPrompt,
    persona: (overrides.persona || settings.bot_persona || 'friendly') as Persona,
    shippingPolicy: settings.shipping_policy || '',
    deliveryTime: settings.delivery_time || '',
    paymentMethods: settings.payment_methods || '',
    returnPolicy: settings.return_policy || '',
    additionalNotes: settings.additional_notes || '',
    botLanguage: 'auto',
    use_full_ai_mode: true,
  };
}

/**
 * Append [ORDER_DATA] when the pipeline finalized the order (next_action = confirm_order).
 * Shared by every channel — do not duplicate this gate in controllers.
 * Prefers cart.items when present (multi-product); falls back to single productIds.
 */
export function appendOrderDataIfConfirmed(params: {
  responseText: string;
  nextAction?: string;
  entities: Record<string, any>;
  productIds: string[];
  storeCurrency: string;
  /** Locked cart lines from conversation_state.cart */
  cartItems?: Array<{
    productId: string;
    productName: string;
    quantity: number;
    unitPrice?: number;
    currency?: string;
    color?: string;
    size?: string;
  }>;
  /** @deprecated Ignored — finalization is decided solely by next_action in SalesGPT policy */
  replyStillAsks?: boolean;
}): string {
  const {
    responseText,
    nextAction,
    entities,
    productIds,
    storeCurrency,
    cartItems,
  } = params;

  const name = sanitizeCollectedText(entities.name);
  const phone = sanitizeCollectedText(entities.phone);
  const address = sanitizeCollectedText(entities.address);

  const fromCart =
    Array.isArray(cartItems) && cartItems.length > 0
      ? cartItems
          .filter((item) => item?.productId)
          .map((item) => ({
            productId: item.productId,
            productName: item.productName || entities.product_query || 'Product',
            quantity: item.quantity > 0 ? item.quantity : 1,
            price: typeof item.unitPrice === 'number' ? item.unitPrice : 0,
            currency: item.currency || storeCurrency || 'USD',
            variant:
              item.color || item.size
                ? { color: item.color, size: item.size }
                : undefined,
          }))
      : null;

  const products =
    fromCart ||
    productIds.map((productId: string) => ({
      productId,
      productName: entities.product_query || 'Product',
      quantity: entities.quantity || 1,
      price: 0,
      currency: storeCurrency || 'USD',
    }));

  const hasAllOrderInfo = !!(name && phone && address && products.length > 0);

  if (!hasAllOrderInfo || !shouldAppendOrderData(nextAction, responseText)) {
    return responseText;
  }

  const fullAIOrderData = {
    customerName: name,
    customerPhone: phone,
    customerAddress: address,
    customerEmail: entities.email || null,
    deliveryTime: entities.delivery_time || null,
    notes: buildMerchantOrderNotes({
      notes: sanitizeCollectedText(entities.notes || entities.additional_notes),
    }),
    products,
    total: products.reduce(
      (sum, p) => sum + (p.price || 0) * (p.quantity || 1),
      0
    ),
  };

  return `${responseText}\n[ORDER_DATA]${JSON.stringify(fullAIOrderData)}[/ORDER_DATA]`;
}


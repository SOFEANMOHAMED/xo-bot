/**
 * Shared merchantConfig builder for all channels + bot playground.
 * Ensures Facebook, Instagram, Telegram, and تجربة البوت use the same brain flags.
 */

import type { MerchantConfig, Persona } from '../core/types.js';
import { shouldAppendOrderData, sanitizeCollectedText } from './salesgpt/orderConfirmationPolicy.js';

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
  ai_mode?: 'hybrid' | 'full' | string | null;
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
 * Full AI mode follows merchant_settings.ai_mode (and ENABLE_FULL_AI_MODE inside orchestrator).
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
    use_full_ai_mode: settings.ai_mode === 'full',
  };
}

/**
 * Append [ORDER_DATA] when the pipeline finalized the order (next_action = confirm_order).
 * Shared by every channel — do not duplicate this gate in controllers.
 */
export function appendOrderDataIfConfirmed(params: {
  responseText: string;
  nextAction?: string;
  entities: Record<string, any>;
  productIds: string[];
  storeCurrency: string;
  channelLabel: string;
  /** @deprecated Ignored — finalization is decided solely by next_action in SalesGPT policy */
  replyStillAsks?: boolean;
}): string {
  const {
    responseText,
    nextAction,
    entities,
    productIds,
    storeCurrency,
    channelLabel,
  } = params;

  const name = sanitizeCollectedText(entities.name);
  const phone = sanitizeCollectedText(entities.phone);
  const address = sanitizeCollectedText(entities.address);

  const hasAllOrderInfo = !!(
    name &&
    phone &&
    address &&
    productIds.length > 0
  );

  if (!hasAllOrderInfo || !shouldAppendOrderData(nextAction, responseText)) {
    return responseText;
  }

  const fullAIOrderData = {
    customerName: name,
    customerPhone: phone,
    customerAddress: address,
    customerEmail: entities.email || null,
    deliveryTime: entities.delivery_time || null,
    notes: `Order via ${channelLabel} | Product: ${entities.product_query || 'N/A'}${entities.color ? ` | Color: ${entities.color}` : ''}${entities.size ? ` | Size: ${entities.size}` : ''}`,
    products: productIds.map((productId: string) => ({
      productId,
      productName: entities.product_query || 'Product',
      quantity: entities.quantity || 1,
      price: 0,
      currency: storeCurrency || 'USD',
    })),
    total: 0,
  };

  return `${responseText}\n[ORDER_DATA]${JSON.stringify(fullAIOrderData)}[/ORDER_DATA]`;
}


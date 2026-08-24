/**
 * Core Types - Shared types across the bot system
 * SaaS-ready with multi-tenant support
 */

// ==================== LANGUAGE & LOCALIZATION ====================

export type Language = 'arabic' | 'english';
export type DetectedLanguage = 'arabic' | 'english' | 'mixed';

// ==================== INTENT & STAGE ====================

export type Intent = 
  | 'greeting'
  | 'browse'
  | 'product_query'
  | 'price'
  | 'availability'
  | 'shipping'
  | 'comparison'
  | 'order'
  | 'complaint'
  | 'other';

export type Stage = 
  | 'discover'
  | 'offer'
  | 'objection'
  | 'close'
  | 'handoff'
  | 'clarify';

export type Objection = 'price' | 'trust' | 'shipping' | 'quality' | 'none' | null;

// ==================== CTA TYPES ====================

export type CtaType = 'choose' | 'confirm' | 'order' | 'support';

export type NextAction = 
  | 'ask_clarify'
  | 'recommend_products'
  | 'confirm_variant'
  | 'confirm_city'
  | 'send_checkout'
  | 'confirm_order'
  | 'handoff';

export type RecommendationStrategy = 
  | 'top_sellers'
  | 'match_query'
  | 'upsell'
  | 'cheaper_alt'
  | 'best_value'
  | null;

// ==================== PLATFORM ====================

export type Platform = 'web' | 'facebook_messenger' | 'facebook_comment' | 'telegram' | 'whatsapp' | 'instagram';

// ==================== PERSONA ====================

export type Persona = 'formal' | 'friendly' | 'sales' | 'fast' | 'luxury';

// ==================== ENTITIES ====================

export interface Entities {
  product_query?: string;
  product_id?: string;
  city?: string;
  budget?: string;
  size?: string;
  color?: string;
  quantity?: number;
  wants_image?: boolean;
  wants_catalog?: boolean;
  wants_color_info?: boolean;  // User asking "what colors are available?"
  wants_size_info?: boolean;   // User asking "what sizes are available?"
  // Order information (Full AI Mode)
  name?: string;
  phone?: string;
  address?: string;
  email?: string;
  delivery_time?: string;
}

// ==================== MERCHANT CONFIG ====================

export interface MerchantConfig {
  merchantId: string;
  storeName: string;
  storeCurrency: string;
  persona: Persona;
  botLanguage: 'auto' | Language;
  shippingPolicy?: string;
  deliveryTime?: string;
  paymentMethods?: string;
  returnPolicy?: string;
  additionalNotes?: string;
  systemPrompt?: string;
  use_full_ai_mode?: boolean; // Always true for merchant bot (SalesGPT-only pipeline)
  store_name?: string; // For AI orchestrator
  currency?: string; // For AI orchestrator
}

// ==================== MESSAGE ====================

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

// ==================== LAST ORDER SUMMARY ====================
export interface LastOrderSummary {
  orderId: string;
  productName: string;
  customerName: string;
  confirmedAt: string; // ISO timestamp
}

/** Tracking for abandoned-checkout reminder job (per conversation, tenant-isolated) */
export interface AbandonedCheckoutState {
  eligible_at?: string;
  reminder_claimed_at?: string;
  reminder_sent_at?: string;
  reminder_count?: number;
  last_error?: string;
}

/** Optional binding so outbound jobs use the correct page/account for multi-page merchants */
export interface ChannelBinding {
  account_id?: string;
  page_id?: string;
  platform?: string;
}

/**
 * Locked cart line — written by code only (never by the model).
 * Price is snapshotted at add time so checkout totals stay stable.
 */
export interface CartItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  currency: string;
  color?: string;
  size?: string;
  addedAt: string;
}

export type CartStatus = 'building' | 'checking_out';

/** Deterministic shopping cart beside the single-product conversation draft */
export interface ConversationCart {
  items: CartItem[];
  status: CartStatus;
  updatedAt?: string;
}

export interface ConversationState {
  last_intent?: Intent;
  current_stage?: Stage;
  salesgpt_stage_id?: string;   // Numeric SalesGPT stage (1-9)
  language?: Language;
  last_user_message?: string;
  message_count: number;
  last_recommended_products?: string[];
  last_interaction?: string;
  lead_score?: number;
  extracted_entities?: Entities;
  missing_fields?: string[];
  objection?: Objection;
  last_order?: LastOrderSummary; // Triggers fresh-start greeting on next message
  /** True while fields are complete and we are waiting for an explicit customer yes */
  awaiting_order_confirmation?: boolean;
  /**
   * Multi-item cart (source of truth for ORDER_DATA).
   * Draft product lives in extracted_entities until locked into cart.items.
   */
  cart?: ConversationCart;
  abandoned_checkout?: AbandonedCheckoutState;
  channel_binding?: ChannelBinding;
}

// ==================== INCOMING MESSAGE ====================

export interface IncomingMessage {
  merchantId: string;
  platform: Platform;
  userId: string;
  messageText: string;
  externalMessageId?: string;
  userName?: string;
  rawEventMetadata?: Record<string, unknown>;
}

// ==================== BOT RESPONSE ====================

export interface BotResponse {
  replyText: string;
  meta: {
    conversationId: string;
    intent: Intent;
    stage: Stage;
    pipelineUsed: 'smart' | 'simple';
    aiCallsCount: number;
    usedFallback: boolean;
    processingTimeMs: number;
    next_action?: string;  // For Full AI Mode order detection
  };
}

// ==================== PRODUCT ====================

// ==================== PRODUCT VARIANTS (Shopify Support) ====================

export interface ProductVariant {
  id: string;
  sku?: string | null;
  title: string;  // e.g., "Large / Red"
  price: number;
  inventory_quantity: number;
  option1?: string | null;  // e.g., "Large"
  option2?: string | null;  // e.g., "Red"
  option3?: string | null;  // e.g., "Cotton"
}

export interface ProductOption {
  name: string;       // e.g., "Size", "Color"
  values: string[];   // e.g., ["S", "M", "L"]
}

// ==================== PRODUCT ====================

export interface Product {
  id: string;
  name: string;
  price: number;
  currency: string;
  stock: number;
  description?: string | null;
  category?: string | null;
  sizes?: string[] | null;
  colors?: string[] | null;
  imageUrl?: string | null;
  /** Gallery URLs; first is primary (synced with imageUrl for catalog/bots) */
  images?: string[] | null;
  externalId?: string | null;
  source?: string;
  handle?: string | null;
  // Shopify variants support (simple & performance-friendly)
  has_variants?: boolean;
  variants?: ProductVariant[] | null;
  options?: ProductOption[] | null;
}

// ==================== ORDER ====================

export interface OrderData {
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  customerAddress: string;
  deliveryTime?: string;
  city?: string;
  products: Array<{
    productId: string;
    productName: string;
    quantity: number;
    price: number;
    variant?: {
      size?: string;
      color?: string;
    };
  }>;
  total: number;
  notes?: string;
}

// ==================== MANDATORY FIELDS ====================

export const MANDATORY_ORDER_FIELDS = {
  ar: ['الاسم الكامل', 'رقم الهاتف', 'العنوان بالتفصيل'] as const,
  en: ['Full Name', 'Phone Number', 'Detailed Address'] as const
};

export type MandatoryFieldAr = typeof MANDATORY_ORDER_FIELDS.ar[number];
export type MandatoryFieldEn = typeof MANDATORY_ORDER_FIELDS.en[number];

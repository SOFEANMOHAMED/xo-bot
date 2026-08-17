/**
 * Canonical subscription plan definitions for Xo Bot.
 * All paid plans: unlimited monthly AI usage (maxMonthlyAIResponses = -1).
 *
 * Legacy plan aliases (existing subscribers — do not remove):
 * - starter  ≈ comments  (comments-only, no sales bot)
 * - pro      ≈ single    (one sales channel)
 * - business ≈ social    (FB + IG sales bot, no Telegram)
 */

export const PAID_PLAN_KEYS = ['comments', 'single', 'social', 'yearly'] as const;
export type PaidPlanKey = (typeof PAID_PLAN_KEYS)[number];
export const ALL_PLAN_KEYS = [...PAID_PLAN_KEYS, 'trial', 'starter', 'pro', 'business'] as const;

export function isPaidPlanKey(key: string): key is PaidPlanKey {
  return (PAID_PLAN_KEYS as readonly string[]).includes(key);
}

export interface PlanLimits {
  maxProducts: number; // -1 unlimited
  maxMonthlyAIResponses: number; // -1 unlimited
  /** AI design-studio images per billing period (monthly plans: calendar month; yearly: calendar year). -1 unlimited, 0 disabled. */
  maxMonthlyMarketingImages: number;
  maxFacebookPages: number;
  maxInstagramAccounts: number;
  maxWhatsAppAccounts: number;
  maxShopifyStores: number;
  maxTelegramBots: number;
  /** Cap across FB + IG + Telegram combined. -1 = no combined cap (use per-channel limits). */
  maxTotalChannels: number;
  maxCustomers: number;
  hasAdvancedAnalytics: boolean;
  hasAPIAccess: boolean;
  /** When false: comment automation only — no Messenger / IG DM / Telegram sales bot. */
  hasSalesBot: boolean;
  billingPeriod: 'monthly' | 'yearly';
}

/** Merchant-facing feature flags derived from PlanLimits (for settings API + UI). */
export interface PlanCapabilities {
  hasSalesBot: boolean;
  hasAdvancedAnalytics: boolean;
  maxTelegramBots: number;
  maxTotalChannels: number;
  maxFacebookPages: number;
  maxInstagramAccounts: number;
  maxWhatsAppAccounts: number;
  maxShopifyStores: number;
  maxMonthlyMarketingImages: number;
  billingPeriod: 'monthly' | 'yearly';
}

export function toPlanCapabilities(limits: PlanLimits): PlanCapabilities {
  return {
    hasSalesBot: limits.hasSalesBot,
    hasAdvancedAnalytics: limits.hasAdvancedAnalytics,
    maxTelegramBots: limits.maxTelegramBots,
    maxTotalChannels: limits.maxTotalChannels,
    maxFacebookPages: limits.maxFacebookPages,
    maxInstagramAccounts: limits.maxInstagramAccounts,
    maxWhatsAppAccounts: limits.maxWhatsAppAccounts,
    maxShopifyStores: limits.maxShopifyStores,
    maxMonthlyMarketingImages: limits.maxMonthlyMarketingImages,
    billingPeriod: limits.billingPeriod
  };
}

export interface PlanConfig {
  name: string;
  price: number;
  features: string[];
  billingPeriod: 'monthly' | 'yearly';
  description: string;
}

export const DEFAULT_PLAN_CONFIGS: Record<PaidPlanKey, PlanConfig> = {
  comments: {
    name: 'التعليقات',
    price: 5,
    billingPeriod: 'monthly',
    description: 'رد آلي على التعليقات فقط — بدون بوت مبيعات.',
    features: [
      'رد على تعليقات فيسبوك وإنستغرام فقط',
      'بدون بوت مبيعات (رسائل خاصة)',
      'ربط صفحة فيسبوك واحدة',
      'ربط حساب إنستغرام واحد',
      'استخدام AI غير محدود',
      '5 صور تسويقية بالذكاء الاصطناعي شهرياً',
      'دعم فني عبر البريد'
    ]
  },
  single: {
    name: 'القناة الواحدة',
    price: 21,
    billingPeriod: 'monthly',
    description: 'بوت مبيعات على قناة واحدة من اختيارك.',
    features: [
      'بوت مبيعات ذكي',
      'ربط قناة واحدة: فيسبوك أو إنستغرام أو تيليجرام',
      'استخدام AI غير محدود',
      '20 صورة تسويقية بالذكاء الاصطناعي شهرياً',
      'إدارة منتجات وطلبات',
      'دعم فني'
    ]
  },
  social: {
    name: 'السوشيال',
    price: 35,
    billingPeriod: 'monthly',
    description: 'فيسبوك وإنستغرام معاً لبوت المبيعات.',
    features: [
      'بوت مبيعات ذكي',
      'ربط صفحة فيسبوك واحدة',
      'ربط حساب إنستغرام واحد',
      'استخدام AI غير محدود',
      '40 صورة تسويقية بالذكاء الاصطناعي شهرياً',
      'إدارة منتجات وطلبات',
      'تحليلات متقدمة',
      'دعم فني أولوية'
    ]
  },
  yearly: {
    name: 'السنوية',
    price: 200,
    billingPeriod: 'yearly',
    description: 'باقة سنوية شاملة للقنوات الرئيسية.',
    features: [
      'بوت مبيعات ذكي',
      'ربط صفحة فيسبوك واحدة',
      'ربط حساب إنستغرام واحد',
      'ربط بوت تيليجرام واحد',
      'استخدام AI غير محدود',
      '200 صورة تسويقية بالذكاء الاصطناعي سنوياً',
      'إدارة منتجات وطلبات',
      'تحليلات متقدمة',
      'فوترة سنوية بوفر واضح',
      'دعم فني أولوية'
    ]
  }
};

export const DEFAULT_PLAN_LIMITS: Record<string, PlanLimits> = {
  comments: {
    maxProducts: -1,
    maxMonthlyAIResponses: -1,
    maxMonthlyMarketingImages: 5,
    maxFacebookPages: 1,
    maxInstagramAccounts: 1,
    maxWhatsAppAccounts: 0,
    maxShopifyStores: 0,
    maxTelegramBots: 0,
    maxTotalChannels: -1,
    maxCustomers: -1,
    hasAdvancedAnalytics: false,
    hasAPIAccess: false,
    hasSalesBot: false,
    billingPeriod: 'monthly'
  },
  single: {
    maxProducts: -1,
    maxMonthlyAIResponses: -1,
    maxMonthlyMarketingImages: 20,
    maxFacebookPages: 1,
    maxInstagramAccounts: 1,
    maxWhatsAppAccounts: 0,
    maxShopifyStores: 0,
    maxTelegramBots: 1,
    maxTotalChannels: 1, // FB OR IG OR Telegram
    maxCustomers: -1,
    hasAdvancedAnalytics: false,
    hasAPIAccess: false,
    hasSalesBot: true,
    billingPeriod: 'monthly'
  },
  social: {
    maxProducts: -1,
    maxMonthlyAIResponses: -1,
    maxMonthlyMarketingImages: 40,
    maxFacebookPages: 1,
    maxInstagramAccounts: 1,
    maxWhatsAppAccounts: 0,
    maxShopifyStores: 0,
    maxTelegramBots: 0,
    maxTotalChannels: -1,
    maxCustomers: -1,
    hasAdvancedAnalytics: true,
    hasAPIAccess: false,
    hasSalesBot: true,
    billingPeriod: 'monthly'
  },
  yearly: {
    maxProducts: -1,
    maxMonthlyAIResponses: -1,
    maxMonthlyMarketingImages: 200,
    maxFacebookPages: 1,
    maxInstagramAccounts: 1,
    maxWhatsAppAccounts: 0,
    maxShopifyStores: 0,
    maxTelegramBots: 1,
    maxTotalChannels: -1,
    maxCustomers: -1,
    hasAdvancedAnalytics: true,
    hasAPIAccess: false,
    hasSalesBot: true,
    billingPeriod: 'yearly'
  },
  trial: {
    maxProducts: -1,
    maxMonthlyAIResponses: -1,
    maxMonthlyMarketingImages: 5,
    maxFacebookPages: 1,
    maxInstagramAccounts: 1,
    maxWhatsAppAccounts: 0,
    maxShopifyStores: 0,
    maxTelegramBots: 1,
    maxTotalChannels: -1,
    maxCustomers: -1,
    hasAdvancedAnalytics: true,
    hasAPIAccess: false,
    hasSalesBot: true,
    billingPeriod: 'monthly'
  },
  // Legacy aliases for existing subscribers
  starter: {
    maxProducts: -1,
    maxMonthlyAIResponses: -1,
    maxMonthlyMarketingImages: 5,
    maxFacebookPages: 1,
    maxInstagramAccounts: 1,
    maxWhatsAppAccounts: 0,
    maxShopifyStores: 0,
    maxTelegramBots: 0,
    maxTotalChannels: -1,
    maxCustomers: -1,
    hasAdvancedAnalytics: false,
    hasAPIAccess: false,
    hasSalesBot: false,
    billingPeriod: 'monthly'
  },
  pro: {
    maxProducts: -1,
    maxMonthlyAIResponses: -1,
    maxMonthlyMarketingImages: 20,
    maxFacebookPages: 1,
    maxInstagramAccounts: 1,
    maxWhatsAppAccounts: 0,
    maxShopifyStores: 0,
    maxTelegramBots: 1,
    maxTotalChannels: 1,
    maxCustomers: -1,
    hasAdvancedAnalytics: false,
    hasAPIAccess: false,
    hasSalesBot: true,
    billingPeriod: 'monthly'
  },
  business: {
    maxProducts: -1,
    maxMonthlyAIResponses: -1,
    maxMonthlyMarketingImages: 40,
    maxFacebookPages: 1,
    maxInstagramAccounts: 1,
    maxWhatsAppAccounts: 0,
    maxShopifyStores: 0,
    maxTelegramBots: 0,
    maxTotalChannels: -1,
    maxCustomers: -1,
    hasAdvancedAnalytics: true,
    hasAPIAccess: false,
    hasSalesBot: true,
    billingPeriod: 'monthly'
  }
};

export const ZERO_PLAN_LIMITS: PlanLimits = {
  maxProducts: 0,
  maxMonthlyAIResponses: 0,
  maxMonthlyMarketingImages: 0,
  maxFacebookPages: 0,
  maxInstagramAccounts: 0,
  maxWhatsAppAccounts: 0,
  maxShopifyStores: 0,
  maxTelegramBots: 0,
  maxTotalChannels: 0,
  maxCustomers: 0,
  hasAdvancedAnalytics: false,
  hasAPIAccess: false,
  hasSalesBot: false,
  billingPeriod: 'monthly'
};

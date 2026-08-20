export interface Product {
  id: string;
  name: string;
  price: number;
  currency: string;
  category: string;
  stock: number;
  description: string;
  sizes?: string[];
  colors?: string[];
  /** Primary image (first in gallery); kept for bots / legacy */
  imageUrl?: string;
  /** Full product gallery (max 10); first is primary */
  images?: string[];
  /** Color linked to each gallery image (parallel to images); null/'' = unassigned */
  imageColors?: (string | null)[];
  source?: 'manual' | 'shopify' | 'storify' | 'excel';
  externalId?: string; // Shopify ID
}

export interface Service {
  id: string;
  name: string;
  category?: string;
  type: string;
  shortDescription: string;
  fullDescription?: string;
  priceLabel: string;
  pricingType: 'one_time' | 'subscription' | 'per_hour';
  duration?: string;
  deliveryTime?: string;
  includedItems: string[];
  requirements: string[];
  previousWorkTemplates?: string[];
  bookingLink?: string;
  contactChannel?: string;
}

export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  currency?: string;
}

export type OrderStatus = 'pending' | 'paid' | 'fulfilled' | 'cancelled';

export interface Order {
  id: string;
  externalId?: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  customerAddress?: string;
  total: number;
  currency: string;
  status: OrderStatus;
  date: Date;
  items: OrderItem[];
  source: string;
  notes?: string;
  viewedAt?: string | null;
}

export type ChatPlatform =
  | 'web'
  | 'facebook_messenger'
  | 'facebook_comment'
  | 'instagram'
  | 'telegram'
  | 'whatsapp';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  platform?: ChatPlatform;
}

export type BotPersona = 'formal' | 'friendly' | 'sales' | 'fast' | 'luxury';

export interface StorePolicies {
  shippingPolicy: string;
  deliveryTime: string;
  paymentMethods: string;
  returnPolicy: string;
  additionalNotes: string;
  enableAIInjection: boolean;
}

export interface SalesScripts {
  welcomeScript?: string;
  objectionHandlingScript?: string;
  closingScript?: string;
  crossSellScript?: string;
}

export interface MerchantSettings {
  storeName: string;
  telegramBotToken: string;
  welcomeMessage: string;
  systemPrompt: string;
  autoReplyComments: boolean;
  autoReplyMessenger: boolean;
  storeCurrency: string;
  botPersona: BotPersona;
  storePolicies: StorePolicies;
  signupDate: Date;
  // Sales optimization settings
  enableCrossSelling?: boolean;
  enableUpselling?: boolean;
  enableUrgencyMessages?: boolean;
  enableSocialProof?: boolean;
  defaultDiscountPercentage?: number;
  salesScripts?: SalesScripts;
  /** Recover incomplete checkouts with one gentle reminder inside the 24h window */
  abandonedReminderEnabled?: boolean;
  /** Customer silence (minutes) before the reminder */
  abandonedReminderDelayMinutes?: number;
  /** Optional template: {name}, {product}, {product_clause} */
  abandonedReminderMessage?: string;
  /** Plan feature flags (from GET /settings) */
  planCapabilities?: PlanCapabilities;
}

export interface PlanCapabilities {
  hasSalesBot: boolean;
  hasAdvancedAnalytics: boolean;
  maxTelegramBots: number;
  maxTotalChannels: number;
  maxFacebookPages: number;
  maxInstagramAccounts: number;
  maxWhatsAppAccounts: number;
  maxShopifyStores: number;
  maxStorifyStores: number;
  maxMonthlyMarketingImages: number;
  billingPeriod: 'monthly' | 'yearly';
}

/** Optimistic defaults until GET /settings returns planCapabilities. */
export const DEFAULT_PLAN_CAPABILITIES: PlanCapabilities = {
  hasSalesBot: true,
  hasAdvancedAnalytics: true,
  maxTelegramBots: 1,
  maxTotalChannels: -1,
  maxFacebookPages: 1,
  maxInstagramAccounts: 1,
  maxWhatsAppAccounts: 0,
  maxShopifyStores: 0,
  maxStorifyStores: 1,
  maxMonthlyMarketingImages: -1,
  billingPeriod: 'monthly'
};

export enum AppView {
  DASHBOARD = 'DASHBOARD',
  PRODUCTS = 'PRODUCTS',
  SERVICES = 'SERVICES',
  SERVICE_BOT = 'SERVICE_BOT',
  ORDERS = 'ORDERS',
  IMAGE_STUDIO = 'IMAGE_STUDIO',
  CHAT_TEST = 'CHAT_TEST',
  INTEGRATIONS = 'INTEGRATIONS',
  SOCIAL_AUTOMATION = 'SOCIAL_AUTOMATION',
  CONTENT_PUBLISHING = 'CONTENT_PUBLISHING',
  SETTINGS = 'SETTINGS',
  AFFILIATE = 'AFFILIATE',
  NOTIFICATIONS = 'NOTIFICATIONS',
  INBOX = 'INBOX',
  CRM = 'CRM',
  ANALYTICS = 'ANALYTICS',
  SUPPORT_TICKETS = 'SUPPORT_TICKETS',
  SUPER_ADMIN = 'SUPER_ADMIN',
  PROFILE = 'PROFILE',
}

export interface IntegrationStatus {
  isConnected: boolean;
  lastSync?: Date;
  accountName?: string;
  platformId?: string;
}

export interface IntegrationLog {
  id: string;
  platform: 'Facebook' | 'Shopify' | 'Telegram';
  action: string;
  details: string;
  timestamp: Date;
  status: 'success' | 'error' | 'info';
}

export interface AIProductDescriptionResponse {
  title: string;
  description: string;
  features: string[];
  cta: string;
}

export type ReferralStatus = 'pending' | 'active' | 'expired';

export interface Referral {
  id: string;
  referrerId: string;
  newUserId: string;
  newUserEmail: string;
  date: Date;
  status: ReferralStatus;
  commissionAmount: number;
  plan: 'Starter' | 'Pro' | 'Business';
  daysRemaining?: number | null; // Days remaining until commission becomes active (for pending status)
}

export interface AffiliateStats {
  referralCode: string;
  referralLink: string;
  totalVisits: number;
  totalSignups: number;
  activeConversions: number;
  totalEarnings: number;
  availableBalance: number;
  referrals: Referral[];
}

export type UserRole = 'owner' | 'admin' | 'user';

export enum AdminView {
  OVERVIEW = 'OVERVIEW',
  USERS = 'USERS',
  SUBSCRIPTIONS = 'SUBSCRIPTIONS',
  USAGE = 'USAGE',
  AFFILIATE_PROGRAM = 'AFFILIATE_PROGRAM',
  TRIALS = 'TRIALS',
  ALERTS = 'ALERTS',
  PAGES = 'PAGES',
  SETTINGS = 'SETTINGS',
  LOGS = 'LOGS',
  NOTIFICATIONS = 'NOTIFICATIONS',
  EMAIL_BROADCAST = 'EMAIL_BROADCAST',
  USER_NOTIFICATIONS = 'USER_NOTIFICATIONS',
  SUPPORT_TICKETS = 'SUPPORT_TICKETS',
  PAYMENT_REQUESTS = 'PAYMENT_REQUESTS',
  OFFICIAL_PAGE_COMMENTS = 'OFFICIAL_PAGE_COMMENTS'
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  registrationDate: Date;
  plan: 'Trial' | 'Starter' | 'Pro' | 'Business';
  status: 'active' | 'suspended' | 'expired';
  isTrial: boolean;
  trialEndsAt?: Date;
}

export interface AdminStats {
  totalUsers: number;
  activeUsersMonth: number;
  paidSubscriptions: number;
  totalAiResponses: number;
  estimatedMrr: number;
  // New metrics
  arpu: number; // Average Revenue Per User
  churnRate: number; // Churn Rate (percentage)
  conversionRate: number; // Trial to Paid conversion rate
  trialsEndingSoon: number; // Trials ending in next 7 days
  arr: number; // Annual Recurring Revenue
  newUsersToday: number;
  newUsersThisWeek: number;
  newUsersThisMonth: number;
}

export interface AdminGlobalSettings {
  trialDays: number;
  trialAiLimit: number;
  defaultAiModel: string;
  features: {
    affiliateEnabled: boolean;
    landingBotEnabled: boolean;
    dashboardBotEnabled: boolean;
    productsBotEnabled: boolean;
    servicesBotEnabled: boolean;
    officialPageBotEnabled: boolean;
  };
  bots: {
    productsBot: {
      enabled: boolean;
      systemMessage: string;
    };
    servicesBot: {
      enabled: boolean;
      systemMessage: string;
    };
    officialPageBot: {
      enabled: boolean;
      systemMessage: string;
    };
  };
  paymentMethods?: {
    shamCash: {
      enabled: boolean;
      walletAddress: string;
      qrImageUrl: string;
      instructions?: string;
    };
    usdt: {
      enabled: boolean;
      walletAddress: string;
      qrImageUrl: string;
      network?: string;
      instructions?: string;
    };
  };
}

export interface SystemLog {
  id: string;
  time: Date;
  type: 'info' | 'warning' | 'error';
  source: string;
  message: string;
}

// CRM Types
export type CustomerType = 'regular' | 'vip' | 'wholesale' | 'new';
export type CustomerStatus = 'active' | 'inactive' | 'blocked';
export type InteractionType = 'message' | 'call' | 'email' | 'order' | 'complaint' | 'review' | 'note';

export interface Customer {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  country?: string;
  customerType: CustomerType;
  status: CustomerStatus;
  totalOrders: number;
  totalSpent: number;
  lastOrderDate?: Date;
  lastInteractionDate?: Date;
  notes?: string;
  tags?: string[];
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomerInteraction {
  id: string;
  customerId: string;
  interactionType: InteractionType;
  title?: string;
  description?: string;
  platform?: string;
  relatedOrderId?: string;
  relatedConversationId?: string;
  createdBy?: string;
  createdAt: Date;
}

export interface CustomerTag {
  id: string;
  name: string;
  color: string;
  createdAt: Date;
}

export interface CustomerStats {
  totalCustomers: number;
  activeCustomers: number;
  vipCustomers: number;
  newCustomersThisMonth: number;
  totalRevenue: number;
  averageOrderValue: number;
}
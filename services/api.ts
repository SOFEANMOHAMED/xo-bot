/**
 * API Service Layer
 * Handles all HTTP requests to the backend API
 */

import { logger } from '../utils/logger';

const API_BASE_URL = (import.meta as any).env?.VITE_API_URL || 'https://xo-bot.com/api';

logger.log('API Base URL:', API_BASE_URL);

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: {
    message: string;
    code?: string;
  };
}

export interface MarketingImageRecord {
  id: string;
  prompt: string;
  revisedPrompt?: string | null;
  aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  imageSize: '1K' | '2K' | '4K';
  mimeType: string;
  fileSize?: number | null;
  createdAt: string;
}

class ApiService {
  private baseURL: string;
  /** In-memory only — JWT lives in HttpOnly cookie; Bearer is transitional fallback. */
  private token: string | null = null;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
    // Migrate away from localStorage JWT (XSS risk)
    if (typeof window !== 'undefined') {
      const legacy = localStorage.getItem('auth_token');
      if (legacy) {
        this.token = legacy;
        localStorage.removeItem('auth_token');
        void this.establishSession(legacy).catch(() => {
          /* cookie may already be set from login */
        });
      }
    }
  }

  setToken(token: string | null) {
    this.token = token;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_token');
    }
    if (token) {
      void this.establishSession(token).catch(() => {
        /* ignore — cookie auth may already work */
      });
    }
  }

  async establishSession(token: string): Promise<void> {
    await fetch(`${this.baseURL}/auth/session`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
  }

  async unlockAdminGate(secret: string): Promise<void> {
    await this.request<{ unlocked: boolean }>(
      '/auth/admin-gate',
      { method: 'POST', body: JSON.stringify({ secret }) },
      false
    );
  }

  async getAdminGateStatus(): Promise<{ unlocked: boolean }> {
    return this.request<{ unlocked: boolean }>('/auth/admin-gate', { method: 'GET' }, false);
  }

  async lockAdminGate(): Promise<void> {
    await fetch(`${this.baseURL}/auth/admin-gate`, {
      method: 'DELETE',
      credentials: 'include',
    });
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    requireAuth: boolean = true
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (options.headers) {
      const extra = new Headers(options.headers);
      extra.forEach((value, key) => {
        headers[key] = value;
      });
    }

    // Prefer cookie; send Bearer only as transitional fallback
    if (requireAuth && this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    try {
      logger.log('API Request:', { 
        url, 
        method: options.method || 'GET',
        baseURL: API_BASE_URL,
        endpoint 
      });
      
      const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include',
      });

      logger.log('API Response:', { 
        status: response.status, 
        statusText: response.statusText,
        url: response.url,
        ok: response.ok
      });

      // Check for 502 Bad Gateway or other gateway errors
      if (response.status === 502 || response.status === 503 || response.status === 504) {
        throw new Error(`الخادم غير متاح حالياً (${response.status} Bad Gateway). يرجى التأكد من أن الـ backend يعمل على ${API_BASE_URL}`);
      }

      // Check if response has content
      const contentType = response.headers.get('content-type');
      const text = await response.text();
      
      logger.log('API Response Text:', text.substring(0, 200));
      
      // If response is empty, throw error
      if (!text || text.trim() === '') {
        throw new Error(`Empty response from server. Status: ${response.status}`);
      }

      // Check if response is HTML (usually means gateway error or server error page)
      if (contentType && contentType.includes('text/html')) {
        if (text.includes('502 Bad Gateway') || text.includes('503 Service Unavailable') || text.includes('504 Gateway Timeout')) {
          throw new Error(`الخادم غير متاح حالياً. يرجى التأكد من أن الـ backend يعمل على ${API_BASE_URL}`);
        }
        if (response.status === 413) {
          throw new Error(
            'حجم الطلب كبير جداً (413). إذا كنت ترسل صورة، جرّب صورة أصغر أو أعد المحاولة بعد التحديث.'
          );
        }
        throw new Error(`استجابة غير متوقعة من الخادم (HTML بدلاً من JSON). Status: ${response.status}. يرجى التأكد من أن الـ backend يعمل بشكل صحيح.`);
      }

      // Try to parse JSON
      let data: ApiResponse<T>;
      try {
        data = JSON.parse(text);
      } catch (parseError) {
        logger.error('Failed to parse JSON:', text);
        // Check if it's an HTML error page
        if (text.trim().startsWith('<html') || text.trim().startsWith('<!DOCTYPE')) {
          throw new Error(`الخادم غير متاح حالياً. يرجى التأكد من أن الـ backend يعمل على ${API_BASE_URL}`);
        }
        throw new Error(`Invalid JSON response from server: ${text.substring(0, 100)}`);
      }

      if (!response.ok) {
        if (response.status === 429) {
          const d = data as ApiResponse<T> & { message?: string; error?: string | { message?: string } };
          const fromBody =
            (typeof d.error === 'string' && d.error) ||
            (typeof d.error === 'object' && d.error?.message) ||
            d.message;
          const httpErr = new Error(
            fromBody ||
              'محاولات كثيرة في وقت قصير. انتظر حتى 15 دقيقة ثم حاول تسجيل الدخول مجدداً.'
          ) as Error & { status?: number };
          httpErr.status = 429;
          throw httpErr;
        }
        // Check for trial / paid subscription expired errors
        if (
          response.status === 403 &&
          (data.error?.code === 'TRIAL_EXPIRED' || data.error?.code === 'SUBSCRIPTION_EXPIRED')
        ) {
          const error = new Error(data.error?.message || 'Subscription expired') as any;
          error.code = data.error.code;
          error.requiresUpgrade = true;
          error.status = 403;
          throw error;
        }
        const httpErr = new Error(data.error?.message || `HTTP error! status: ${response.status}`) as Error & {
          status?: number;
          code?: string;
        };
        httpErr.status = response.status;
        if (data.error?.code) {
          httpErr.code = data.error.code;
        }
        throw httpErr;
      }

      // Check if data structure is correct
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid response format from server');
      }

      // If data has success field and it's false, throw error
      if (data.success === false) {
        throw new Error(data.error?.message || 'Request failed');
      }

      // Return data.data if it exists, otherwise return data itself
      return data.data !== undefined ? data.data : (data as any);
    } catch (error: any) {
      // Log detailed error information
      const errorDetails = {
        url,
        endpoint,
        method: options.method || 'GET',
        error: error.message || String(error),
        status: error.status,
        statusText: error.statusText,
        response: error.response,
        stack: error.stack
      };
      
      logger.error('API request failed:', errorDetails);
      
      // Provide more helpful error messages
      if (error.message?.includes('fetch') || error.message?.includes('Failed to fetch') || error.name === 'TypeError') {
        throw new Error(`لا يمكن الاتصال بالخادم. يرجى التأكد من أن الـ backend يعمل على ${API_BASE_URL}`);
      }
      
      if (error.message?.includes('502') || error.message?.includes('Bad Gateway') || error.message?.includes('الخادم غير متاح')) {
        throw new Error(`الخادم غير متاح حالياً (502 Bad Gateway). يرجى التأكد من أن الـ backend يعمل على ${API_BASE_URL}`);
      }
      
      if (error.message?.includes('503') || error.message?.includes('Service Unavailable')) {
        throw new Error(`الخدمة غير متاحة حالياً (503). يرجى المحاولة لاحقاً أو التأكد من أن الـ backend يعمل.`);
      }
      
      if (error.message?.includes('504') || error.message?.includes('Gateway Timeout')) {
        throw new Error(`انتهت مهلة الاتصال (504). يرجى المحاولة مرة أخرى أو التأكد من أن الـ backend يعمل.`);
      }
      
      if (error.message?.includes('404') || error.message?.includes('Empty response')) {
        throw new Error(`API endpoint not found. Please check if the backend is running and the route exists. URL: ${url}`);
      }
      
      // Re-throw with more context if it's not already an Error object
      if (error instanceof Error) {
        throw error;
      } else {
        throw new Error(`API request failed: ${error.message || String(error)}`);
      }
    }
  }

  // Auth endpoints
  async register(
    email: string,
    password: string,
    name?: string,
    referralCode?: string,
    phone?: string,
    acquisition?: Record<string, unknown>
  ) {
    const response = await this.request<{
      user: {
        id: string;
        email: string;
        name: string | null;
        subscriptionPlan: string;
        subscriptionStatus?: string;
        trialEndsAt?: string | null;
        subscriptionEndsAt?: string | null;
        createdAt?: string;
      };
      token: string;
    }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name, referralCode, phone, acquisition }),
    }, false);
    
    this.setToken(response.token);
    return response;
  }

  async login(email: string, password: string) {
    const response = await this.request<{
      user: {
        id: string;
        email: string;
        name: string | null;
        subscriptionPlan: string;
        subscriptionStatus?: string;
        trialEndsAt?: string | null;
        subscriptionEndsAt?: string | null;
        createdAt?: string;
      };
      token: string;
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }, false);
    
    this.setToken(response.token);
    return response;
  }

  async logout() {
    this.token = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_token');
    }
    try {
      return await this.request<{ success: boolean; message: string }>('/auth/logout', {
        method: 'POST'
      }, false);
    } catch {
      return { success: true, message: 'Logged out locally' };
    }
  }

  async getProfile() {
    return this.request<{
      user: {
        id: string;
        email: string;
        name: string | null;
        subscriptionPlan: string;
        subscriptionStatus: string;
        trialEndsAt: string | null;
        subscriptionEndsAt?: string | null;
        createdAt: string;
        role?: 'owner' | 'admin' | 'user';
      };
    }>('/auth/profile');
  }

  async forgotPassword(email: string) {
    return this.request<{ message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  }

  async resetPassword(token: string, password: string) {
    return this.request<{ message: string }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    });
  }

  async deleteAccount() {
    return this.request<{ success: boolean; message: string }>('/auth/account', {
      method: 'DELETE',
    });
  }

  async updateProfile(data: { name?: string; email?: string; phone?: string }) {
    return this.request<{
      user: {
        id: string;
        email: string;
        name: string | null;
        phone: string | null;
      };
    }>('/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async changePassword(currentPassword: string, newPassword: string) {
    return this.request<{ message: string }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  }

  async completeProfile(data: {
    password: string;
    phone: string;
    referralCode?: string;
    acquisition?: Record<string, unknown>;
  }) {
    return this.request<{ message: string; data: { user: { id: string; email: string } } }>('/auth/complete-profile', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Product endpoints
  async getProducts() {
    return this.request<{
      products: Array<{
        id: string;
        externalId: string | null;
        name: string;
        description: string | null;
        price: number;
        currency: string;
        category: string | null;
        stock: number;
        sizes: string[];
        colors: string[];
        imageUrl: string | null;
        images: string[];
        imageColors?: (string | null)[];
        source: string;
        createdAt: string;
        updatedAt: string;
      }>;
    }>('/products');
  }

  async getProduct(id: string) {
    return this.request<{
      product: {
        id: string;
        externalId: string | null;
        name: string;
        description: string | null;
        price: number;
        currency: string;
        category: string | null;
        stock: number;
        sizes: string[];
        colors: string[];
        imageUrl: string | null;
        images: string[];
        imageColors?: (string | null)[];
        source: string;
        createdAt: string;
        updatedAt: string;
      };
    }>(`/products/${id}`);
  }

  async createProduct(product: {
    name: string;
    description?: string;
    price: number;
    currency?: string;
    category?: string;
    stock?: number;
    sizes?: string[];
    colors?: string[];
    imageUrl?: string;
    images?: string[];
    imageColors?: (string | null)[];
    source?: 'manual' | 'shopify' | 'storify' | 'excel';
    externalId?: string;
  }) {
    return this.request<{
      product: {
        id: string;
        externalId: string | null;
        name: string;
        description: string | null;
        price: number;
        currency: string;
        category: string | null;
        stock: number;
        sizes: string[];
        colors: string[];
        imageUrl: string | null;
        images: string[];
        imageColors?: (string | null)[];
        source: string;
        createdAt: string;
        updatedAt: string;
      };
    }>('/products', {
      method: 'POST',
      body: JSON.stringify(product),
    });
  }

  async updateProduct(id: string, updates: Partial<{
    name: string;
    description: string;
    price: number;
    currency: string;
    category: string;
    stock: number;
    sizes: string[];
    colors: string[];
    imageUrl: string;
    images: string[];
    imageColors: (string | null)[];
    source: 'manual' | 'shopify' | 'storify' | 'excel';
  }>) {
    return this.request<{
      product: {
        id: string;
        externalId: string | null;
        name: string;
        description: string | null;
        price: number;
        currency: string;
        category: string | null;
        stock: number;
        sizes: string[];
        colors: string[];
        imageUrl: string | null;
        images: string[];
        imageColors?: (string | null)[];
        source: string;
        createdAt: string;
        updatedAt: string;
      };
    }>(`/products/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async deleteProduct(id: string) {
    return this.request<{ message: string }>(`/products/${id}`, {
      method: 'DELETE',
    });
  }

  // Order endpoints
  async getOrders(status?: string) {
    const query = status && status !== 'all' ? `?status=${status}` : '';
    return this.request<{
      orders: Array<{
        id: string;
        externalId: string | null;
        customerName: string;
        customerEmail: string | null;
        customerPhone: string | null;
        customerAddress: string | null;
        total: number;
        currency: string;
        status: 'pending' | 'paid' | 'fulfilled' | 'cancelled';
        source: string;
        notes: string | null;
        items: Array<{
          id: string;
          productId: string | null;
          productName: string;
          quantity: number;
          price: number;
          currency: string;
        }>;
        date: string;
        viewedAt: string | null;
        createdAt: string;
        updatedAt: string;
      }>;
    }>(`/orders${query}`);
  }

  async getOrder(id: string) {
    return this.request<{
      order: {
        id: string;
        externalId: string | null;
        customerName: string;
        customerEmail: string | null;
        customerPhone: string | null;
        customerAddress: string | null;
        total: number;
        currency: string;
        status: 'pending' | 'paid' | 'fulfilled' | 'cancelled';
        source: string;
        notes: string | null;
        items: Array<{
          id: string;
          productId: string | null;
          productName: string;
          quantity: number;
          price: number;
          currency: string;
        }>;
        date: string;
        viewedAt: string | null;
        createdAt: string;
        updatedAt: string;
      };
    }>(`/orders/${id}`);
  }

  async createOrder(order: {
    externalId?: string;
    customerName: string;
    customerEmail?: string;
    customerPhone?: string;
    customerAddress?: string;
    total: number;
    currency?: string;
    status?: 'pending' | 'paid' | 'fulfilled' | 'cancelled';
    source?: 'shopify' | 'storify' | 'manual';
    items: Array<{
      productId?: string;
      productName: string;
      quantity: number;
      price: number;
      currency?: string;
    }>;
    notes?: string;
  }) {
    return this.request<{
      order: {
        id: string;
        externalId: string | null;
        customerName: string;
        customerEmail: string | null;
        customerPhone: string | null;
        customerAddress: string | null;
        total: number;
        currency: string;
        status: 'pending' | 'paid' | 'fulfilled' | 'cancelled';
        source: string;
        notes: string | null;
        items: Array<{
          id: string;
          productId: string | null;
          productName: string;
          quantity: number;
          price: number;
          currency: string;
        }>;
        date: string;
        createdAt: string;
        updatedAt: string;
      };
    }>('/orders', {
      method: 'POST',
      body: JSON.stringify(order),
    });
  }

  async updateOrderStatus(id: string, status: 'pending' | 'paid' | 'fulfilled' | 'cancelled') {
    return this.request<{
      order: {
        id: string;
        status: string;
      };
    }>(`/orders/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  async markOrderAsViewed(id: string) {
    return this.request<{
      order: {
        id: string;
        viewedAt: string;
      };
    }>(`/orders/${id}/viewed`, {
      method: 'PATCH',
    });
  }

  async deleteOrder(id: string) {
    return this.request<{ message: string }>(`/orders/${id}`, {
      method: 'DELETE',
    });
  }

  // Service endpoints
  async getServices() {
    return this.request<{
      services: Array<{
        id: string;
        name: string;
        category: string | null;
        type: string | null;
        shortDescription: string;
        fullDescription: string | null;
        priceLabel: string;
        pricingType: string;
        duration: string | null;
        deliveryTime: string | null;
        includedItems: string[];
        requirements: string[];
        previousWorkTemplates: string[];
        bookingLink: string | null;
        contactChannel: string | null;
        createdAt: string;
        updatedAt: string;
      }>;
    }>('/services');
  }

  async createService(service: any) {
    return this.request<{ service: any }>('/services', {
      method: 'POST',
      body: JSON.stringify(service),
    });
  }

  async updateService(id: string, updates: any) {
    return this.request<{ service: any }>(`/services/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async deleteService(id: string) {
    return this.request<{ message: string }>(`/services/${id}`, {
      method: 'DELETE',
    });
  }

  // Settings endpoints
  async getSettings() {
    return this.request<{
      settings: {
        storeName: string;
        telegramBotToken: string;
        welcomeMessage: string;
        systemPrompt: string;
        autoReplyComments: boolean;
        autoReplyMessenger: boolean;
        storeCurrency: string;
        botPersona: string;
        storePolicies: {
          shippingPolicy: string;
          deliveryTime: string;
          paymentMethods: string;
          returnPolicy: string;
          additionalNotes: string;
          enableAIInjection: boolean;
        };
        signupDate: string;
        abandonedReminderEnabled?: boolean;
        abandonedReminderDelayMinutes?: number;
        abandonedReminderMessage?: string;
      };
      planCapabilities?: {
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
      };
    }>('/settings');
  }

  async updateSettings(settings: any) {
    return this.request<{
      settings: any;
    }>('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  async getUserDashboardStats() {
    return this.request<{
      totalQueries: number;
      chartData: {
        '7days': Array<{ name: string; queries: number }>;
        'month': Array<{ name: string; queries: number }>;
        'year': Array<{ name: string; queries: number }>;
      };
    }>('/settings/dashboard-stats');
  }

  // Conversation endpoints (merchant inbox)
  async getConversations(params?: {
    platform?: string;
    status?: string;
    search?: string;
    includeWeb?: boolean;
    limit?: number;
    offset?: number;
  }) {
    const qs = new URLSearchParams();
    if (params?.platform) qs.set('platform', params.platform);
    if (params?.status) qs.set('status', params.status);
    if (params?.search) qs.set('search', params.search);
    if (params?.includeWeb) qs.set('includeWeb', 'true');
    if (params?.limit != null) qs.set('limit', String(params.limit));
    if (params?.offset != null) qs.set('offset', String(params.offset));
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return this.request<{
      conversations: Array<{
        id: string;
        platform: string;
        userId?: string | null;
        userName?: string | null;
        lastMessageAt: string;
        createdAt: string;
        botDisabled: boolean;
        status: string;
        lastHumanResponseAt?: string | null;
        lastMessagePreview?: string | null;
        lastSenderType?: string | null;
        messageCount: number;
      }>;
      total: number;
      limit: number;
      offset: number;
    }>(`/conversations${query}`);
  }

  async getConversation(id: string) {
    return this.request<{
      conversation: {
        id: string;
        platform: string;
        userId?: string | null;
        userName?: string | null;
        lastMessageAt: string;
        createdAt: string;
        botDisabled: boolean;
        status: string;
        lastHumanResponseAt?: string | null;
        sourcePost?: {
          source: string;
          sourceLabel: string;
          platform: string | null;
          externalPostId: string | null;
          caption: string | null;
          thumbnailUrl: string | null;
          permalink: string | null;
          productId: string | null;
          productName: string | null;
          commentId: string | null;
          adId: string | null;
          capturedAt: string | null;
        } | null;
        messages: Array<{
          id: string;
          role: string;
          content: string;
          senderType?: string;
          source?: string | null;
          imageUrl?: string | null;
          metadata?: Record<string, unknown> | null;
          readAt?: string | null;
          deliveredAt?: string | null;
          timestamp: string;
          createdAt: string;
        }>;
      };
    }>(`/conversations/${id}`);
  }

  async disableBotForConversation(conversationId: string) {
    return this.request<{ success?: boolean; message?: string }>(
      `/conversations/${conversationId}/disable-bot`,
      { method: 'PUT' }
    );
  }

  async enableBotForConversation(conversationId: string) {
    return this.request<{ success?: boolean; message?: string }>(
      `/conversations/${conversationId}/enable-bot`,
      { method: 'PUT' }
    );
  }

  async sendHumanMessage(conversationId: string, message: string, imageUrl?: string | null) {
    return this.request<{
      conversationId: string;
      delivered: boolean;
      message: {
        id: string;
        role: string;
        content: string;
        senderType: string;
        source?: string | null;
        imageUrl?: string | null;
        metadata?: Record<string, unknown> | null;
        createdAt: string;
        timestamp: string;
      };
      botDisabled: boolean;
      status: string;
    }>(`/conversations/${conversationId}/send-human-message`, {
      method: 'POST',
      body: JSON.stringify({ message, imageUrl: imageUrl || undefined }),
    });
  }

  async setInboxTyping(conversationId: string, isTyping: boolean) {
    return this.request<{ ok: boolean }>(`/conversations/${conversationId}/typing`, {
      method: 'POST',
      body: JSON.stringify({ isTyping }),
    });
  }

  async markInboxRead(conversationId: string) {
    return this.request<{ ok: boolean }>(`/conversations/${conversationId}/mark-read`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  async getOrCreateConversation(platform: string, userId: string) {
    return this.request<{
      conversation: {
        id: string;
        platform: string;
        userId?: string;
        userName?: string;
        lastMessageAt: string;
        createdAt: string;
        messages: Array<{
          id: string;
          role: string;
          content: string;
          timestamp: string;
          createdAt: string;
        }>;
      };
    }>(`/conversations/get-or-create?platform=${platform}&userId=${userId}`);
  }

  async createConversation(data: {
    platform: 'web' | 'facebook_messenger' | 'facebook_comment' | 'telegram';
    userId?: string;
    userName?: string;
    messages: Array<{
      role: 'user' | 'assistant' | 'system';
      content: string;
      platform?: 'web' | 'facebook_messenger' | 'facebook_comment' | 'telegram';
    }>;
  }) {
    return this.request<{
      conversation: {
        id: string;
        platform: string;
        userId?: string;
        userName?: string;
        lastMessageAt: string;
        createdAt: string;
        messages: Array<{
          id: string;
          role: string;
          content: string;
          timestamp: string;
          createdAt: string;
        }>;
      };
    }>('/conversations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async addMessage(conversationId: string, message: {
    role: 'user' | 'assistant' | 'system';
    content: string;
    platform?: 'web' | 'facebook_messenger' | 'facebook_comment' | 'telegram';
  }) {
    return this.request<{
      message: {
        id: string;
        role: string;
        content: string;
        timestamp: string;
        createdAt: string;
      };
    }>(`/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify(message),
    });
  }

  // SaaS Bot endpoint (public, no auth required)
  async generateSaaSBotResponse(query: string, botType: 'marketing' | 'support') {
    return this.request<{
      response: string;
    }>('/ai/saas-bot', {
      method: 'POST',
      body: JSON.stringify({ query, botType }),
    }, false); // No auth required
  }

  // AI Chat endpoint
  async generateChatResponse(data: {
    conversationId?: string;
    platform?: 'web' | 'facebook_messenger' | 'facebook_comment' | 'telegram';
    botType?: 'products' | 'services' | 'marketing' | 'support';
    messages: Array<{
      role: 'user' | 'assistant' | 'system';
      content: string;
    }>;
    context?: {
      products?: any[];
      services?: any[];
      storeName?: string;
      storeCurrency?: string;
      systemPrompt?: string;
      persona?: 'formal' | 'friendly' | 'sales' | 'fast' | 'luxury';
      policies?: {
        shippingPolicy?: string;
        deliveryTime?: string;
        paymentMethods?: string;
        returnPolicy?: string;
        additionalNotes?: string;
        enableAIInjection?: boolean;
      };
    };
  }) {
    return this.request<{
      response: string;
      conversationId: string | null;
    }>('/ai/chat', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /** توليد وصف منتج بالذكاء الاصطناعي (عبر الخادم — OPENAI_API_KEY) */
  async generateProductDescriptionAI(body: {
    productName: string;
    keywords?: string;
    category?: string;
    imageBase64?: string;
  }) {
    return this.request<{
      title: string;
      description: string;
      features: string[];
      cta: string;
    }>('/ai/product-description', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /** ستوديو التصميم — توليد صورة (الخادم، Kie.ai Nano Banana Pro) */
  async generateMarketingImageAI(body: {
    prompt: string;
    aspectRatio?: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
    referenceImageBase64s?: string[];
  }) {
    return this.request<{
      imageDataUrl: string;
      revisedPrompt?: string;
      image?: MarketingImageRecord;
    }>('/ai/marketing-image', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async getMarketingImageHistory(limit: number = 24) {
    return this.request<{
      images: MarketingImageRecord[];
      quota?: {
        used: number;
        limit: number;
        remaining: number;
        billingPeriod: 'monthly' | 'yearly';
      };
    }>(`/ai/marketing-images?limit=${encodeURIComponent(String(limit))}`);
  }

  async getMarketingImageBlob(id: string, download: boolean = false): Promise<Blob> {
    const headers: Record<string, string> = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(
      `${this.baseURL}/ai/marketing-images/${encodeURIComponent(id)}/content${download ? '?download=1' : ''}`,
      {
        headers,
        credentials: 'include',
      }
    );

    if (!response.ok) {
      let message = `HTTP error! status: ${response.status}`;
      try {
        const data = await response.json();
        message = data.error?.message || data.message || message;
      } catch {
        // Keep the HTTP status message when the response is not JSON.
      }
      throw new Error(message);
    }

    return response.blob();
  }

  // File upload endpoints
  async uploadFile(file: File): Promise<{
    file: {
      filename: string;
      originalName: string;
      mimetype: string;
      size: number;
      url: string;
      path: string;
    };
  }> {
    const formData = new FormData();
    formData.append('file', file);

    const url = `${this.baseURL}/upload/single`;
    const headers: HeadersInit = {};

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include',
    });

    const text = await response.text();
    const data = JSON.parse(text);

    if (!response.ok) {
      throw new Error(data.error?.message || `HTTP error! status: ${response.status}`);
    }

    return data.data !== undefined ? data.data : data;
  }

  async uploadFiles(files: File[]): Promise<{
    files: Array<{
      filename: string;
      originalName: string;
      mimetype: string;
      size: number;
      url: string;
      path: string;
    }>;
  }> {
    const formData = new FormData();
    files.forEach(file => {
      formData.append('files', file);
    });

    const url = `${this.baseURL}/upload/multiple`;
    const headers: HeadersInit = {};

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include',
    });

    const text = await response.text();
    const data = JSON.parse(text);

    if (!response.ok) {
      throw new Error(data.error?.message || `HTTP error! status: ${response.status}`);
    }

    return data.data !== undefined ? data.data : data;
  }

  async deleteFile(filename: string) {
    return this.request<{ message: string }>(`/upload/${filename}`, {
      method: 'DELETE',
    });
  }

  // Integration endpoints
  async getIntegrations() {
    return this.request<{
      facebook: {
        isConnected: boolean;
        accountName?: string;
        platformId?: string;
        lastSync?: string;
        commentReplyTemplate?: string | null;
        commentDmTemplate?: string | null;
        sendDmOnComment?: boolean;
        pages?: Array<{
          pageId: string;
          pageName: string;
          autoReplyMessenger: boolean;
          autoReplyComments: boolean;
        }>;
      };
      shopify: {
        isConnected: boolean;
        accountName?: string;
        lastSync?: string;
      };
      storify?: {
        isConnected: boolean;
        accountName?: string;
        lastSync?: string;
      };
      instagram?: {
        isConnected: boolean;
        accountName?: string;
        platformId?: string;
        autoReplyComments?: boolean;
        autoReplyDM?: boolean;
        sendDmOnComment?: boolean;
        commentReplyTemplate?: string | null;
        commentDmTemplate?: string | null;
        connectedAt?: string;
      };
    }>('/integrations');
  }

  async connectFacebook() {
    return this.request<{ 
      message?: string;
      data?: { authUrl: string };
      requiresSetup?: boolean;
    }>('/integrations/facebook/connect', {
      method: 'POST',
    });
  }

  async disconnectFacebook() {
    return this.request<{ message: string }>('/integrations/facebook/disconnect', {
      method: 'DELETE',
    });
  }

  async disconnectFacebookPage(pageId: string) {
    return this.request<{ message: string }>(`/integrations/facebook/disconnect/${pageId}`, {
      method: 'DELETE',
    });
  }

  async getAvailableFacebookPages(sessionId: string) {
    return this.request<{
      pages: Array<{
        id: string;
        name: string;
        category: string | null;
        pictureUrl: string | null;
        alreadyLinked: boolean;
      }>;
      limits: {
        maxFacebookPages: number;
        currentLinkedCount: number;
        remainingSlots: number;
      };
    }>(`/integrations/facebook/available-pages?session=${encodeURIComponent(sessionId)}`);
  }

  async linkFacebookPages(sessionId: string, pageIds: string[]) {
    return this.request<{
      message: string;
      newlyLinked: number;
      totalLinked: number;
    }>('/integrations/facebook/link-pages', {
      method: 'POST',
      body: JSON.stringify({ session: sessionId, pageIds }),
    });
  }

  async updateFacebookCommentSettings(payload: {
    commentReplyTemplate?: string;
    commentDmTemplate?: string;
    sendDmOnComment?: boolean;
  }) {
    return this.request<{ message: string }>('/integrations/facebook/comment-settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  // Instagram integration
  async connectInstagram() {
    return this.request<{
      authUrl?: string;
      requiresSetup?: boolean;
    }>('/integrations/instagram/connect', { method: 'POST' });
  }

  async disconnectInstagram() {
    return this.request<{ message: string }>('/integrations/instagram/disconnect', { method: 'DELETE' });
  }

  async updateInstagramSettings(settings: {
    autoReplyComments?: boolean;
    autoReplyDM?: boolean;
    sendDmOnComment?: boolean;
    commentReplyTemplate?: string;
    commentDmTemplate?: string;
  }) {
    return this.request<{ message: string }>('/integrations/instagram/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  async syncSocialPosts(platform?: 'facebook' | 'instagram') {
    return this.request<{ message: string; results: Array<{ synced: number; platform: string; accountRef: string }> }>(
      '/integrations/social/posts/sync',
      {
        method: 'POST',
        body: JSON.stringify(platform ? { platform } : {}),
      }
    );
  }

  async getSocialPosts(params?: {
    platform?: 'facebook' | 'instagram';
    accountRef?: string;
    limit?: number;
    offset?: number;
  }) {
    const q = new URLSearchParams();
    if (params?.platform) q.set('platform', params.platform);
    if (params?.accountRef) q.set('accountRef', params.accountRef);
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.offset) q.set('offset', String(params.offset));
    const qs = q.toString();
    return this.request<{ posts: any[] }>(`/integrations/social/posts${qs ? `?${qs}` : ''}`);
  }

  async linkSocialPostProduct(socialPostId: string, productId: string | null) {
    return this.request<{ message: string; link?: any; linked?: boolean }>(
      '/integrations/social/posts/link-product',
      {
        method: 'PUT',
        body: JSON.stringify({ socialPostId, productId }),
      }
    );
  }

  async updateSocialPostCommentSettings(payload: {
    socialPostId: string;
    commentReplyEnabled?: boolean;
    publicReplyText?: string | null;
    sendDmOnComment?: boolean;
    privateReplyText?: string | null;
  }) {
    return this.request<{ message: string; post: any }>(
      '/integrations/social/posts/comment-settings',
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    );
  }

  // ── Content publishing (FB / IG) ──────────────────────────────────────────

  async getContentPublishAccounts() {
    return this.request<{ accounts: import('../types/contentPublishing').ContentPublishAccount[] }>(
      '/content/accounts'
    );
  }

  async listContentPublications(params?: {
    status?: string;
    platform?: 'facebook' | 'instagram';
    limit?: number;
    offset?: number;
  }) {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.platform) q.set('platform', params.platform);
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.offset) q.set('offset', String(params.offset));
    const qs = q.toString();
    return this.request<{
      publications: import('../types/contentPublishing').ContentPublication[];
      total: number;
    }>(`/content/publications${qs ? `?${qs}` : ''}`);
  }

  async getContentPublication(id: string) {
    return this.request<{ publication: import('../types/contentPublishing').ContentPublication }>(
      `/content/publications/${id}`
    );
  }

  async createContentPublication(
    payload: import('../types/contentPublishing').CreateContentPublicationPayload
  ) {
    return this.request<{
      message: string;
      publication: import('../types/contentPublishing').ContentPublication;
    }>('/content/publications', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async updateContentPublication(
    id: string,
    payload: Partial<import('../types/contentPublishing').CreateContentPublicationPayload>
  ) {
    return this.request<{
      message: string;
      publication: import('../types/contentPublishing').ContentPublication;
    }>(`/content/publications/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  async deleteContentPublication(id: string) {
    return this.request<{ message: string }>(`/content/publications/${id}`, {
      method: 'DELETE',
    });
  }

  async publishContentPublicationNow(id: string) {
    return this.request<{
      message: string;
      publication: import('../types/contentPublishing').ContentPublication;
    }>(`/content/publications/${id}/publish`, {
      method: 'POST',
    });
  }

  async scheduleContentPublication(id: string, scheduledAt: string) {
    return this.request<{
      message: string;
      publication: import('../types/contentPublishing').ContentPublication;
    }>(`/content/publications/${id}/schedule`, {
      method: 'POST',
      body: JSON.stringify({ scheduledAt }),
    });
  }

  async cancelContentPublication(id: string) {
    return this.request<{
      message: string;
      publication: import('../types/contentPublishing').ContentPublication;
    }>(`/content/publications/${id}/cancel`, {
      method: 'POST',
    });
  }

  async getSocialKeywordRules(platform?: 'facebook' | 'instagram', socialPostId?: string) {
    const q = new URLSearchParams();
    if (platform) q.set('platform', platform);
    if (socialPostId) q.set('socialPostId', socialPostId);
    const qs = q.toString();
    return this.request<{ rules: any[] }>(`/integrations/social/keyword-rules${qs ? `?${qs}` : ''}`);
  }

  async createSocialKeywordRule(payload: Record<string, unknown>) {
    return this.request<{ rule: any }>('/integrations/social/keyword-rules', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async updateSocialKeywordRule(ruleId: string, payload: Record<string, unknown>) {
    return this.request<{ rule: any }>(`/integrations/social/keyword-rules/${ruleId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  async deleteSocialKeywordRule(ruleId: string) {
    return this.request<{ message: string }>(`/integrations/social/keyword-rules/${ruleId}`, {
      method: 'DELETE',
    });
  }

  async updateCommentAutomationMode(payload: {
    platform: 'facebook' | 'instagram';
    mode: 'template_all' | 'keyword_rules' | 'off';
    accountRef?: string;
  }) {
    return this.request<{ message: string }>('/integrations/social/comment-automation-mode', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  async connectShopify(shopDomain: string) {
    return this.request<{ 
      authUrl: string; 
      shopDomain: string;
      message?: string;
    }>('/integrations/shopify/connect', {
      method: 'POST',
      body: JSON.stringify({ shopDomain }),
    });
  }

  async disconnectShopify() {
    return this.request<{ message: string }>('/integrations/shopify/disconnect', {
      method: 'DELETE',
    });
  }

  async connectStorify(payload: {
    storeDomain: string;
    apiBaseUrl?: string;
    accessToken: string;
    productsEndpoint?: string;
  }) {
    return this.request<{
      accountName: string;
      message?: string;
    }>('/integrations/storify/connect', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async disconnectStorify() {
    return this.request<{ message: string }>('/integrations/storify/disconnect', {
      method: 'DELETE',
    });
  }

  async connectTelegram(botToken: string) {
    return this.request<{
      botInfo: {
        username: string;
        id: number;
        firstName: string;
      };
      webhookUrl: string;
      message: string;
    }>('/integrations/telegram/connect', {
      method: 'POST',
      body: JSON.stringify({ botToken }),
    });
  }

  async disconnectTelegram() {
    return this.request<{ message: string }>('/integrations/telegram/disconnect', {
      method: 'DELETE',
    });
  }

  // Multiple Telegram Bots API
  async getTelegramBots() {
    return this.request<{
      bots: Array<{
        id: string;
        botName: string | null;
        botUsername: string | null;
        botType: 'products' | 'services' | 'both';
        isActive: boolean;
        tokenPreview: string | null;
        createdAt: string;
        updatedAt: string;
      }>;
    }>('/integrations/telegram/bots');
  }

  async createTelegramBot(data: {
    botToken: string;
    botName?: string;
    botType: 'products' | 'services' | 'both';
  }) {
    return this.request<{
      bot: {
        id: string;
        botName: string | null;
        botUsername: string | null;
        botType: 'products' | 'services' | 'both';
        isActive: boolean;
        createdAt: string;
      };
      webhookUrl: string;
      message: string;
    }>('/integrations/telegram/bots', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateTelegramBot(botId: string, data: {
    botName?: string;
    botType?: 'products' | 'services' | 'both';
    isActive?: boolean;
  }) {
    return this.request<{
      bot: {
        id: string;
        botName: string | null;
        botUsername: string | null;
        botType: 'products' | 'services' | 'both';
        isActive: boolean;
        updatedAt: string;
      };
      message: string;
    }>(`/integrations/telegram/bots/${botId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteTelegramBot(botId: string) {
    return this.request<{ message: string }>(`/integrations/telegram/bots/${botId}`, {
      method: 'DELETE',
    });
  }

  async syncShopifyProducts() {
    return this.request<{
      jobId: string;
      imported: number;
      created: number;
      updated: number;
      failed: number;
      pages: number;
      completed: boolean;
      synced: number;
      message: string;
      products: Array<{
        id: string;
        externalId?: string;
        name: string;
        description?: string;
        price: number;
        currency: string;
        category?: string;
        stock: number;
        sizes?: string[];
        imageUrl?: string;
        image_url?: string;
        vendor?: string;
        productType?: string;
        tags?: string[];
        status?: string;
        totalInventory?: number;
        hasVariants?: boolean;
      }>;
    }>('/integrations/shopify/sync/products', {
      method: 'POST',
    });
  }

  async syncStorifyProducts() {
    return this.request<{
      jobId: string;
      imported: number;
      created: number;
      updated: number;
      failed: number;
      pages: number;
      completed: boolean;
      synced: number;
      message: string;
      products: Array<{
        id: string;
        externalId?: string;
        name: string;
        description?: string;
        price: number;
        currency: string;
        category?: string;
        stock: number;
        imageUrl?: string;
        source: 'storify';
      }>;
    }>('/integrations/storify/sync/products', {
      method: 'POST',
    });
  }

  async getSyncJobStatus(jobId: string) {
    return this.request<{
      id: string;
      platform: string;
      job_type: string;
      status: 'pending' | 'running' | 'completed' | 'failed';
      total_items: number;
      processed_items: number;
      created_items: number;
      updated_items: number;
      failed_items: number;
      current_page: number;
      total_pages: number;
      error_message?: string;
      started_at: string;
      completed_at?: string;
    }>(`/integrations/shopify/sync/jobs/${jobId}`, {
      method: 'GET',
    });
  }

  async getSyncHistory(platform?: string, limit: number = 20) {
    const params = new URLSearchParams();
    if (platform) params.append('platform', platform);
    params.append('limit', limit.toString());
    
    return this.request<Array<{
      id: string;
      platform: string;
      job_type: string;
      status: string;
      total_items: number;
      processed_items: number;
      created_items: number;
      updated_items: number;
      failed_items: number;
      error_message?: string;
      started_at: string;
      completed_at?: string;
    }>>(`/integrations/shopify/sync/history?${params.toString()}`, {
      method: 'GET',
    });
  }

  async updateShopifySettings(settings: {
    autoSync?: boolean;
    syncInterval?: number;
    syncProducts?: boolean;
    syncOrders?: boolean;
    syncInventory?: boolean;
  }) {
    return this.request<{ message: string }>('/integrations/shopify/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  async getShopifyHealth() {
    return this.request<{
      database: { connected: boolean };
      shopify: {
        connected: boolean;
        shopDomain: string | null;
        lastSync: string | null;
        lastProductsSync: string | null;
        lastOrdersSync: string | null;
        productsCount: number;
        ordersCount: number;
        autoSync: boolean;
        syncInterval: number;
        webhooksRegistered: boolean;
      };
    }>('/integrations/shopify/health', {
      method: 'GET',
    });
  }

  async getStorifyHealth() {
    return this.request<{
      storify: {
        connected: boolean;
        storeDomain: string | null;
        apiBaseUrl: string | null;
        productsEndpoint: string | null;
        lastSync: string | null;
        lastProductsSync: string | null;
        productsCount: number;
      };
    }>('/integrations/storify/health', {
      method: 'GET',
    });
  }

  async getProductDetails(productId: string) {
    return this.request<{
      id: string;
      external_id: string;
      name: string;
      description: string;
      price: number;
      currency: string;
      category: string;
      stock: number;
      image_url: string;
      source: string;
      vendor: string;
      product_type: string;
      tags: string[];
      status: string;
      handle: string;
      total_inventory: number;
      has_variants: boolean;
      variants: Array<{
        id: string;
        external_id: string;
        sku: string;
        title: string;
        price: number;
        compare_at_price: number | null;
        inventory_quantity: number;
        option1: string | null;
        option2: string | null;
        option3: string | null;
      }>;
      images: Array<{
        id: string;
        src: string;
        alt: string | null;
        position: number;
        is_primary: boolean;
      }>;
      options: Array<{
        id: string;
        name: string;
        position: number;
        values: string[];
      }>;
    }>(`/integrations/shopify/products/${productId}`, {
      method: 'GET',
    });
  }

  async pushProductToShopify(productId: string) {
    return this.request<{
      shopifyId: string;
      handle: string;
      message: string;
    }>(`/integrations/shopify/products/${productId}/push`, {
      method: 'POST',
    });
  }

  async syncShopifyOrders() {
    return this.request<{
      jobId: string;
      synced: number;
      created: number;
      message: string;
    }>('/integrations/shopify/sync/orders', {
      method: 'POST',
    });
  }

  // Admin API Methods
  async getAdminStats() {
    return this.request<{
      totalUsers: number;
      activeUsersMonth: number;
      paidSubscriptions: number;
      totalAiResponses: number;
      estimatedMrr: number;
    }>('/admin/stats');
  }

  // Public endpoint - no authentication required
  async getPublicSubscriptionPlans() {
    return this.request<{
      plans: Array<{
        name: string;
        planKey: string;
        price: number;
        features: string[];
      }>;
    }>('/admin/subscriptions/public', {
      method: 'GET'
    }, false); // false = no authentication required
  }

  async getAdminSubscriptionPlans() {
    return this.request<{
      plans: Array<{
        name: string;
        planKey: string;
        price: number;
        users: number;
        features: string[];
        billingPeriod?: 'monthly' | 'yearly';
        description?: string;
      }>;
      trialCount: number;
    }>('/admin/subscriptions');
  }

  async updateAdminSubscriptionPlan(
    planKey: string,
    name: string,
    price: number,
    features: string[],
    limits?: any,
    billingPeriod?: 'monthly' | 'yearly',
    description?: string
  ) {
    return this.request<{
      success: boolean;
      message: string;
      data: any;
    }>(`/admin/subscriptions/${planKey}`, {
      method: 'PUT',
      body: JSON.stringify({ name, price, features, limits, billingPeriod, description })
    });
  }

  async getAdminPlanLimits() {
    return this.request<{
      success: boolean;
      data: {
        comments: any;
        single: any;
        social: any;
        yearly: any;
        trial: any;
        starter?: any;
        pro?: any;
        business?: any;
      };
    }>('/admin/subscriptions/limits');
  }

  async updateAdminPlanLimits(planKey: string, limits: any) {
    return this.request<{
      success: boolean;
      message: string;
      data: {
        planKey: string;
        limits: any;
      };
    }>(`/admin/subscriptions/${planKey}/limits`, {
      method: 'PUT',
      body: JSON.stringify(limits)
    });
  }

  async getAdminUsageStats() {
    return this.request<Array<{
      id: string;
      name: string;
      requests: number;
      cost: 'Low' | 'Medium' | 'High';
    }>>('/admin/usage');
  }

  async getAdminChartData() {
    return this.request<{
      newUsers: Array<{ name: string; users: number }>;
      aiUsage: Array<{ name: string; calls: number }>;
    }>('/admin/charts');
  }

  async getAdminAffiliateStats() {
    return this.request<{
      totalAffiliates: number;
      totalReferralSignups: number;
      totalCommissionsOwed: number;
      topAffiliates: Array<{
        id: string;
        name: string;
        email: string;
        clicks: number;
        signups: number;
        commission: number;
      }>;
    }>('/admin/affiliates');
  }

  async getAdminAcquisitionStats() {
    return this.request<{
      totals: {
        withAcquisition: number;
        paidConverted: number;
        trialActive: number;
        last7Days: number;
        last30Days: number;
      };
      bySource: Array<{ key: string; signups: number; paid: number }>;
      byCampaign: Array<{ key: string; signups: number; paid: number }>;
      recent: Array<{
        id: string;
        name: string | null;
        email: string;
        plan: string;
        status: string | null;
        source: string | null;
        campaign: string | null;
        adId: string | null;
        acqCode: string | null;
        createdAt: string;
      }>;
    }>('/admin/acquisition');
  }

  async getAffiliateStats() {
    return this.request<{
      referralCode: string;
      referralLink: string;
      totalVisits: number;
      totalSignups: number;
      activeConversions: number;
      totalEarnings: number;
      availableBalance: number;
      referrals: Array<{
        id: string;
        referrerId: string;
        newUserId: string;
        newUserEmail: string;
        date: Date;
        status: 'pending' | 'active' | 'expired';
        commissionAmount: number;
        plan: 'Starter' | 'Pro' | 'Business';
      }>;
    }>('/affiliate/stats');
  }

  async requestAffiliateWithdrawal(amount: number) {
    return this.request<{ message: string; data: { amount: number; status: string } }>('/affiliate/withdraw', {
      method: 'POST',
      body: JSON.stringify({ amount }),
    });
  }

  async trackAffiliateClick(refCode: string) {
    // This endpoint doesn't require authentication
    return this.request<{ success: boolean }>(`/affiliate/track-click?ref=${encodeURIComponent(refCode)}`, {
      method: 'GET'
    }, false);
  }

  async getAdminUsers() {
    return this.request<{
      id: string;
      email: string;
      name: string;
      phone?: string | null;
      registrationDate: Date;
      plan: 'Trial' | 'Starter' | 'Pro' | 'Business';
      status: 'active' | 'suspended' | 'expired';
      isTrial: boolean;
      trialEndsAt?: Date;
    }[]>('/admin/users');
  }

  async createAdminUser(data: {
    name: string;
    email: string;
    password: string;
    subscription_plan?: string;
    subscription_status?: string;
    isTrial?: boolean;
    trial_ends_at?: Date;
  }) {
    return this.request<{
      id: string;
      email: string;
      name: string;
      registrationDate: string;
      plan: 'Trial' | 'Starter' | 'Pro' | 'Business';
      status: 'active' | 'suspended' | 'expired';
      isTrial: boolean;
      trialEndsAt?: string;
    }>('/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        ...data,
        trial_ends_at: data.trial_ends_at ? data.trial_ends_at.toISOString() : undefined
      })
    });
  }

  async getAdminUser(id: string) {
    return this.request<{
      id: string;
      email: string;
      name: string;
      phone?: string | null;
      registrationDate: Date;
      plan: 'Trial' | 'Starter' | 'Pro' | 'Business';
      status: 'active' | 'suspended' | 'expired';
      isTrial: boolean;
      trialEndsAt?: Date;
    }>(`/admin/users/${id}`);
  }

  async updateAdminUser(id: string, data: {
    name?: string;
    email?: string;
    subscription_plan?: string;
    subscription_status?: string;
    trial_ends_at?: Date | null;
  }) {
    return this.request<{
      id: string;
      email: string;
      name: string;
      subscription_plan: string;
      subscription_status: string;
      trial_ends_at?: Date | null;
      created_at: Date;
    }>(`/admin/users/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteAdminUser(id: string) {
    return this.request<{ message: string }>(`/admin/users/${id}`, {
      method: 'DELETE',
    });
  }

  async getSystemLogs() {
    return this.request<Array<{
      id: string;
      time: Date;
      type: 'info' | 'warning' | 'error';
      source: string;
      message: string;
    }>>('/admin/logs');
  }

  async getGlobalSettings() {
    return this.request<{
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
    }>('/admin/settings');
  }

  async updateGlobalSettings(settings: {
    trialDays?: number;
    trialAiLimit?: number;
    defaultAiModel?: string;
    features?: {
      affiliateEnabled?: boolean;
      landingBotEnabled?: boolean;
      dashboardBotEnabled?: boolean;
      productsBotEnabled?: boolean;
      servicesBotEnabled?: boolean;
      officialPageBotEnabled?: boolean;
    };
    bots?: {
      productsBot?: {
        enabled?: boolean;
        systemMessage?: string;
      };
      servicesBot?: {
        enabled?: boolean;
        systemMessage?: string;
      };
      officialPageBot?: {
        enabled?: boolean;
        systemMessage?: string;
      };
    };
    paymentMethods?: {
      shamCash?: {
        enabled?: boolean;
        walletAddress?: string;
        qrImageUrl?: string;
        instructions?: string;
      };
      usdt?: {
        enabled?: boolean;
        walletAddress?: string;
        qrImageUrl?: string;
        network?: string;
        instructions?: string;
      };
    };
  }) {
    return this.request<{ message: string }>('/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  async getOfficialFacebookStatus() {
    return this.request<{
      linked: boolean;
      page: { pageId: string; pageName: string | null; linkedAt: string } | null;
      bot: { enabled: boolean; systemMessage: string };
    }>('/admin/facebook/official/status');
  }

  async connectOfficialFacebook(adminBasePath?: string) {
    return this.request<{
      authUrl?: string;
      message?: string;
      requiresSetup?: boolean;
    }>('/admin/facebook/official/connect', {
      method: 'POST',
      body: JSON.stringify({ adminBasePath: adminBasePath || undefined }),
    });
  }

  async getOfficialAvailableFacebookPages(sessionId: string) {
    return this.request<{
      pages: Array<{
        id: string;
        name: string;
        category: string | null;
        pictureUrl: string | null;
      }>;
    }>(`/admin/facebook/official/available-pages?session=${encodeURIComponent(sessionId)}`);
  }

  async linkOfficialFacebookPage(sessionId: string, pageId: string) {
    return this.request<{
      message: string;
      page: { pageId: string; pageName: string | null; linkedAt: string } | null;
    }>('/admin/facebook/official/link-page', {
      method: 'POST',
      body: JSON.stringify({ session: sessionId, pageId }),
    });
  }

  async disconnectOfficialFacebook() {
    return this.request<{ message: string; disconnected: boolean }>(
      '/admin/facebook/official/disconnect',
      { method: 'DELETE' }
    );
  }

  async getOfficialInboxConversations(params?: {
    status?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }) {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.search) qs.set('search', params.search);
    if (params?.limit != null) qs.set('limit', String(params.limit));
    if (params?.offset != null) qs.set('offset', String(params.offset));
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return this.request<{
      linked: boolean;
      page?: { pageId: string; pageName: string | null } | null;
      conversations: Array<{
        id: string;
        platform: string;
        userId?: string | null;
        userName?: string | null;
        lastMessageAt: string;
        createdAt: string;
        botDisabled: boolean;
        status: string;
        lastHumanResponseAt?: string | null;
        lastMessagePreview?: string | null;
        lastSenderType?: string | null;
        messageCount: number;
        unreadCount?: number;
      }>;
      total: number;
      limit: number;
      offset: number;
    }>(`/admin/facebook/official/conversations${query}`);
  }

  async getOfficialInboxConversation(id: string) {
    return this.request<{
      conversation: {
        id: string;
        platform: string;
        userId?: string | null;
        userName?: string | null;
        lastMessageAt: string;
        createdAt: string;
        botDisabled: boolean;
        status: string;
        lastHumanResponseAt?: string | null;
        messages: Array<{
          id: string;
          role: string;
          content: string;
          senderType?: string;
          source?: string | null;
          imageUrl?: string | null;
          metadata?: Record<string, unknown> | null;
          timestamp: string;
          createdAt: string;
        }>;
      };
    }>(`/admin/facebook/official/conversations/${id}`);
  }

  async sendOfficialInboxHumanMessage(
    conversationId: string,
    message: string,
    imageUrl?: string | null
  ) {
    return this.request<{
      conversationId: string;
      delivered: boolean;
      message: {
        id: string;
        role: string;
        content: string;
        senderType: string;
        createdAt: string;
        timestamp: string;
      };
      botDisabled: boolean;
      status: string;
    }>(`/admin/facebook/official/conversations/${conversationId}/send-human-message`, {
      method: 'POST',
      body: JSON.stringify({ message, imageUrl: imageUrl || undefined }),
    });
  }

  async disableOfficialInboxBot(conversationId: string) {
    return this.request<{ success?: boolean; message?: string }>(
      `/admin/facebook/official/conversations/${conversationId}/disable-bot`,
      { method: 'PUT' }
    );
  }

  async enableOfficialInboxBot(conversationId: string) {
    return this.request<{ success?: boolean; message?: string }>(
      `/admin/facebook/official/conversations/${conversationId}/enable-bot`,
      { method: 'PUT' }
    );
  }

  async markOfficialInboxRead(conversationId: string) {
    return this.request<{ ok: boolean }>(
      `/admin/facebook/official/conversations/${conversationId}/mark-read`,
      { method: 'POST', body: JSON.stringify({}) }
    );
  }

  async getOfficialInboxUnreadCount() {
    return this.request<{
      linked: boolean;
      unreadConversations: number;
      unreadMessages: number;
    }>('/admin/facebook/official/inbox/unread-count');
  }

  async syncOfficialPagePosts() {
    return this.request<{
      message: string;
      results: Array<{
        synced: number;
        platform: string;
        accountRef: string;
        pageName?: string | null;
      }>;
    }>('/admin/facebook/official/posts/sync', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  }

  async getOfficialPagePosts(params?: { limit?: number; offset?: number }) {
    const q = new URLSearchParams();
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.offset) q.set('offset', String(params.offset));
    const qs = q.toString();
    return this.request<{ posts: any[] }>(
      `/admin/facebook/official/posts${qs ? `?${qs}` : ''}`
    );
  }

  async updateOfficialPagePostCommentSettings(payload: {
    socialPostId: string;
    commentReplyEnabled?: boolean;
    publicReplyText?: string | null;
    sendDmOnComment?: boolean;
    privateReplyText?: string | null;
  }) {
    return this.request<{ message: string; post: any }>(
      '/admin/facebook/official/posts/comment-settings',
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    );
  }

  async getOfficialPageKeywordRules(socialPostId?: string) {
    const q = new URLSearchParams();
    if (socialPostId) q.set('socialPostId', socialPostId);
    const qs = q.toString();
    return this.request<{ rules: any[] }>(
      `/admin/facebook/official/keyword-rules${qs ? `?${qs}` : ''}`
    );
  }

  async createOfficialPageKeywordRule(payload: {
    socialPostId: string;
    keywords: string | string[];
    publicReplyText?: string;
    privateReplyText?: string;
    privateReplyEnabled?: boolean;
    priority?: number;
    matchType?: string;
  }) {
    return this.request<{ rule: any }>('/admin/facebook/official/keyword-rules', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async updateOfficialPageKeywordRule(
    ruleId: string,
    payload: {
      keywords?: string | string[];
      publicReplyText?: string;
      privateReplyText?: string;
      privateReplyEnabled?: boolean;
      priority?: number;
      matchType?: string;
      isActive?: boolean;
    }
  ) {
    return this.request<{ rule: any }>(`/admin/facebook/official/keyword-rules/${ruleId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  async deleteOfficialPageKeywordRule(ruleId: string) {
    return this.request<{ message: string }>(
      `/admin/facebook/official/keyword-rules/${ruleId}`,
      { method: 'DELETE' }
    );
  }

  async uploadPaymentProof(file: File): Promise<{
    file: {
      filename: string;
      originalName: string;
      mimetype: string;
      size: number;
      url: string;
      path: string;
    };
  }> {
    const formData = new FormData();
    formData.append('file', file);

    const url = `${this.baseURL}/upload/proof`;
    const headers: HeadersInit = {};

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include',
    });

    const text = await response.text();
    const data = JSON.parse(text);

    if (!response.ok) {
      throw new Error(data.error?.message || `HTTP error! status: ${response.status}`);
    }

    return data.data !== undefined ? data.data : data;
  }

  async getBillingPaymentMethods() {
    return this.request<{
      methods: Array<{
        id: string;
        name: string;
        type: string;
        walletAddress: string;
        qrImageUrl: string;
        network?: string;
        instructions?: string;
      }>;
    }>('/billing/payment-methods');
  }

  async submitSubscriptionPaymentRequest(planKey: string, proofUrl: string, method: string) {
    return this.request<{
      id: string;
      planKey: string;
      amount: number;
      method: string;
      status: string;
      createdAt: string;
    }>('/billing/payment-requests', {
      method: 'POST',
      body: JSON.stringify({ planKey, proofUrl, method }),
    });
  }

  async getAdminPaymentRequests(status?: 'pending' | 'approved' | 'rejected') {
    const query = status ? `?status=${status}` : '';
    return this.request<Array<{
      id: string;
      planKey: string;
      amount: number;
      method: string;
      proofUrl: string;
      status: string;
      adminNote: string | null;
      createdAt: string;
      reviewedAt: string | null;
      merchant: {
        id: string;
        name: string;
        email: string;
      };
    }>>(`/billing/admin/payment-requests${query}`);
  }

  async reviewPaymentRequest(id: string, action: 'approve' | 'reject', adminNote?: string) {
    return this.request<{ id: string; status: string }>(`/billing/admin/payment-requests/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ action, adminNote }),
    });
  }

  async openAdminPaymentProof(id: string): Promise<void> {
    const endpoint = `/billing/admin/payment-requests/${id}/proof`;
    const headers: Record<string, string> = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    const response = await fetch(`${this.baseURL}${endpoint}`, {
      headers,
      credentials: 'include',
    });
    if (!response.ok) {
      throw new Error('تعذر فتح إثبات الدفع');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async getAdminNotifications(unreadOnly?: boolean) {
    const query = unreadOnly ? '?unreadOnly=true' : '';
    return this.request<Array<{
      id: string;
      type: string;
      title: string;
      message: string;
      data: any;
      isRead: boolean;
      createdAt: Date;
      readAt: Date | null;
    }>>(`/admin/notifications${query}`);
  }

  async markNotificationAsRead(id: string) {
    return this.request<{ success: boolean; message: string }>(`/admin/notifications/${id}/read`, {
      method: 'PUT',
    });
  }

  async markAllNotificationsAsRead() {
    return this.request<{ success: boolean; message: string }>('/admin/notifications/read-all', {
      method: 'PUT',
    });
  }

  async getEmailRecipientCount(recipientType: 'all' | 'active' | 'trial' | 'paid') {
    return this.request<number>(`/admin/email/recipient-count?type=${recipientType}`);
  }

  async searchEmailRecipients(query: string, limit = 20) {
    const q = encodeURIComponent(query.trim());
    return this.request<{ email: string; name: string | null }[]>(
      `/admin/email/search?q=${q}&limit=${limit}`
    );
  }

  async sendEmailBroadcast(data: {
    subject: string;
    message: string;
    recipientType: 'all' | 'active' | 'trial' | 'paid' | 'custom';
    customEmails?: string[];
    isHtml?: boolean;
  }) {
    return this.request<{
      success: boolean;
      data: {
        sent: number;
        failed: number;
        errors: string[];
      };
    }>('/admin/email/broadcast', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getNotificationRecipientCount(recipientType: 'all' | 'active' | 'trial' | 'paid') {
    return this.request<number>(`/admin/notifications/recipient-count?type=${recipientType}`);
  }

  async sendUserNotification(data: {
    title: string;
    message: string;
    type: 'info' | 'success' | 'warning' | 'error';
    recipientType: 'all' | 'active' | 'trial' | 'paid' | 'custom';
    customUserIds?: string[];
    data?: any;
  }) {
    return this.request<{
      success: boolean;
      data: {
        sent: number;
        failed: number;
        errors: string[];
      };
    }>('/admin/notifications/send', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getUserNotifications(unreadOnly?: boolean) {
    const query = unreadOnly ? '?unreadOnly=true' : '';
    return this.request<Array<{
      id: string;
      type: string;
      title: string;
      message: string;
      data: any;
      isRead: boolean;
      createdAt: Date;
      readAt: Date | null;
    }>>(`/notifications${query}`);
  }

  async markUserNotificationAsRead(id: string) {
    return this.request<{ success: boolean; message: string }>(`/notifications/${id}/read`, {
      method: 'PUT',
    });
  }

  async markAllUserNotificationsAsRead() {
    return this.request<{ success: boolean; message: string }>('/notifications/read-all', {
      method: 'PUT',
    });
  }

  async deleteUserNotification(id: string) {
    return this.request<{ success: boolean; message: string }>(`/notifications/${id}`, {
      method: 'DELETE',
    });
  }

  // Web Push (PWA)
  async getPushVapidPublicKey() {
    return this.request<{ publicKey: string }>('/notifications/push/vapid-public-key');
  }

  async getPushStatus() {
    return this.request<{ subscribed: boolean; configured: boolean }>('/notifications/push/status');
  }

  async subscribePush(subscription: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    expirationTime?: number | null;
  }) {
    return this.request<{ subscribed: boolean }>('/notifications/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({
        subscription,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      }),
    });
  }

  async unsubscribePush(endpoint: string) {
    return this.request<{ removed: boolean }>('/notifications/push/unsubscribe', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint }),
    });
  }

  async sendTestPush() {
    return this.request<{ sent: number; failed: number }>('/notifications/push/test', {
      method: 'POST',
    });
  }

  // Super Admin Web Push
  async getAdminPushVapidPublicKey() {
    return this.request<{ publicKey: string }>('/admin/notifications/push/vapid-public-key');
  }

  async getAdminPushStatus() {
    return this.request<{ subscribed: boolean; configured: boolean }>(
      '/admin/notifications/push/status'
    );
  }

  async subscribeAdminPush(subscription: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    expirationTime?: number | null;
  }) {
    return this.request<{ subscribed: boolean }>('/admin/notifications/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({
        subscription,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      }),
    });
  }

  async unsubscribeAdminPush(endpoint: string) {
    return this.request<{ removed: boolean }>('/admin/notifications/push/unsubscribe', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint }),
    });
  }

  async sendAdminTestPush() {
    return this.request<{ sent: number; failed: number }>('/admin/notifications/push/test', {
      method: 'POST',
    });
  }

  // CRM Methods
  async getCrmStats() {
    return this.request<{
      totalCustomers: number;
      activeCustomers: number;
      vipCustomers: number;
      newCustomersThisMonth: number;
      totalRevenue: number;
      averageOrderValue: number;
    }>('/crm/stats');
  }

  async getCustomers(params?: {
    search?: string;
    customerType?: 'regular' | 'vip' | 'wholesale' | 'new';
    status?: 'active' | 'inactive' | 'blocked';
    tags?: string[];
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const queryParams = new URLSearchParams();
    if (params?.search) queryParams.append('search', params.search);
    if (params?.customerType) queryParams.append('customerType', params.customerType);
    if (params?.status) queryParams.append('status', params.status);
    if (params?.tags && params.tags.length > 0) {
      params.tags.forEach(tag => queryParams.append('tags', tag));
    }
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.sortBy) queryParams.append('sortBy', params.sortBy);
    if (params?.sortOrder) queryParams.append('sortOrder', params.sortOrder);

    const query = queryParams.toString();
    return this.request<{
      customers: Array<{
        id: string;
        name: string;
        email?: string;
        phone?: string;
        address?: string;
        city?: string;
        country?: string;
        customerType: 'regular' | 'vip' | 'wholesale' | 'new';
        status: 'active' | 'inactive' | 'blocked';
        totalOrders: number;
        totalSpent: number;
        lastOrderDate?: Date;
        lastInteractionDate?: Date;
        notes?: string;
        tags?: string[];
        metadata?: Record<string, any>;
        createdAt: Date;
        updatedAt: Date;
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
      };
    }>(`/crm${query ? `?${query}` : ''}`);
  }

  async getCustomer(id: string) {
    return this.request<{
      customer: {
        id: string;
        name: string;
        email?: string;
        phone?: string;
        address?: string;
        city?: string;
        country?: string;
        customerType: 'regular' | 'vip' | 'wholesale' | 'new';
        status: 'active' | 'inactive' | 'blocked';
        totalOrders: number;
        totalSpent: number;
        lastOrderDate?: Date;
        lastInteractionDate?: Date;
        notes?: string;
        tags?: string[];
        metadata?: Record<string, any>;
        createdAt: Date;
        updatedAt: Date;
      };
      orders: Array<{
        id: string;
        total: number;
        currency: string;
        status: string;
        created_at: Date;
      }>;
      interactions: Array<{
        id: string;
        interactionType: string;
        title?: string;
        description?: string;
        platform?: string;
        relatedOrderId?: string;
        relatedConversationId?: string;
        createdAt: Date;
      }>;
      conversations: Array<any>;
    }>(`/crm/${id}`);
  }

  async createCustomer(data: {
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    country?: string;
    customerType?: 'regular' | 'vip' | 'wholesale' | 'new';
    status?: 'active' | 'inactive' | 'blocked';
    notes?: string;
    tags?: string[];
    metadata?: Record<string, any>;
  }) {
    return this.request<{
      id: string;
      name: string;
      email?: string;
      phone?: string;
      address?: string;
      city?: string;
      country?: string;
      customerType: 'regular' | 'vip' | 'wholesale' | 'new';
      status: 'active' | 'inactive' | 'blocked';
      totalOrders: number;
      totalSpent: number;
      lastOrderDate?: Date;
      lastInteractionDate?: Date;
      notes?: string;
      tags?: string[];
      metadata?: Record<string, any>;
      createdAt: Date;
      updatedAt: Date;
    }>('/crm', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async updateCustomer(id: string, data: {
    name?: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    country?: string;
    customerType?: 'regular' | 'vip' | 'wholesale' | 'new';
    status?: 'active' | 'inactive' | 'blocked';
    notes?: string;
    tags?: string[];
    metadata?: Record<string, any>;
  }) {
    return this.request<{
      id: string;
      name: string;
      email?: string;
      phone?: string;
      address?: string;
      city?: string;
      country?: string;
      customerType: 'regular' | 'vip' | 'wholesale' | 'new';
      status: 'active' | 'inactive' | 'blocked';
      totalOrders: number;
      totalSpent: number;
      lastOrderDate?: Date;
      lastInteractionDate?: Date;
      notes?: string;
      tags?: string[];
      metadata?: Record<string, any>;
      createdAt: Date;
      updatedAt: Date;
    }>(`/crm/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }

  async deleteCustomer(id: string) {
    return this.request<{ success: boolean; message: string }>(`/crm/${id}`, {
      method: 'DELETE'
    });
  }

  async createCustomerInteraction(data: {
    customerId: string;
    interactionType: 'message' | 'call' | 'email' | 'order' | 'complaint' | 'review' | 'note';
    title?: string;
    description?: string;
    platform?: string;
    relatedOrderId?: string;
    relatedConversationId?: string;
  }) {
    return this.request<{
      id: string;
      customerId: string;
      interactionType: string;
      title?: string;
      description?: string;
      platform?: string;
      relatedOrderId?: string;
      relatedConversationId?: string;
      createdAt: Date;
    }>('/crm/interactions', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  // Analytics Methods
  async getAnalyticsDashboard(period: '7days' | '30days' | '90days' | 'year' = '30days') {
    return this.request<{
      period: string;
      sales: {
        totalOrders: number;
        totalRevenue: number;
        avgOrderValue: number;
        uniqueCustomers: number;
      };
      ordersOverTime: Array<{
        date: string;
        count: number;
        revenue: number;
      }>;
      topProducts: Array<{
        name: string;
        orderCount: number;
        totalQuantity: number;
        revenue: number;
      }>;
      conversations: {
        totalConversations: number;
        totalMessages: number;
        userMessages: number;
        botResponses: number;
        conversionRate: number;
      };
      customerGrowth: Array<{
        date: string;
        count: number;
      }>;
      platformDistribution: Array<{
        platform: string;
        count: number;
      }>;
      commonQuestions: Array<{
        question: string;
        frequency: number;
      }>;
    }>(`/analytics/dashboard?period=${period}`);
  }

  async getSalesAnalytics(period: '7days' | '30days' | '90days' | 'year' = '30days', groupBy: 'day' | 'week' | 'month' = 'day') {
    return this.request<{
      salesOverTime: Array<{
        period: string;
        orderCount: number;
        revenue: number;
        avgOrderValue: number;
      }>;
      statusBreakdown: Array<{
        status: string;
        count: number;
        revenue: number;
      }>;
      categoryRevenue: Array<{
        category: string;
        orderCount: number;
        revenue: number;
      }>;
    }>(`/analytics/sales?period=${period}&groupBy=${groupBy}`);
  }

  async getConversationAnalytics(period: '7days' | '30days' | '90days' | 'year' = '30days') {
    return this.request<{
      conversationsOverTime: Array<{
        date: string;
        count: number;
      }>;
      avgResponseTime: number;
      peakHours: Array<{
        hour: number;
        count: number;
      }>;
    }>(`/analytics/conversations?period=${period}`);
  }

  async getProductAnalytics(period: '7days' | '30days' | '90days' | 'year' = '30days') {
    return this.request<{
      topProducts: Array<{
        id: string;
        name: string;
        category: string;
        orderCount: number;
        totalQuantitySold: number;
        revenue: number;
        stock: number;
        avgQuantityPerOrder: number;
      }>;
      lowStockProducts: Array<{
        id: string;
        name: string;
        stock: number;
        category: string;
      }>;
    }>(`/analytics/products?period=${period}`);
  }

  // WhatsApp Methods
  async getWhatsAppStatus() {
    return this.request<{
      isConnected: boolean;
      phoneNumber?: string;
      phoneNumberId?: string;
      businessAccountId?: string;
      autoReplyEnabled?: boolean;
      welcomeMessage?: string;
      lastSync?: Date;
    }>('/whatsapp/status');
  }

  async connectWhatsApp(data: {
    phoneNumberId: string;
    phoneNumber: string;
    businessAccountId?: string;
    accessToken: string;
    appId?: string;
    appSecret?: string;
    webhookVerifyToken?: string;
  }) {
    return this.request<{
      success: boolean;
      message: string;
      data: {
        phoneNumberId: string;
        phoneNumber: string;
        isVerified: boolean;
      };
    }>('/whatsapp/connect', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async startWhatsAppWebPairing() {
    return this.request<{
      status: string;
      phoneNumber?: string | null;
      alreadyConnected?: boolean;
    }>('/whatsapp/web/pair', { method: 'POST' });
  }

  async disconnectWhatsApp() {
    return this.request<{ success: boolean; message: string }>('/whatsapp/disconnect', {
      method: 'DELETE'
    });
  }

  async updateWhatsAppSettings(data: {
    autoReplyEnabled?: boolean;
    welcomeMessage?: string;
  }) {
    return this.request<{ success: boolean; message: string }>('/whatsapp/settings', {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }

  // Pages Management API
  async getPages() {
    return this.request<Array<{
      id: string;
      slug: string;
      title: string;
      meta_description?: string;
      is_published: boolean;
      created_at: string;
      updated_at: string;
    }>>('/pages/admin');
  }

  async getPage(id: string) {
    return this.request<{
      id: string;
      slug: string;
      title: string;
      content: string;
      meta_description?: string;
      is_published: boolean;
      created_at: string;
      updated_at: string;
    }>(`/pages/admin/${id}`);
  }

  async getPageBySlug(slug: string) {
    return this.request<{
      id: string;
      slug: string;
      title: string;
      content: string;
      meta_description?: string;
      is_published: boolean;
      updated_at: string;
    }>(`/pages/public/${encodeURIComponent(slug)}`, { cache: 'no-store' }, false);
  }

  /** Published CMS pages for marketing footer (public, no auth). */
  async getPublishedPagesForFooter() {
    return this.request<Array<{ slug: string; title: string }>>(
      '/pages/published',
      { cache: 'no-store' },
      false
    );
  }

  async createPage(data: {
    slug: string;
    title: string;
    content: string;
    meta_description?: string;
    is_published?: boolean;
  }) {
    return this.request<{
      id: string;
      slug: string;
      title: string;
      content: string;
      meta_description?: string;
      is_published: boolean;
      created_at: string;
      updated_at: string;
    }>('/pages/admin', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async updatePage(id: string, data: {
    slug?: string;
    title?: string;
    content?: string;
    meta_description?: string;
    is_published?: boolean;
  }) {
    return this.request<{
      id: string;
      slug: string;
      title: string;
      content: string;
      meta_description?: string;
      is_published: boolean;
      updated_at: string;
    }>(`/pages/admin/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }

  async deletePage(id: string) {
    return this.request<{ message: string }>(`/pages/admin/${id}`, {
      method: 'DELETE'
    });
  }

  // Support Tickets API
  async createSupportTicket(data: {
    subject: string;
    message: string;
    priority?: 'low' | 'medium' | 'high' | 'urgent';
  }) {
    return this.request<{
      ticket: {
        id: string;
        subject: string;
        message: string;
        status: string;
        priority: string;
        createdAt: string;
      };
    }>('/support', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async getMySupportTickets() {
    return this.request<{
      tickets: Array<{
        id: string;
        subject: string;
        message: string;
        status: string;
        priority: string;
        adminResponse?: string;
        resolvedAt?: string;
        createdAt: string;
        updatedAt: string;
        replies?: Array<{
          id: string;
          message: string;
          senderType: 'user' | 'admin';
          senderId: string;
          senderName?: string;
          senderEmail?: string;
          createdAt: string;
        }>;
      }>;
    }>('/support/my-tickets');
  }

  async getSupportTicket(id: string) {
    return this.request<{
      ticket: {
        id: string;
        subject: string;
        message: string;
        status: string;
        priority: string;
        adminResponse?: string;
        resolvedAt?: string;
        createdAt: string;
        updatedAt: string;
        merchant: {
          id: string;
          email: string;
          name?: string;
        };
        admin?: {
          id: string;
          name?: string;
        } | null;
        replies?: Array<{
          id: string;
          message: string;
          senderType: 'user' | 'admin';
          senderId: string;
          senderName?: string;
          senderEmail?: string;
          createdAt: string;
        }>;
      };
    }>(`/support/${id}`);
  }

  // Admin Support Tickets API
  async getAllSupportTickets(params?: {
    status?: string;
    priority?: string;
    page?: number;
    limit?: number;
  }) {
    const queryParams = new URLSearchParams();
    if (params?.status) queryParams.append('status', params.status);
    if (params?.priority) queryParams.append('priority', params.priority);
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());

    const query = queryParams.toString();
    return this.request<{
      tickets: Array<{
        id: string;
        subject: string;
        message: string;
        status: string;
        priority: string;
        adminResponse?: string;
        resolvedAt?: string;
        createdAt: string;
        updatedAt: string;
        merchant: {
          id: string;
          email: string;
          name?: string;
        };
        admin?: {
          id: string;
          name?: string;
        } | null;
        replies?: Array<{
          id: string;
          message: string;
          senderType: 'user' | 'admin';
          senderId: string;
          senderName?: string;
          senderEmail?: string;
          createdAt: string;
        }>;
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
      };
    }>(`/support/admin/all${query ? `?${query}` : ''}`);
  }

  async getSupportTicketsStats() {
    return this.request<{
      stats: {
        open: number;
        inProgress: number;
        resolved: number;
        closed: number;
        urgent: number;
        high: number;
        total: number;
        last24h: number;
      };
    }>('/support/admin/stats');
  }

  async updateSupportTicket(id: string, data: {
    status?: 'open' | 'in_progress' | 'resolved' | 'closed';
    adminResponse?: string;
    priority?: 'low' | 'medium' | 'high' | 'urgent';
  }) {
    return this.request<{
      ticket: {
        id: string;
        subject: string;
        message: string;
        status: string;
        priority: string;
        adminResponse?: string;
        resolvedAt?: string;
        createdAt: string;
        updatedAt: string;
      };
    }>(`/support/admin/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }

  // User reply to support ticket
  async replyToSupportTicket(ticketId: string, message: string, attachments?: Array<{ url: string; filename: string; mimetype: string; size: number }>) {
    return this.request<{
      reply: {
        id: string;
        ticketId: string;
        message: string;
        senderType: string;
        attachments?: Array<{ url: string; filename: string; mimetype: string; size: number }>;
        createdAt: string;
      };
    }>(`/support/${ticketId}/reply`, {
      method: 'POST',
      body: JSON.stringify({ message, attachments: attachments || [] })
    });
  }
}

// Export singleton instance
export const apiService = new ApiService(API_BASE_URL);
export default apiService;


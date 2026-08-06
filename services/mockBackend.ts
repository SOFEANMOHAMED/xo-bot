
import { Product, Order, IntegrationStatus, IntegrationLog, AffiliateStats, Referral } from '../types';

/**
 * This service mimics the backend logic for OAuth and Data Syncing.
 * In a real app, these would be REST API calls to your Node.js/Python server.
 */

// Mock Shopify Products
const SHOPIFY_MOCK_PRODUCTS: Product[] = [
  {
    id: 'shopify_1',
    externalId: 'sp_8821',
    name: 'توب رياضي بريميوم',
    price: 45,
    currency: 'USD',
    category: 'ملابس رياضية',
    stock: 50,
    description: 'توب رياضي عالي الجودة مستورد من شوبيفاي',
    sizes: ['S', 'M', 'L'],
    imageUrl: 'https://picsum.photos/200/200?random=10',
    source: 'shopify'
  },
  {
    id: 'shopify_2',
    externalId: 'sp_8822',
    name: 'بنطال يوجا مريح',
    price: 35,
    currency: 'USD',
    category: 'ملابس رياضية',
    stock: 25,
    description: 'بنطال يوجا قطني مريح جداً',
    sizes: ['XS', 'S', 'M', 'L', 'XL'],
    imageUrl: 'https://picsum.photos/200/200?random=11',
    source: 'shopify'
  }
];

// Mock Shopify Orders
const SHOPIFY_MOCK_ORDERS: Order[] = [
  {
    id: 'ord_1',
    externalId: '#1024',
    customerName: 'أحمد محمد',
    customerEmail: 'ahmed@example.com',
    total: 125.00,
    currency: 'USD',
    status: 'paid',
    date: new Date(Date.now() - 1000 * 60 * 60 * 2), // 2 hours ago
    source: 'shopify',
    items: [
      { productId: 'shopify_1', productName: 'توب رياضي بريميوم', quantity: 1, price: 45, currency: 'USD' },
      { productId: 'shopify_2', productName: 'بنطال يوجا مريح', quantity: 2, price: 35, currency: 'USD' }
    ]
  },
  {
    id: 'ord_2',
    externalId: '#1023',
    customerName: 'سارة علي',
    customerEmail: 'sara@example.com',
    total: 45.00,
    currency: 'USD',
    status: 'fulfilled',
    date: new Date(Date.now() - 1000 * 60 * 60 * 24), // 1 day ago
    source: 'shopify',
    items: [
      { productId: 'shopify_1', productName: 'توب رياضي بريميوم', quantity: 1, price: 45, currency: 'USD' }
    ]
  },
  {
    id: 'ord_3',
    externalId: '#1022',
    customerName: 'خالد عمر',
    customerEmail: 'khaled@example.com',
    total: 35.00,
    currency: 'USD',
    status: 'pending',
    date: new Date(Date.now() - 1000 * 60 * 60 * 25), // 1 day and 1 hour ago
    source: 'shopify',
    items: [
      { productId: 'shopify_2', productName: 'بنطال يوجا مريح', quantity: 1, price: 35, currency: 'USD' }
    ]
  }
];

export const mockConnectFacebook = (): Promise<IntegrationStatus> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        isConnected: true,
        accountName: 'متجر الأناقة الرسمي',
        platformId: 'fb_page_123456',
        lastSync: new Date()
      });
    }, 1500);
  });
};

export const mockConnectShopify = (storeUrl: string): Promise<IntegrationStatus> => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (storeUrl.includes('myshopify.com')) {
        resolve({
          isConnected: true,
          accountName: storeUrl.split('.')[0],
          platformId: 'sh_store_987654',
          lastSync: new Date()
        });
      } else {
        reject(new Error("رابط المتجر غير صحيح. يجب أن ينتهي بـ myshopify.com"));
      }
    }, 1500);
  });
};

export const mockConnectTelegram = (token: string): Promise<IntegrationStatus> => {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      // Mock validation: Simple check for standard bot token format (digits:chars)
      if (token.length > 5 && token.includes(':')) {
        resolve({
          isConnected: true,
          accountName: 'AlMusaid_Bot',
          platformId: token.split(':')[0],
          lastSync: new Date()
        });
      } else {
        reject(new Error("رمز البوت غير صالح. تأكد من نسخه بشكل صحيح من BotFather."));
      }
    }, 1500);
  });
};

export const mockSyncShopifyProducts = (): Promise<Product[]> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(SHOPIFY_MOCK_PRODUCTS);
    }, 2000);
  });
};

export const mockSyncShopifyOrders = (): Promise<Order[]> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(SHOPIFY_MOCK_ORDERS);
    }, 2000);
  });
};

export const generateLog = (platform: 'Facebook' | 'Shopify' | 'Telegram', action: string, status: 'success' | 'error' | 'info'): IntegrationLog => {
  return {
    id: Math.random().toString(36).substring(2, 11),
    platform: platform as any, // Cast to match type if needed or update type
    action,
    details: status === 'success' ? 'تمت العملية بنجاح' : 'فشل الاتصال',
    timestamp: new Date(),
    status
  };
};

// --- Affiliate Mock Data ---

export const mockGetAffiliateStats = (storeName: string): Promise<AffiliateStats> => {
  const code = storeName.split(' ')[0] + Math.floor(Math.random() * 1000);
  
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        referralCode: code,
        referralLink: `https://xo-bot.com/ref/${code}`,
        totalVisits: 245,
        totalSignups: 12,
        activeConversions: 4,
        totalEarnings: 156.00,
        availableBalance: 85.50,
        referrals: [
          {
            id: 'ref_1',
            referrerId: 'me',
            newUserId: 'u_99',
            newUserEmail: 'm.ahmed@...',
            date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2), // 2 days ago
            status: 'active',
            commissionAmount: 23.70,
            plan: 'Pro'
          },
          {
            id: 'ref_2',
            referrerId: 'me',
            newUserId: 'u_100',
            newUserEmail: 'contact@sto...',
            date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 5), // 5 days ago
            status: 'pending',
            commissionAmount: 8.70,
            plan: 'Starter'
          },
          {
            id: 'ref_3',
            referrerId: 'me',
            newUserId: 'u_101',
            newUserEmail: 'info@fash...',
            date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 12), // 12 days ago
            status: 'active',
            commissionAmount: 23.70,
            plan: 'Pro'
          },
           {
            id: 'ref_4',
            referrerId: 'me',
            newUserId: 'u_102',
            newUserEmail: 'sales@tech...',
            date: new Date(Date.now() - 1000 * 60 * 60 * 24 * 15), 
            status: 'expired',
            commissionAmount: 0,
            plan: 'Starter'
          }
        ]
      });
    }, 1000);
  });
};

export const mockRequestWithdrawal = (amount: number): Promise<boolean> => {
  return new Promise((resolve) => {
     setTimeout(() => resolve(true), 1500);
  });
}
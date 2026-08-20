
import { AdminStats, AdminUser, SystemLog, AdminGlobalSettings } from '../types';

export const getAdminOverviewStats = (): Promise<AdminStats> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        totalUsers: 1245,
        activeUsersMonth: 850,
        paidSubscriptions: 320,
        totalAiResponses: 45200,
        estimatedMrr: 15600 // USD
      });
    }, 800);
  });
};

export const getAdminUsers = (): Promise<AdminUser[]> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      // Mock Users
      const users: AdminUser[] = [
        { id: 'u1', name: 'أحمد محمد', email: 'ahmed@store.com', registrationDate: new Date('2024-01-15'), plan: 'Pro', status: 'active', isTrial: false },
        { id: 'u2', name: 'سارة علي', email: 'sara@boutique.com', registrationDate: new Date('2024-02-10'), plan: 'Starter', status: 'active', isTrial: false },
        { id: 'u3', name: 'خالد عمر', email: 'khaled@tech.com', registrationDate: new Date('2024-03-05'), plan: 'Business', status: 'active', isTrial: false },
        { id: 'u4', name: 'متجر الأناقة', email: 'info@elegance.com', registrationDate: new Date('2024-03-20'), plan: 'Trial', status: 'active', isTrial: true, trialEndsAt: new Date(Date.now() + 86400000 * 2) }, // 2 days left
        { id: 'u5', name: 'عبدالله يوسف', email: 'abdullah@shop.com', registrationDate: new Date('2024-03-22'), plan: 'Trial', status: 'active', isTrial: true, trialEndsAt: new Date(Date.now() - 86400000) }, // Expired yesterday
        { id: 'u6', name: 'نورة السعيد', email: 'noura@beauty.com', registrationDate: new Date('2023-12-01'), plan: 'Starter', status: 'suspended', isTrial: false },
      ];
      resolve(users);
    }, 1000);
  });
};

export const getSystemLogs = (): Promise<SystemLog[]> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve([
        { id: 'l1', time: new Date(), type: 'info', source: 'Auth', message: 'User u1 logged in' },
        { id: 'l2', time: new Date(Date.now() - 1000 * 60 * 5), type: 'error', source: 'Shopify Sync', message: 'API Rate limit exceeded for store #442' },
        { id: 'l3', time: new Date(Date.now() - 1000 * 60 * 15), type: 'warning', source: 'AI Engine', message: 'High latency detected in Gemini API (2.5s)' },
        { id: 'l4', time: new Date(Date.now() - 1000 * 60 * 30), type: 'info', source: 'Billing', message: 'Subscription renewed for u3' },
        { id: 'l5', time: new Date(Date.now() - 1000 * 60 * 60), type: 'error', source: 'Facebook Webhook', message: 'Signature validation failed' },
      ]);
    }, 600);
  });
};

export const getGlobalSettings = (): Promise<AdminGlobalSettings> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        trialDays: 7,
        trialAiLimit: 200,
        defaultAiModel: 'Gemini 2.5 Flash',
        features: {
          affiliateEnabled: true,
          landingBotEnabled: true,
          dashboardBotEnabled: true,
          productsBotEnabled: true,
          servicesBotEnabled: true,
          officialPageBotEnabled: false,
        },
        bots: {
          productsBot: { enabled: true, systemMessage: '' },
          servicesBot: { enabled: true, systemMessage: '' },
          officialPageBot: { enabled: false, systemMessage: '' },
        },
      });
    }, 500);
  });
};

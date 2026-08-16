import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.js';
import { createError } from './errorHandler.js';
import {
  getMerchantPlanLimits,
  getProductCount,
  getMonthlyAIResponseCount,
  getMarketingImageCount,
  getFacebookPagesCount,
  getInstagramAccountsCount,
  getWhatsAppAccountsCount,
  getShopifyStoresCount,
  getTelegramBotsCount,
  getCustomersCount,
  getTotalChannelsCount,
  isWithinLimit
} from '../utils/planLimits.js';

export const checkProductLimit = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const limits = await getMerchantPlanLimits(merchantId);
    const currentCount = await getProductCount(merchantId);

    if (!isWithinLimit(currentCount, limits.maxProducts)) {
      return next(createError(
        `لقد وصلت إلى الحد الأقصى للمنتجات (${limits.maxProducts}). يرجى ترقية خطتك لإضافة المزيد من المنتجات.`,
        403
      ));
    }

    next();
  } catch (error) {
    next(error);
  }
};

export const checkAIResponseLimit = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const limits = await getMerchantPlanLimits(merchantId);
    const currentCount = await getMonthlyAIResponseCount(merchantId);

    if (!isWithinLimit(currentCount, limits.maxMonthlyAIResponses)) {
      return next(createError(
        `لقد وصلت إلى الحد الأقصى للردود الذكية لهذا الشهر (${limits.maxMonthlyAIResponses}). يرجى ترقية خطتك أو الانتظار حتى الشهر القادم.`,
        403
      ));
    }

    next();
  } catch (error) {
    next(error);
  }
};

export const checkMarketingImageLimit = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const limits = await getMerchantPlanLimits(merchantId);

    if (limits.maxMonthlyMarketingImages === 0) {
      return next(createError(
        'ستوديو التصميم بالذكاء الاصطناعي غير متاح في باقتك الحالية. يرجى ترقية الباقة.',
        403,
        true,
        'MARKETING_IMAGES_NOT_INCLUDED'
      ));
    }

    const currentCount = await getMarketingImageCount(merchantId, limits.billingPeriod);

    if (!isWithinLimit(currentCount, limits.maxMonthlyMarketingImages)) {
      const periodLabel = limits.billingPeriod === 'yearly' ? 'لهذا العام' : 'لهذا الشهر';
      return next(createError(
        `لقد وصلت إلى الحد الأقصى لتوليد الصور بالذكاء الاصطناعي ${periodLabel} (${limits.maxMonthlyMarketingImages}). يرجى ترقية باقتك أو الانتظار حتى الفترة القادمة.`,
        403,
        true,
        'MARKETING_IMAGES_LIMIT'
      ));
    }

    next();
  } catch (error) {
    next(error);
  }
};

async function assertChannelSlotAvailable(
  merchantId: string,
  channel: 'facebook' | 'instagram' | 'telegram'
) {
  const limits = await getMerchantPlanLimits(merchantId);

  if (channel === 'facebook') {
    const currentCount = await getFacebookPagesCount(merchantId);
    if (!isWithinLimit(currentCount, limits.maxFacebookPages)) {
      const limit = limits.maxFacebookPages;
      const limitPhrase = limit === 1 ? 'صفحة فيسبوك واحدة' : `حتى ${limit} صفحات فيسبوك`;
      throw createError(
        `باقتك الحالية تسمح بربط ${limitPhrase} فقط، وقد وصلت لهذا الحد.`,
        403,
        true,
        'FACEBOOK_PAGES_LIMIT'
      );
    }
  }

  if (channel === 'instagram') {
    const currentCount = await getInstagramAccountsCount(merchantId);
    if (!isWithinLimit(currentCount, limits.maxInstagramAccounts)) {
      const limit = limits.maxInstagramAccounts;
      const limitPhrase = limit === 1 ? 'حساب إنستغرام واحد' : `حتى ${limit} حسابات إنستغرام`;
      throw createError(
        `باقتك الحالية تسمح بربط ${limitPhrase} فقط، وقد وصلت لهذا الحد.`,
        403,
        true,
        'INSTAGRAM_ACCOUNTS_LIMIT'
      );
    }
  }

  if (channel === 'telegram') {
    const currentCount = await getTelegramBotsCount(merchantId);
    if (!isWithinLimit(currentCount, limits.maxTelegramBots)) {
      const limitText = limits.maxTelegramBots === -1 ? 'غير محدود' : limits.maxTelegramBots.toString();
      throw createError(
        `لقد وصلت إلى الحد الأقصى لبوتات Telegram (${limitText}). يرجى ترقية خطتك.`,
        403,
        true,
        'TELEGRAM_BOTS_LIMIT'
      );
    }
  }

  if (limits.maxTotalChannels !== -1) {
    const total = await getTotalChannelsCount(merchantId);
    if (!isWithinLimit(total, limits.maxTotalChannels)) {
      throw createError(
        `باقتك تسمح بربط قناة واحدة فقط (فيسبوك أو إنستغرام أو تيليجرام). افصل القناة الحالية أولاً أو رقِّ الباقة.`,
        403,
        true,
        'TOTAL_CHANNELS_LIMIT'
      );
    }
  }
}

export const checkFacebookPagesLimit = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }
    await assertChannelSlotAvailable(merchantId, 'facebook');
    next();
  } catch (error) {
    next(error);
  }
};

export const checkInstagramAccountsLimit = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }
    await assertChannelSlotAvailable(merchantId, 'instagram');
    next();
  } catch (error) {
    next(error);
  }
};

export const checkWhatsAppAccountsLimit = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const limits = await getMerchantPlanLimits(merchantId);
    const currentCount = await getWhatsAppAccountsCount(merchantId);

    if (!isWithinLimit(currentCount, limits.maxWhatsAppAccounts)) {
      const limitText = limits.maxWhatsAppAccounts === -1 ? 'غير محدود' : limits.maxWhatsAppAccounts.toString();
      return next(createError(
        `لقد وصلت إلى الحد الأقصى لحسابات WhatsApp (${limitText}). يرجى ترقية خطتك لإضافة المزيد من الحسابات.`,
        403
      ));
    }

    next();
  } catch (error) {
    next(error);
  }
};

export const checkShopifyStoresLimit = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const limits = await getMerchantPlanLimits(merchantId);
    const currentCount = await getShopifyStoresCount(merchantId);

    if (!isWithinLimit(currentCount, limits.maxShopifyStores)) {
      const limitText = limits.maxShopifyStores === -1 ? 'غير محدود' : limits.maxShopifyStores.toString();
      return next(createError(
        `لقد وصلت إلى الحد الأقصى لمتاجر Shopify (${limitText}). يرجى ترقية خطتك لإضافة المزيد من المتاجر.`,
        403
      ));
    }

    next();
  } catch (error) {
    next(error);
  }
};

export const checkTelegramBotsLimit = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }
    await assertChannelSlotAvailable(merchantId, 'telegram');
    next();
  } catch (error) {
    next(error);
  }
};

export const checkCustomersLimit = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const limits = await getMerchantPlanLimits(merchantId);
    const currentCount = await getCustomersCount(merchantId);

    if (!isWithinLimit(currentCount, limits.maxCustomers)) {
      const limitText = limits.maxCustomers === -1 ? 'غير محدود' : limits.maxCustomers.toString();
      return next(createError(
        `لقد وصلت إلى الحد الأقصى للعملاء (${limitText}). يرجى ترقية خطتك لإضافة المزيد من العملاء.`,
        403
      ));
    }

    next();
  } catch (error) {
    next(error);
  }
};

export const checkAdvancedAnalytics = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const limits = await getMerchantPlanLimits(merchantId);

    if (!limits.hasAdvancedAnalytics) {
      return next(createError(
        'التحليلات المتقدمة غير متاحة في خطتك الحالية. يرجى ترقية خطتك للوصول إلى هذه الميزة.',
        403
      ));
    }

    next();
  } catch (error) {
    next(error);
  }
};

export const checkAPIAccess = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const limits = await getMerchantPlanLimits(merchantId);

    if (!limits.hasAPIAccess) {
      return next(createError(
        'الوصول إلى API غير متاح في خطتك الحالية. يرجى ترقية خطتك للوصول إلى هذه الميزة.',
        403
      ));
    }

    next();
  } catch (error) {
    next(error);
  }
};

/** Block enabling sales-bot channels when plan is comments-only */
export const checkSalesBotAccess = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId || req.userId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const limits = await getMerchantPlanLimits(merchantId);
    if (!limits.hasSalesBot) {
      return next(createError(
        'باقتك الحالية مخصّصة للرد على التعليقات فقط ولا تشمل بوت المبيعات. رقِّ الباقة لتفعيل الرسائل الخاصة.',
        403,
        true,
        'SALES_BOT_NOT_INCLUDED'
      ));
    }

    next();
  } catch (error) {
    next(error);
  }
};

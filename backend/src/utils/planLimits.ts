import pool from '../database/connection.js';
import { logger } from './logger.js';
import {
  DEFAULT_PLAN_LIMITS,
  ZERO_PLAN_LIMITS,
  type PlanLimits
} from './planDefinitions.js';

export type { PlanLimits };

/**
 * Get plan limits from database or return defaults
 */
export async function getPlanLimits(planKey: string): Promise<PlanLimits> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS global_settings (
        key VARCHAR(255) PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const result = await pool.query(
      `SELECT value::jsonb FROM global_settings WHERE key = $1`,
      [`plan_limits_${planKey}`]
    );

    if (result.rows.length > 0 && result.rows[0].value) {
      const dbLimits = result.rows[0].value;
      return {
        ...(DEFAULT_PLAN_LIMITS[planKey] || DEFAULT_PLAN_LIMITS.comments),
        ...dbLimits
      };
    }
  } catch (error) {
    logger.warn(`Could not fetch plan limits for ${planKey} from database`, error as Error);
  }

  return DEFAULT_PLAN_LIMITS[planKey] || DEFAULT_PLAN_LIMITS.comments;
}

/**
 * Get merchant's current plan limits
 */
export async function getMerchantPlanLimits(merchantId: string): Promise<PlanLimits> {
  try {
    const { ensureSubscriptionEndsAtColumn, enforceMerchantSubscriptionExpiry } = await import(
      '../services/subscriptionExpiry/index.js'
    );
    await ensureSubscriptionEndsAtColumn();

    const result = await pool.query(
      `SELECT subscription_plan, subscription_status, trial_ends_at, subscription_ends_at
       FROM merchants 
       WHERE id = $1`,
      [merchantId]
    );

    if (result.rows.length === 0) {
      return DEFAULT_PLAN_LIMITS.trial;
    }

    const merchant = result.rows[0];
    const subscriptionPlan = merchant.subscription_plan || 'trial';
    let subscriptionStatus = merchant.subscription_status || 'active';
    const trialEndsAt = merchant.trial_ends_at;

    // Keep bot/webhook paths in sync with dashboard: expire paid period when due
    if (
      subscriptionStatus === 'active' &&
      subscriptionPlan !== 'trial' &&
      merchant.subscription_ends_at
    ) {
      const enforced = await enforceMerchantSubscriptionExpiry(merchantId, {
        subscription_plan: merchant.subscription_plan,
        subscription_status: merchant.subscription_status,
        subscription_ends_at: merchant.subscription_ends_at
      });
      subscriptionStatus = enforced.subscriptionStatus;
    }

    if (subscriptionPlan === 'trial' && trialEndsAt) {
      const now = new Date();
      const trialEndDate = new Date(trialEndsAt);

      if (now > trialEndDate && subscriptionStatus === 'active') {
        return { ...ZERO_PLAN_LIMITS };
      }
    }

    if (subscriptionStatus === 'suspended' || subscriptionStatus === 'expired') {
      return { ...ZERO_PLAN_LIMITS };
    }

    return await getPlanLimits(subscriptionPlan);
  } catch (error) {
    logger.error('Error getting merchant plan limits', error as Error, { merchantId });
    return DEFAULT_PLAN_LIMITS.trial;
  }
}

export function isWithinLimit(current: number, limit: number): boolean {
  if (limit === -1) return true;
  return current < limit;
}

/** Whether the merchant's plan includes Messenger / IG DM / Telegram sales bot. */
export async function merchantHasSalesBot(merchantId: string): Promise<boolean> {
  const limits = await getMerchantPlanLimits(merchantId);
  return limits.hasSalesBot;
}

/** Start of current billing period for marketing image quota. */
export function getMarketingImagePeriodStart(billingPeriod: 'monthly' | 'yearly'): Date {
  const now = new Date();
  if (billingPeriod === 'yearly') {
    return new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
  }
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

export async function getMarketingImageCount(
  merchantId: string,
  billingPeriod: 'monthly' | 'yearly' = 'monthly'
): Promise<number> {
  try {
    const periodStart = getMarketingImagePeriodStart(billingPeriod);

    const result = await pool.query(
      `SELECT COUNT(*)::int as count
       FROM design_studio_images
       WHERE merchant_id = $1
       AND created_at >= $2`,
      [merchantId, periodStart]
    );
    return result.rows[0]?.count || 0;
  } catch (error) {
    logger.error('Error getting marketing image count', error as Error, { merchantId });
    return 0;
  }
}

export async function getProductCount(merchantId: string): Promise<number> {
  try {
    const result = await pool.query(
      `SELECT COUNT(*)::int as count FROM products WHERE merchant_id = $1`,
      [merchantId]
    );
    return result.rows[0]?.count || 0;
  } catch (error) {
    logger.error('Error getting product count', error as Error, { merchantId });
    return 0;
  }
}

export async function getMonthlyAIResponseCount(merchantId: string): Promise<number> {
  try {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const result = await pool.query(
      `SELECT COUNT(*)::int as count 
       FROM messages 
       WHERE conversation_id IN (
         SELECT id FROM conversations WHERE merchant_id = $1
       )
       AND role = 'assistant'
       AND created_at >= $2`,
      [merchantId, startOfMonth]
    );
    return result.rows[0]?.count || 0;
  } catch (error) {
    logger.error('Error getting monthly AI response count', error as Error, { merchantId });
    return 0;
  }
}

export async function getFacebookPagesCount(merchantId: string): Promise<number> {
  try {
    const result = await pool.query(
      `SELECT COUNT(*)::int as count FROM facebook_pages WHERE merchant_id = $1`,
      [merchantId]
    );
    return result.rows[0]?.count || 0;
  } catch (error) {
    logger.error('Error getting Facebook pages count', error as Error, { merchantId });
    return 0;
  }
}

export async function getInstagramAccountsCount(merchantId: string): Promise<number> {
  try {
    const result = await pool.query(
      `SELECT COUNT(*)::int as count FROM instagram_accounts WHERE merchant_id = $1`,
      [merchantId]
    );
    return result.rows[0]?.count || 0;
  } catch (error) {
    logger.error('Error getting Instagram accounts count', error as Error, { merchantId });
    return 0;
  }
}

export async function getWhatsAppAccountsCount(merchantId: string): Promise<number> {
  try {
    const [cloud, web] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int as count FROM whatsapp_accounts WHERE merchant_id = $1 AND is_verified = true`,
        [merchantId]
      ),
      pool.query(
        `SELECT COUNT(*)::int as count
         FROM whatsapp_web_sessions
         WHERE merchant_id = $1 AND status = 'connected'`,
        [merchantId]
      ).catch(() => ({ rows: [{ count: 0 }] }))
    ]);
    return (cloud.rows[0]?.count || 0) + (web.rows[0]?.count || 0);
  } catch (error) {
    logger.error('Error getting WhatsApp accounts count', error as Error, { merchantId });
    return 0;
  }
}

export async function getShopifyStoresCount(merchantId: string): Promise<number> {
  try {
    const result = await pool.query(
      `SELECT COUNT(*)::int as count FROM shopify_stores WHERE merchant_id = $1`,
      [merchantId]
    );
    return result.rows[0]?.count || 0;
  } catch (error) {
    logger.error('Error getting Shopify stores count', error as Error, { merchantId });
    return 0;
  }
}

export async function getStorifyStoresCount(merchantId: string): Promise<number> {
  try {
    const result = await pool.query(
      `SELECT COUNT(*)::int as count FROM storify_stores WHERE merchant_id = $1`,
      [merchantId]
    );
    return result.rows[0]?.count || 0;
  } catch (error) {
    logger.error('Error getting Storify stores count', error as Error, { merchantId });
    return 0;
  }
}

export async function getCustomersCount(merchantId: string): Promise<number> {
  try {
    const result = await pool.query(
      `SELECT COUNT(*)::int as count FROM customers WHERE merchant_id = $1`,
      [merchantId]
    );
    return result.rows[0]?.count || 0;
  } catch (error) {
    logger.error('Error getting customers count', error as Error, { merchantId });
    return 0;
  }
}

export async function getTelegramBotsCount(merchantId: string): Promise<number> {
  try {
    const result = await pool.query(
      `SELECT COUNT(*)::int as count FROM telegram_bots WHERE merchant_id = $1 AND is_active = true`,
      [merchantId]
    );
    return result.rows[0]?.count || 0;
  } catch (error) {
    logger.error('Error getting Telegram bots count', error as Error, { merchantId });
    return 0;
  }
}

/** FB pages + IG accounts + active Telegram bots + WhatsApp */
export async function getTotalChannelsCount(merchantId: string): Promise<number> {
  const [fb, ig, tg, wa] = await Promise.all([
    getFacebookPagesCount(merchantId),
    getInstagramAccountsCount(merchantId),
    getTelegramBotsCount(merchantId),
    getWhatsAppAccountsCount(merchantId)
  ]);
  return fb + ig + tg + wa;
}

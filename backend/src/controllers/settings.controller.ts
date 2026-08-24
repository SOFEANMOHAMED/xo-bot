import { Response, NextFunction } from 'express';
import pool from '../database/connection.js';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';
import { z } from 'zod';
import { 
  invalidateMerchantSettings, 
  invalidateProductKeywords,
  getCacheStats 
} from '../services/cacheService.js';
import { clearProductKeywordsCache } from '../services/tools/catalogTool.js';
import { maskSecret, isMaskedSecret } from '../utils/logPrivacy.js';
import { getMerchantPlanLimits, merchantHasSalesBot } from '../utils/planLimits.js';
import { toPlanCapabilities } from '../utils/planDefinitions.js';

const settingsSchema = z.object({
  storeName: z.string().optional(),
  telegramBotToken: z.string().optional(),
  welcomeMessage: z.string().optional(),
  systemPrompt: z.string().optional(),
  autoReplyComments: z.boolean().optional(),
  autoReplyMessenger: z.boolean().optional(),
  storeCurrency: z.string().optional(),
  botPersona: z.enum(['formal', 'friendly', 'sales', 'fast', 'luxury']).optional(),
  shippingPolicy: z.string().optional(),
  deliveryTime: z.string().optional(),
  paymentMethods: z.string().optional(),
  returnPolicy: z.string().optional(),
  additionalNotes: z.string().optional(),
  enableAIInjection: z.boolean().optional(),
  // Sales optimization settings
  enableCrossSelling: z.boolean().optional(),
  enableUpselling: z.boolean().optional(),
  enableUrgencyMessages: z.boolean().optional(),
  enableSocialProof: z.boolean().optional(),
  defaultDiscountPercentage: z.number().int().min(0).max(50).optional(),
  abandonedReminderEnabled: z.boolean().optional(),
  abandonedReminderDelayMinutes: z.number().int().min(5).max(720).optional(),
  abandonedReminderMessage: z.string().max(2000).optional().nullable(),
  salesScripts: z.object({
    welcomeScript: z.string().optional(),
    objectionHandlingScript: z.string().optional(),
    closingScript: z.string().optional(),
    crossSellScript: z.string().optional(),
  }).optional(),
});

const SELECT_SETTINGS_COLS = `store_name, telegram_bot_token, welcome_message, system_prompt,
  auto_reply_comments, auto_reply_messenger, store_currency,
  bot_persona, shipping_policy, delivery_time, payment_methods,
  return_policy, additional_notes, enable_ai_injection,
  created_at, updated_at`;
const SELECT_SETTINGS_COLS_WITH_AI = `store_name, telegram_bot_token, welcome_message, system_prompt,
  auto_reply_comments, auto_reply_messenger, store_currency,
  bot_persona, ai_mode, shipping_policy, delivery_time, payment_methods,
  return_policy, additional_notes, enable_ai_injection,
  created_at, updated_at`;
const SELECT_SETTINGS_COLS_FULL = `store_name, telegram_bot_token, welcome_message, system_prompt,
  auto_reply_comments, auto_reply_messenger, store_currency,
  bot_persona, shipping_policy, delivery_time, payment_methods,
  return_policy, additional_notes, enable_ai_injection,
  enable_cross_selling, enable_upselling, enable_urgency_messages,
  enable_social_proof, default_discount_percentage, sales_scripts,
  abandoned_reminder_enabled, abandoned_reminder_delay_minutes, abandoned_reminder_message,
  created_at, updated_at`;
const SELECT_SETTINGS_COLS_FULL_WITH_AI = `store_name, telegram_bot_token, welcome_message, system_prompt,
  auto_reply_comments, auto_reply_messenger, store_currency,
  bot_persona, ai_mode, shipping_policy, delivery_time, payment_methods,
  return_policy, additional_notes, enable_ai_injection,
  enable_cross_selling, enable_upselling, enable_urgency_messages,
  enable_social_proof, default_discount_percentage, sales_scripts,
  abandoned_reminder_enabled, abandoned_reminder_delay_minutes, abandoned_reminder_message,
  created_at, updated_at`;

async function fetchSettingsRow(merchantId: string, includeSalesCols: boolean): Promise<any> {
  const cols = includeSalesCols ? SELECT_SETTINGS_COLS_FULL_WITH_AI : SELECT_SETTINGS_COLS_WITH_AI;
  try {
    const r = await pool.query(
      `SELECT ${cols} FROM merchant_settings WHERE merchant_id = $1`,
      [merchantId]
    );
    return r.rows[0] || null;
  } catch (err: any) {
    const msg = err?.message ? String(err.message) : '';
    if (err?.code === '42703' || msg.includes('ai_mode') || msg.includes('abandoned_reminder')) {
      // Prefer full cols without abandoned_* if those are missing; then drop ai_mode
      if (includeSalesCols && msg.includes('abandoned_reminder')) {
        try {
          const colsNoAbandoned = SELECT_SETTINGS_COLS_FULL_WITH_AI
            .replace(
              /,\s*abandoned_reminder_enabled,\s*abandoned_reminder_delay_minutes,\s*abandoned_reminder_message/,
              ''
            );
          const r = await pool.query(
            `SELECT ${colsNoAbandoned} FROM merchant_settings WHERE merchant_id = $1`,
            [merchantId]
          );
          const row = r.rows[0] || null;
          if (row) {
            row.abandoned_reminder_enabled = true;
            row.abandoned_reminder_delay_minutes = 45;
            row.abandoned_reminder_message = null;
          }
          return row;
        } catch (inner: any) {
          err = inner;
        }
      }
      const colsFallback = includeSalesCols ? SELECT_SETTINGS_COLS_FULL : SELECT_SETTINGS_COLS;
      const r = await pool.query(
        `SELECT ${colsFallback.replace(
          /,\s*abandoned_reminder_enabled,\s*abandoned_reminder_delay_minutes,\s*abandoned_reminder_message/,
          ''
        )} FROM merchant_settings WHERE merchant_id = $1`,
        [merchantId]
      );
      const row = r.rows[0] || null;
      if (row) {
        row.ai_mode = row.ai_mode || 'hybrid';
        row.abandoned_reminder_enabled = row.abandoned_reminder_enabled ?? true;
        row.abandoned_reminder_delay_minutes = row.abandoned_reminder_delay_minutes ?? 45;
        row.abandoned_reminder_message = row.abandoned_reminder_message ?? null;
      }
      return row;
    }
    throw err;
  }
}

export const getSettings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    let row = await fetchSettingsRow(req.merchantId!, true);

    if (!row) {
      await pool.query(
        `INSERT INTO merchant_settings (merchant_id, store_name, welcome_message, store_currency)
         VALUES ($1, $2, $3, $4)`,
        [
          req.merchantId,
          'متجر جديد',
          'أهلاً بك في متجرنا! كيف يمكنني مساعدتك اليوم؟',
          'USD'
        ]
      );
      row = await fetchSettingsRow(req.merchantId!, true);
      if (!row) {
        return next(createError('Failed to load settings after create', 500));
      }
    }

    const settings = formatSettings(row);
    const planLimits = await getMerchantPlanLimits(req.merchantId!);
    const planCapabilities = toPlanCapabilities(planLimits);
    return res.json({
      success: true,
      data: {
        settings,
        planCapabilities
      }
    });
  } catch (error) {
    next(error);
  }
};

export const updateSettings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    

    const validated = settingsSchema.parse(req.body);

    if (validated.autoReplyMessenger === true) {
      const allowed = await merchantHasSalesBot(req.merchantId!);
      if (!allowed) {
        return next(createError(
          'باقتك الحالية مخصّصة للرد على التعليقات فقط ولا تشمل بوت المبيعات. رقِّ الباقة لتفعيل الرسائل الخاصة.',
          403,
          true,
          'SALES_BOT_NOT_INCLUDED'
        ));
      }
    }

    // Check if settings exist
    const checkResult = await pool.query(
      'SELECT id FROM merchant_settings WHERE merchant_id = $1',
      [req.merchantId]
    );

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    Object.entries(validated).forEach(([key, value]) => {
      // Include all values including boolean false (false is a valid value that should be saved)
      // Only skip undefined values - but include explicit false values
      if (value !== undefined) {
        // Do not persist masked telegram token echoes from the client
        if (key === 'telegramBotToken' && typeof value === 'string' && isMaskedSecret(value)) {
          return;
        }
        // Convert camelCase to snake_case, handling special cases like "AI" in "enableAIInjection"
        let dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        // Fix special cases: enableAIInjection -> enable_ai_injection (not enable_a_i_injection)
        dbKey = dbKey.replace(/_a_i_/g, '_ai_');
        // Handle JSONB fields (salesScripts)
        if (key === 'salesScripts' && typeof value === 'object') {
          updates.push(`${dbKey} = $${paramIndex++}::jsonb`);
          values.push(JSON.stringify(value));
        } else {
          updates.push(`${dbKey} = $${paramIndex++}`);
          values.push(value);
        }
      }
    });

    if (updates.length === 0) {
      return next(createError('No fields to update', 400));
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(req.merchantId);

    if (checkResult.rows.length === 0) {
      // Create settings if not exists
      await pool.query(
        `INSERT INTO merchant_settings (merchant_id, ${updates.map((_, i) => {
          const key = Object.keys(validated)[i];
          let dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
          // Fix special cases: enableAIInjection -> enable_ai_injection
          dbKey = dbKey.replace(/_a_i_/g, '_ai_');
          return dbKey;
        }).join(', ')}, updated_at)
         VALUES ($1, ${updates.map((_, i) => `$${i + 2}`).join(', ')}, CURRENT_TIMESTAMP)`,
        [req.merchantId, ...values.slice(0, -1)]
      );
    } else {
      // Update existing settings
      await pool.query(
        `UPDATE merchant_settings
         SET ${updates.join(', ')}
         WHERE merchant_id = $${paramIndex}`,
        values
      );
    }

    // Fetch updated settings (resilient to missing ai_mode column)
    const row = await fetchSettingsRow(req.merchantId!, true);
    if (!row) {
      return next(createError('Settings not found after update', 500));
    }
    const settings = formatSettings(row);

    // Sync Facebook page settings if provided in the update
    if (validated.autoReplyMessenger !== undefined) {
      await pool.query(
        'UPDATE facebook_pages SET auto_reply_messenger = $1 WHERE merchant_id = $2', 
        [validated.autoReplyMessenger, req.merchantId]
      );
    }
    if (validated.autoReplyComments !== undefined) {
      await pool.query(
        'UPDATE facebook_pages SET auto_reply_comments = $1 WHERE merchant_id = $2', 
        [validated.autoReplyComments, req.merchantId]
      );
    }

    // Invalidate merchant settings cache after update
    invalidateMerchantSettings(req.merchantId!);

    const planLimits = await getMerchantPlanLimits(req.merchantId!);
    const planCapabilities = toPlanCapabilities(planLimits);
    res.json({
      success: true,
      data: {
        settings,
        planCapabilities
      }
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return next(createError(error.errors[0].message, 400));
    }
    next(error);
  }
};

export const getUserDashboardStats = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.merchantId) {
      return next(createError('Unauthorized', 401));
    }

    // Get total queries (user messages in conversations)
    const totalQueriesResult = await pool.query(
      `SELECT COUNT(*)::int as count
       FROM messages msg
       JOIN conversations c ON c.id = msg.conversation_id
       WHERE c.merchant_id = $1
       AND msg.role = 'user'`,
      [req.merchantId]
    );
    const totalQueries = totalQueriesResult.rows[0]?.count || 0;

    // Get queries per day for last 7 days
    const queries7DaysResult = await pool.query(
      `SELECT 
        DATE(msg.created_at) as date,
        COUNT(*)::int as count
       FROM messages msg
       JOIN conversations c ON c.id = msg.conversation_id
       WHERE c.merchant_id = $1
       AND msg.role = 'user'
       AND msg.created_at >= CURRENT_DATE - INTERVAL '7 days'
       GROUP BY DATE(msg.created_at)
       ORDER BY date ASC`,
      [req.merchantId]
    );

    // Get queries per week for last month (4 weeks)
    const queriesMonthResult = await pool.query(
      `SELECT 
        DATE_TRUNC('week', msg.created_at)::date as week_start,
        COUNT(*)::int as count
       FROM messages msg
       JOIN conversations c ON c.id = msg.conversation_id
       WHERE c.merchant_id = $1
       AND msg.role = 'user'
       AND msg.created_at >= CURRENT_DATE - INTERVAL '1 month'
       GROUP BY DATE_TRUNC('week', msg.created_at)
       ORDER BY week_start ASC
       LIMIT 4`,
      [req.merchantId]
    );

    // Get queries per month for last year (12 months)
    const queriesYearResult = await pool.query(
      `SELECT 
        DATE_TRUNC('month', msg.created_at)::date as month_start,
        COUNT(*)::int as count
       FROM messages msg
       JOIN conversations c ON c.id = msg.conversation_id
       WHERE c.merchant_id = $1
       AND msg.role = 'user'
       AND msg.created_at >= CURRENT_DATE - INTERVAL '1 year'
       GROUP BY DATE_TRUNC('month', msg.created_at)
       ORDER BY month_start ASC
       LIMIT 12`,
      [req.merchantId]
    );

    // Generate array for last 7 days
    const days = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
    const last7Days: Date[] = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      last7Days.push(date);
    }

    // Map 7 days data
    const queries7DaysMap = new Map();
    queries7DaysResult.rows.forEach(row => {
      const date = new Date(row.date);
      queries7DaysMap.set(date.toDateString(), parseInt(row.count || '0'));
    });

    const queries7DaysData = last7Days.map((date) => {
      const dayName = days[date.getDay()];
      const count = queries7DaysMap.get(date.toDateString()) || 0;
      return { name: dayName, queries: count };
    });

    // Map month data (4 weeks)
    const queriesMonthData = queriesMonthResult.rows.map((row, index) => ({
      name: `الأسبوع ${index + 1}`,
      queries: parseInt(row.count || '0')
    }));

    // Map year data (12 months)
    const months = [
      'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
      'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
    ];
    const queriesYearData = queriesYearResult.rows.map((row) => {
      const date = new Date(row.month_start);
      const monthIndex = date.getMonth();
      return {
        name: months[monthIndex],
        queries: parseInt(row.count || '0')
      };
    });

    res.json({
      success: true,
      data: {
        totalQueries,
        chartData: {
          '7days': queries7DaysData,
          'month': queriesMonthData.length > 0 ? queriesMonthData : [
            { name: 'الأسبوع 1', queries: 0 },
            { name: 'الأسبوع 2', queries: 0 },
            { name: 'الأسبوع 3', queries: 0 },
            { name: 'الأسبوع 4', queries: 0 }
          ],
          'year': queriesYearData.length > 0 ? queriesYearData : months.map((month) => ({
            name: month,
            queries: 0
          }))
        }
      }
    });
  } catch (error: any) {
    console.error('Error fetching user dashboard stats:', error);
    next(error);
  }
};

function formatSettings(row: any) {
  // Parse sales_scripts JSONB if it exists
  let salesScripts = {};
  if (row.sales_scripts) {
    try {
      salesScripts = typeof row.sales_scripts === 'string' 
        ? JSON.parse(row.sales_scripts) 
        : row.sales_scripts;
    } catch (e) {
      salesScripts = {};
    }
  }

  return {
    storeName: row.store_name,
    telegramBotToken: maskSecret(row.telegram_bot_token),
    welcomeMessage: row.welcome_message || '',
    systemPrompt: row.system_prompt || '',
    autoReplyComments: row.auto_reply_comments || false,
    autoReplyMessenger: row.auto_reply_messenger || false,
    storeCurrency: row.store_currency || 'USD',
    botPersona: row.bot_persona || 'friendly',
    storePolicies: {
      shippingPolicy: row.shipping_policy || '',
      deliveryTime: row.delivery_time || '',
      paymentMethods: row.payment_methods || '',
      returnPolicy: row.return_policy || '',
      additionalNotes: row.additional_notes || '',
      enableAIInjection: row.enable_ai_injection ?? false
    },
    signupDate: row.created_at || new Date(),
    // Sales optimization settings
    enableCrossSelling: row.enable_cross_selling ?? true,
    enableUpselling: row.enable_upselling ?? true,
    enableUrgencyMessages: row.enable_urgency_messages ?? true,
    enableSocialProof: row.enable_social_proof ?? true,
    defaultDiscountPercentage: row.default_discount_percentage ?? 10,
    abandonedReminderEnabled: row.abandoned_reminder_enabled ?? true,
    abandonedReminderDelayMinutes: row.abandoned_reminder_delay_minutes ?? 45,
    abandonedReminderMessage: row.abandoned_reminder_message || '',
    salesScripts: salesScripts
  };
}

/**
 * Clear cache for current merchant
 * Clears both settings and product keywords cache
 */
export const clearMerchantCache = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const merchantId = req.merchantId;
    
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    // Clear merchant settings cache
    invalidateMerchantSettings(merchantId);
    
    // Clear product keywords cache
    invalidateProductKeywords(merchantId);
    clearProductKeywordsCache(merchantId);

    res.json({
      success: true,
      message: 'Cache cleared successfully',
      data: {
        merchantId,
        clearedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get cache statistics (for debugging)
 */
export const getCacheStatistics = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const stats = getCacheStats();
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    next(error);
  }
};


import { Request, Response, NextFunction } from 'express';
import pool from '../database/connection.js';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';
import { updateGeminiServicePrompt } from '../utils/updateGeminiService.js';
import { getPlanConfig, calculateCommission } from '../utils/planConfig.js';
import {
  createMerchantNotification,
  type MerchantNotificationType,
} from '../services/merchantNotifications.js';
// Note: PRODUCT_BOT_SYSTEM_PROMPT and SERVICE_BOT_SYSTEM_PROMPT are now in utils/prompts
// Legacy prompt helpers removed; orchestrator is the single source of truth.
const PRODUCT_BOT_SYSTEM_PROMPT = 'You are a helpful product assistant.';
const SERVICE_BOT_SYSTEM_PROMPT = 'You are a helpful service assistant.';

export const getAdminStats = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // Get total users (excluding admin/owner accounts)
    const totalUsersResult = await pool.query(
      `SELECT COUNT(*)::int as count 
       FROM merchants 
       WHERE role NOT IN ('owner', 'admin') OR role IS NULL`
    );
    const totalUsers = totalUsersResult.rows[0]?.count || 0;

    // Get active users this month (users who logged in, created orders, or had conversations)
    // Exclude admin/owner accounts
    let activeUsersMonth = 0;
    try {
      const activeUsersResult = await pool.query(
        `SELECT COUNT(DISTINCT m.id)::int as count
         FROM merchants m
         WHERE (role NOT IN ('owner', 'admin') OR role IS NULL)
         AND (
           -- Users with orders this month
           EXISTS (
             SELECT 1 FROM orders o 
             WHERE o.merchant_id = m.id 
             AND o.created_at >= DATE_TRUNC('month', CURRENT_DATE)
           )
           OR
           -- Users with conversations this month
           EXISTS (
             SELECT 1 FROM conversations c 
             WHERE c.merchant_id = m.id 
             AND c.created_at >= DATE_TRUNC('month', CURRENT_DATE)
           )
           OR
           -- Users who logged in this month (updated_at indicates activity)
           m.updated_at >= DATE_TRUNC('month', CURRENT_DATE)
         )`
      );
      activeUsersMonth = activeUsersResult.rows[0]?.count || 0;
      
      // Fallback: if no active users found by activity, count users created this month (excluding admin)
      if (activeUsersMonth === 0) {
        const newUsersThisMonth = await pool.query(
          `SELECT COUNT(*)::int as count 
           FROM merchants 
           WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)
           AND (role NOT IN ('owner', 'admin') OR role IS NULL)`
        );
        activeUsersMonth = newUsersThisMonth.rows[0]?.count || 0;
      }
    } catch (err) {
      console.warn('Error calculating active users:', err);
      // Fallback: count all users (excluding admin) if query fails
      activeUsersMonth = totalUsers;
    }

    // Get paid subscriptions (excluding trial and admin/owner accounts)
    const paidSubscriptionsResult = await pool.query(
      `SELECT COUNT(*)::int as count 
       FROM merchants 
       WHERE subscription_plan NOT IN ('trial', '') 
       AND subscription_status = 'active'
       AND subscription_plan IN ('comments', 'single', 'social', 'yearly', 'starter', 'pro', 'business')
       AND (role NOT IN ('owner', 'admin') OR role IS NULL)`
    );
    const paidSubscriptions = paidSubscriptionsResult.rows[0]?.count || 0;

    // Get total AI responses from messages table
    let totalAiResponses = 0;
    try {
      const aiResponsesResult = await pool.query(
        `SELECT COUNT(*)::int as count 
         FROM messages 
         WHERE role = 'assistant'`
      );
      totalAiResponses = aiResponsesResult.rows[0]?.count || 0;
    } catch (err) {
      // If messages table doesn't exist or has issues, use 0
      console.warn('Could not count AI responses:', err);
      totalAiResponses = 0;
    }

    // Calculate estimated MRR (Monthly Recurring Revenue)
    // Exclude admin/owner accounts and trial accounts
    const mrrResult = await pool.query(
      `SELECT 
        COUNT(CASE WHEN subscription_plan = 'comments' THEN 1 END)::int as comments_count,
        COUNT(CASE WHEN subscription_plan = 'single' THEN 1 END)::int as single_count,
        COUNT(CASE WHEN subscription_plan = 'social' THEN 1 END)::int as social_count,
        COUNT(CASE WHEN subscription_plan = 'yearly' THEN 1 END)::int as yearly_count,
        COUNT(CASE WHEN subscription_plan = 'starter' THEN 1 END)::int as starter_count,
        COUNT(CASE WHEN subscription_plan = 'pro' THEN 1 END)::int as pro_count,
        COUNT(CASE WHEN subscription_plan = 'business' THEN 1 END)::int as business_count
       FROM merchants 
       WHERE subscription_plan IN ('comments', 'single', 'social', 'yearly', 'starter', 'pro', 'business')
       AND subscription_status = 'active'
       AND (role NOT IN ('owner', 'admin') OR role IS NULL)`
    );
    const counts = mrrResult.rows[0] || {};
    
    const [commentsConfig, singleConfig, socialConfig, yearlyConfig, starterConfig, proConfig, businessConfig] = await Promise.all([
      getPlanConfig('comments'),
      getPlanConfig('single'),
      getPlanConfig('social'),
      getPlanConfig('yearly'),
      getPlanConfig('starter'),
      getPlanConfig('pro'),
      getPlanConfig('business')
    ]);
    
    // Yearly plan contributes price/12 to MRR estimate
    const estimatedMrr = (
      parseInt(counts.comments_count || '0') * commentsConfig.price +
      parseInt(counts.single_count || '0') * singleConfig.price +
      parseInt(counts.social_count || '0') * socialConfig.price +
      parseInt(counts.yearly_count || '0') * (yearlyConfig.price / 12) +
      parseInt(counts.starter_count || '0') * starterConfig.price +
      parseInt(counts.pro_count || '0') * proConfig.price +
      parseInt(counts.business_count || '0') * businessConfig.price
    );
    
    // Calculate ARPU (Average Revenue Per User)
    const arpu = paidSubscriptions > 0 ? estimatedMrr / paidSubscriptions : 0;
    
    // Calculate ARR (Annual Recurring Revenue)
    const arr = estimatedMrr * 12;
    
    // Get new users counts
    const newUsersTodayResult = await pool.query(
      `SELECT COUNT(*)::int as count 
       FROM merchants 
       WHERE created_at >= CURRENT_DATE
       AND (role NOT IN ('owner', 'admin') OR role IS NULL)`
    );
    const newUsersToday = newUsersTodayResult.rows[0]?.count || 0;
    
    const newUsersThisWeekResult = await pool.query(
      `SELECT COUNT(*)::int as count 
       FROM merchants 
       WHERE created_at >= DATE_TRUNC('week', CURRENT_DATE)
       AND (role NOT IN ('owner', 'admin') OR role IS NULL)`
    );
    const newUsersThisWeek = newUsersThisWeekResult.rows[0]?.count || 0;
    
    const newUsersThisMonthResult = await pool.query(
      `SELECT COUNT(*)::int as count 
       FROM merchants 
       WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE)
       AND (role NOT IN ('owner', 'admin') OR role IS NULL)`
    );
    const newUsersThisMonth = newUsersThisMonthResult.rows[0]?.count || 0;
    
    // Get trials ending soon (next 7 days)
    const trialsEndingSoonResult = await pool.query(
      `SELECT COUNT(*)::int as count 
       FROM merchants 
       WHERE subscription_plan = 'trial'
       AND trial_ends_at IS NOT NULL
       AND trial_ends_at BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
       AND (role NOT IN ('owner', 'admin') OR role IS NULL)`
    );
    const trialsEndingSoon = trialsEndingSoonResult.rows[0]?.count || 0;
    
    // Calculate Conversion Rate (Trial to Paid)
    const totalTrialsResult = await pool.query(
      `SELECT COUNT(*)::int as count 
       FROM merchants 
       WHERE subscription_plan = 'trial'
       AND (role NOT IN ('owner', 'admin') OR role IS NULL)`
    );
    const totalTrials = totalTrialsResult.rows[0]?.count || 0;
    const conversionRate = totalTrials > 0 ? (paidSubscriptions / (totalTrials + paidSubscriptions)) * 100 : 0;
    
    // Calculate Churn Rate (users who expired in last 30 days)
    const churnedUsersResult = await pool.query(
      `SELECT COUNT(*)::int as count 
       FROM merchants 
       WHERE subscription_status = 'expired'
       AND updated_at >= CURRENT_DATE - INTERVAL '30 days'
       AND (role NOT IN ('owner', 'admin') OR role IS NULL)`
    );
    const churnedUsers = churnedUsersResult.rows[0]?.count || 0;
    const churnRate = paidSubscriptions > 0 ? (churnedUsers / paidSubscriptions) * 100 : 0;

    res.json({
      success: true,
      data: {
        totalUsers,
        activeUsersMonth,
        paidSubscriptions,
        totalAiResponses,
        estimatedMrr,
        arpu: Math.round(arpu * 100) / 100,
        churnRate: Math.round(churnRate * 100) / 100,
        conversionRate: Math.round(conversionRate * 100) / 100,
        trialsEndingSoon,
        arr: Math.round(arr),
        newUsersToday,
        newUsersThisWeek,
        newUsersThisMonth
      }
    });
  } catch (error: any) {
    console.error('Error fetching admin stats:', error);
    next(error);
  }
};


// Public endpoint to get subscription plans (no authentication required)
export const getPublicSubscriptionPlans = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // Get plan configs from database or use defaults
    const [commentsConfig, singleConfig, socialConfig, yearlyConfig] = await Promise.all([
      getPlanConfig('comments'),
      getPlanConfig('single'),
      getPlanConfig('social'),
      getPlanConfig('yearly')
    ]);

    const plans = [
      {
        name: commentsConfig.name,
        planKey: 'comments',
        price: commentsConfig.price,
        billingPeriod: commentsConfig.billingPeriod,
        description: commentsConfig.description,
        features: commentsConfig.features
      },
      {
        name: singleConfig.name,
        planKey: 'single',
        price: singleConfig.price,
        billingPeriod: singleConfig.billingPeriod,
        description: singleConfig.description,
        features: singleConfig.features
      },
      {
        name: socialConfig.name,
        planKey: 'social',
        price: socialConfig.price,
        billingPeriod: socialConfig.billingPeriod,
        description: socialConfig.description,
        features: socialConfig.features
      },
      {
        name: yearlyConfig.name,
        planKey: 'yearly',
        price: yearlyConfig.price,
        billingPeriod: yearlyConfig.billingPeriod,
        description: yearlyConfig.description,
        features: yearlyConfig.features
      }
    ];

    res.json({
      success: true,
      data: {
        plans
      }
    });
  } catch (error: any) {
    console.error('Error fetching public subscription plans:', error);
    next(error);
  }
};

export const getAdminSubscriptionPlans = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // Get user count for each plan (excluding admin/owner accounts)
    const plansResult = await pool.query(
      `SELECT 
        subscription_plan,
        COUNT(*)::int as user_count
       FROM merchants 
       WHERE (role NOT IN ('owner', 'admin') OR role IS NULL)
       AND subscription_status = 'active'
       GROUP BY subscription_plan`
    );

    // Create map of plan counts
    const planCounts = new Map<string, number>();
    plansResult.rows.forEach(row => {
      planCounts.set(row.subscription_plan, parseInt(row.user_count || '0'));
    });

    const [commentsConfig, singleConfig, socialConfig, yearlyConfig] = await Promise.all([
      getPlanConfig('comments'),
      getPlanConfig('single'),
      getPlanConfig('social'),
      getPlanConfig('yearly')
    ]);

    const plans = [
      {
        name: commentsConfig.name,
        planKey: 'comments',
        price: commentsConfig.price,
        billingPeriod: commentsConfig.billingPeriod,
        users: planCounts.get('comments') || 0,
        features: commentsConfig.features
      },
      {
        name: singleConfig.name,
        planKey: 'single',
        price: singleConfig.price,
        billingPeriod: singleConfig.billingPeriod,
        users: planCounts.get('single') || 0,
        features: singleConfig.features
      },
      {
        name: socialConfig.name,
        planKey: 'social',
        price: socialConfig.price,
        billingPeriod: socialConfig.billingPeriod,
        users: planCounts.get('social') || 0,
        features: socialConfig.features
      },
      {
        name: yearlyConfig.name,
        planKey: 'yearly',
        price: yearlyConfig.price,
        billingPeriod: yearlyConfig.billingPeriod,
        users: planCounts.get('yearly') || 0,
        features: yearlyConfig.features
      }
    ];

    // Also include trial count
    const trialCount = planCounts.get('trial') || 0;

    res.json({
      success: true,
      data: {
        plans,
        trialCount
      }
    });
  } catch (error: any) {
    console.error('Error fetching subscription plans:', error);
    next(error);
  }
};

export const updateAdminSubscriptionPlan = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { planKey } = req.params;
    const { name, price, features, limits, billingPeriod, description } = req.body;

    if (!planKey || !['comments', 'single', 'social', 'yearly', 'trial'].includes(planKey)) {
      return next(createError('Invalid plan key', 400));
    }

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return next(createError('Plan name is required', 400));
    }

    if (typeof price !== 'number' || price < 0) {
      return next(createError('Price must be a positive number', 400));
    }

    if (!Array.isArray(features) || features.length === 0) {
      return next(createError('Features must be a non-empty array', 400));
    }
    
    // No limit on number of features - can add as many as needed

    // Ensure global_settings table exists (create if not exists)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS global_settings (
        key VARCHAR(255) PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Update or insert plan config
    await pool.query(
      `INSERT INTO global_settings (key, value, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (key) 
       DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
      [`plan_${planKey}`, JSON.stringify({
        name: name.trim(),
        price,
        features,
        billingPeriod: billingPeriod === 'yearly' ? 'yearly' : 'monthly',
        description: typeof description === 'string' ? description : undefined
      })]
    );

    // Update plan limits if provided
    if (limits && typeof limits === 'object') {
      await pool.query(
        `INSERT INTO global_settings (key, value, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (key) 
         DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
        [`plan_limits_${planKey}`, JSON.stringify(limits)]
      );
    }

    res.json({
      success: true,
      message: 'Plan updated successfully',
      data: {
        planKey,
        name: name.trim(),
        price,
        features,
        limits: limits || null
      }
    });
  } catch (error: any) {
    console.error('Error updating subscription plan:', error);
    next(error);
  }
};

// Get plan limits for admin
export const getAdminPlanLimits = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { getPlanLimits } = await import('../utils/planLimits.js');
    
    const [commentsLimits, singleLimits, socialLimits, yearlyLimits, trialLimits] = await Promise.all([
      getPlanLimits('comments'),
      getPlanLimits('single'),
      getPlanLimits('social'),
      getPlanLimits('yearly'),
      getPlanLimits('trial')
    ]);

    res.json({
      success: true,
      data: {
        comments: commentsLimits,
        single: singleLimits,
        social: socialLimits,
        yearly: yearlyLimits,
        trial: trialLimits
      }
    });
  } catch (error: any) {
    console.error('Error getting plan limits:', error);
    next(error);
  }
};

// Update plan limits
export const updateAdminPlanLimits = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { planKey } = req.params;
    const limits = req.body;

    if (!planKey || !['comments', 'single', 'social', 'yearly', 'trial'].includes(planKey)) {
      return next(createError('Invalid plan key', 400));
    }

    // Validate limits structure
    const requiredFields = [
      'maxProducts',
      'maxMonthlyAIResponses',
      'maxMonthlyMarketingImages',
      'maxFacebookPages',
      'maxInstagramAccounts',
      'maxWhatsAppAccounts',
      'maxShopifyStores',
      'maxTelegramBots',
      'maxTotalChannels',
      'maxCustomers',
      'hasAdvancedAnalytics',
      'hasAPIAccess',
      'hasSalesBot'
    ];

    for (const field of requiredFields) {
      if (!(field in limits)) {
        return next(createError(`Missing required field: ${field}`, 400));
      }
    }

    // Ensure global_settings table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS global_settings (
        key VARCHAR(255) PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Update or insert plan limits
    await pool.query(
      `INSERT INTO global_settings (key, value, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (key) 
       DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
      [`plan_limits_${planKey}`, JSON.stringify(limits)]
    );

    res.json({
      success: true,
      message: 'Plan limits updated successfully',
      data: {
        planKey,
        limits
      }
    });
  } catch (error: any) {
    console.error('Error updating plan limits:', error);
    next(error);
  }
};

export const getAdminUsageStats = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // Get top users by AI requests (from messages table)
    // Exclude admin/owner accounts
    const topUsersResult = await pool.query(
      `SELECT 
        m.id,
        m.name,
        m.email,
        COALESCE(COUNT(msg.id), 0)::int as requests
       FROM merchants m
       LEFT JOIN conversations c ON c.merchant_id = m.id
       LEFT JOIN messages msg ON msg.conversation_id = c.id AND msg.role = 'assistant'
       WHERE (m.role NOT IN ('owner', 'admin') OR m.role IS NULL)
       GROUP BY m.id, m.name, m.email
       ORDER BY requests DESC
       LIMIT 10`
    ).catch((err) => {
      console.error('Error in usage stats query:', err);
      // Return empty result on query error
      return { rows: [] };
    });

    const topUsers = topUsersResult.rows.map((row) => {
      const requests = typeof row.requests === 'number' ? row.requests : parseInt(String(row.requests || '0'), 10);
      return {
        id: String(row.id),
        name: row.name || row.email || 'مستخدم غير معروف',
        requests: requests,
        cost: requests > 10000 ? 'High' as const : 
              requests > 5000 ? 'Medium' as const : 'Low' as const
      };
    });

    res.json({
      success: true,
      data: topUsers
    });
  } catch (error: any) {
    console.error('Error fetching usage stats:', error);
    // Return empty array instead of throwing error
    res.json({
      success: true,
      data: []
    });
  }
};

export const getAdminChartData = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // Get new users per day for last 7 days
    const newUsersResult = await pool.query(
      `SELECT 
        DATE(created_at) as date,
        COUNT(*)::int as count
       FROM merchants
       WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
       AND (role NOT IN ('owner', 'admin') OR role IS NULL)
       GROUP BY DATE(created_at)
       ORDER BY date ASC`
    );

    // Get AI usage per day for last 7 days
    const aiUsageResult = await pool.query(
      `SELECT 
        DATE(msg.created_at) as date,
        COUNT(*)::int as count
       FROM messages msg
       JOIN conversations c ON c.id = msg.conversation_id
       WHERE msg.role = 'assistant'
       AND msg.created_at >= CURRENT_DATE - INTERVAL '7 days'
       GROUP BY DATE(msg.created_at)
       ORDER BY date ASC`
    );

    // Generate array for last 7 days
    const days = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
    const last7Days: Date[] = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      last7Days.push(date);
    }

    // Map new users data
    const newUsersMap = new Map();
    newUsersResult.rows.forEach(row => {
      const date = new Date(row.date);
      newUsersMap.set(date.toDateString(), parseInt(row.count || '0'));
    });

    const newUsersData = last7Days.map((date, index) => {
      const dayName = days[date.getDay()];
      const count = newUsersMap.get(date.toDateString()) || 0;
      return { name: dayName, users: count };
    });

    // Map AI usage data
    const aiUsageMap = new Map();
    aiUsageResult.rows.forEach(row => {
      const date = new Date(row.date);
      aiUsageMap.set(date.toDateString(), parseInt(row.count || '0'));
    });

    const aiUsageData = last7Days.map((date, index) => {
      const dayName = days[date.getDay()];
      const count = aiUsageMap.get(date.toDateString()) || 0;
      return { name: dayName, calls: count };
    });

    res.json({
      success: true,
      data: {
        newUsers: newUsersData,
        aiUsage: aiUsageData
      }
    });
  } catch (error: any) {
    console.error('Error fetching chart data:', error);
    // Return empty data on error
    const days = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
    const emptyData = days.map(name => ({ name, users: 0, calls: 0 }));
    res.json({
      success: true,
      data: {
        newUsers: emptyData.map(d => ({ name: d.name, users: 0 })),
        aiUsage: emptyData.map(d => ({ name: d.name, calls: 0 }))
      }
    });
  }
};

export const getAdminUsers = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const result = await pool.query(
      `SELECT 
        id,
        email,
        name,
        subscription_plan,
        subscription_status,
        trial_ends_at,
        created_at,
        role
       FROM merchants 
       ORDER BY created_at DESC`
    );

    const users = result.rows.map(row => ({
      id: row.id,
      email: row.email,
      name: row.name || 'غير محدد',
      registrationDate: row.created_at.toISOString(),
      plan: row.subscription_plan === 'trial' ? 'Trial' :
            row.subscription_plan === 'comments' ? 'التعليقات' :
            row.subscription_plan === 'single' ? 'القناة الواحدة' :
            row.subscription_plan === 'social' ? 'السوشيال' :
            row.subscription_plan === 'yearly' ? 'السنوية' :
            row.subscription_plan === 'starter' ? 'Starter' :
            row.subscription_plan === 'pro' ? 'Pro' :
            row.subscription_plan === 'business' ? 'Business' :
            (row.subscription_plan || 'Trial'),
      status: row.subscription_status === 'active' ? 'active' :
              row.subscription_status === 'suspended' ? 'suspended' :
              'expired',
      isTrial: row.subscription_plan === 'trial' || row.trial_ends_at !== null,
      trialEndsAt: row.trial_ends_at ? row.trial_ends_at.toISOString() : undefined
    }));

    res.json({
      success: true,
      data: users
    });
  } catch (error) {
    next(error);
  }
};

export const getAdminUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT 
        id,
        email,
        name,
        subscription_plan,
        subscription_status,
        trial_ends_at,
        created_at,
        role
       FROM merchants 
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return next(createError('User not found', 404));
    }

    const row = result.rows[0];
    const user = {
      id: row.id,
      email: row.email,
      name: row.name || 'غير محدد',
      registrationDate: row.created_at.toISOString(),
      plan: row.subscription_plan === 'trial' ? 'Trial' :
            row.subscription_plan === 'comments' ? 'التعليقات' :
            row.subscription_plan === 'single' ? 'القناة الواحدة' :
            row.subscription_plan === 'social' ? 'السوشيال' :
            row.subscription_plan === 'yearly' ? 'السنوية' :
            row.subscription_plan === 'starter' ? 'Starter' :
            row.subscription_plan === 'pro' ? 'Pro' :
            row.subscription_plan === 'business' ? 'Business' :
            (row.subscription_plan || 'Trial'),
      status: row.subscription_status === 'active' ? 'active' :
              row.subscription_status === 'suspended' ? 'suspended' :
              'expired',
      isTrial: row.subscription_plan === 'trial' || row.trial_ends_at !== null,
      trialEndsAt: row.trial_ends_at ? row.trial_ends_at.toISOString() : undefined
    };

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    next(error);
  }
};

export const updateAdminUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const { name, email, subscription_plan, subscription_status, trial_ends_at } = req.body;

    // Check if user exists
    const checkResult = await pool.query(
      'SELECT id FROM merchants WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      return next(createError('User not found', 404));
    }

    // Check if email is already taken by another user
    if (email !== undefined) {
      const emailCheck = await pool.query(
        'SELECT id FROM merchants WHERE email = $1 AND id != $2',
        [email, id]
      );
      if (emailCheck.rows.length > 0) {
        return next(createError('Email already registered', 400));
      }
    }

    // Update user
    const updateFields: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (name !== undefined) {
      updateFields.push(`name = $${paramCount++}`);
      values.push(name);
    }

    if (email !== undefined) {
      updateFields.push(`email = $${paramCount++}`);
      values.push(email);
    }

    // Get old plan before updating (if subscription_plan is being changed)
    let oldPlan: string | null = null;
    if (subscription_plan !== undefined) {
      const oldPlanResult = await pool.query(
        'SELECT subscription_plan FROM merchants WHERE id = $1',
        [id]
      );
      oldPlan = oldPlanResult.rows[0]?.subscription_plan || null;
    }

    if (subscription_plan !== undefined) {
      updateFields.push(`subscription_plan = $${paramCount++}`);
      values.push(subscription_plan);
    }

    if (subscription_status !== undefined) {
      updateFields.push(`subscription_status = $${paramCount++}`);
      values.push(subscription_status);
    }

    if (trial_ends_at !== undefined) {
      updateFields.push(`trial_ends_at = $${paramCount++}`);
      values.push(trial_ends_at ? new Date(trial_ends_at) : null);
    }

    if (updateFields.length === 0) {
      return next(createError('No fields to update', 400));
    }

    updateFields.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id);

    const result = await pool.query(
      `UPDATE merchants 
       SET ${updateFields.join(', ')} 
       WHERE id = $${paramCount}
       RETURNING id, email, name, subscription_plan, subscription_status, trial_ends_at, created_at`,
      values
    );

    // Update affiliate commission if plan was upgraded from trial to paid plan
    if (subscription_plan !== undefined && subscription_plan !== 'trial' && subscription_plan !== oldPlan) {
      try {
        // Check if there are pending referrals for this user
        const pendingReferralsResult = await pool.query(
          `SELECT id, plan FROM affiliate_referrals 
           WHERE referred_user_id = $1 AND status = 'pending'`,
          [id]
        );

        if (pendingReferralsResult.rows.length > 0) {
          // Calculate commission using helper function
          const newCommissionAmount = await calculateCommission(subscription_plan);

          // Update commission for pending referrals
          await pool.query(
            `UPDATE affiliate_referrals 
             SET commission_amount = $1, plan = $2, updated_at = CURRENT_TIMESTAMP
             WHERE referred_user_id = $3 AND status = 'pending'`,
            [newCommissionAmount, subscription_plan, id]
          );

          console.log(`Updated affiliate commission for user ${id}: ${oldPlan} -> ${subscription_plan}, commission: ${newCommissionAmount}`);
        }
      } catch (affiliateError: any) {
        // Log error but don't fail the update
        console.warn('Error updating affiliate commission:', affiliateError.message);
      }
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    next(error);
  }
};

export const createAdminUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { name, email, password, subscription_plan, subscription_status, isTrial, trial_ends_at } = req.body;

    if (!name || !email || !password) {
      return next(createError('Name, email, and password are required', 400));
    }

    if (password.length < 6) {
      return next(createError('Password must be at least 6 characters', 400));
    }

    // Check if user exists
    const existingUser = await pool.query(
      'SELECT id FROM merchants WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      return next(createError('Email already registered', 400));
    }

    // Hash password
    const bcrypt = await import('bcryptjs');
    const saltRounds = 10;
    const passwordHash = await bcrypt.default.hash(password, saltRounds);

    // Determine subscription plan
    const plan = subscription_plan || 'starter';
    const status = subscription_status || 'active';
    const trialEndsAt = isTrial && trial_ends_at ? new Date(trial_ends_at) : (isTrial ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : null);

    // Create user
    const result = await pool.query(
      `INSERT INTO merchants (email, password_hash, name, role, subscription_plan, subscription_status, trial_ends_at)
       VALUES ($1, $2, $3, 'user', $4, $5, $6)
       RETURNING id, email, name, subscription_plan, subscription_status, trial_ends_at, created_at, role`,
      [email, passwordHash, name, plan, status, trialEndsAt]
    );

    const merchant = result.rows[0];

    // Create default settings
    await pool.query(
      `INSERT INTO merchant_settings (merchant_id, store_name, welcome_message, store_currency)
       VALUES ($1, $2, $3, $4)`,
      [
        merchant.id,
        name || 'متجر جديد',
        'أهلاً بك في متجرنا! كيف يمكنني مساعدتك اليوم؟',
        'USD'
      ]
    );

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: {
        id: merchant.id,
        email: merchant.email,
        name: merchant.name,
        plan: merchant.subscription_plan === 'trial' ? 'Trial' :
              merchant.subscription_plan === 'comments' ? 'التعليقات' :
              merchant.subscription_plan === 'single' ? 'القناة الواحدة' :
              merchant.subscription_plan === 'social' ? 'السوشيال' :
              merchant.subscription_plan === 'yearly' ? 'السنوية' :
              merchant.subscription_plan === 'starter' ? 'Starter' :
              merchant.subscription_plan === 'pro' ? 'Pro' :
              merchant.subscription_plan === 'business' ? 'Business' :
              (merchant.subscription_plan || 'Trial'),
        status: merchant.subscription_status === 'active' ? 'active' :
                merchant.subscription_status === 'suspended' ? 'suspended' :
                'expired',
        registrationDate: merchant.created_at.toISOString(),
        isTrial: merchant.subscription_plan === 'trial' || merchant.trial_ends_at !== null,
        trialEndsAt: merchant.trial_ends_at ? merchant.trial_ends_at.toISOString() : undefined
      }
    });
  } catch (error: any) {
    console.error('Error creating admin user:', error);
    next(error);
  }
};

export const deleteAdminUser = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;

    // Prevent deleting yourself
    if (id === req.merchantId) {
      return next(createError('Cannot delete your own account', 400));
    }

    // Prevent deleting other owners/admins (only owner can do this)
    const checkResult = await pool.query(
      'SELECT role FROM merchants WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      return next(createError('User not found', 404));
    }

    if (checkResult.rows[0].role === 'owner' && req.userRole !== 'owner') {
      return next(createError('Only owner can delete other owners', 403));
    }

    await pool.query('DELETE FROM merchants WHERE id = $1', [id]);

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

export const getSystemLogs = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // TODO: Implement actual system logs table
    // For now, return empty array
    res.json({
      success: true,
      data: []
    });
  } catch (error) {
    next(error);
  }
};

export const getAdminAffiliateStats = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // Create affiliate_referrals table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS affiliate_referrals (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        referrer_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        referred_user_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        referral_code VARCHAR(100),
        status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'expired')),
        commission_amount DECIMAL(10, 2) DEFAULT 0,
        plan VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(referred_user_id)
      )
    `);

    // Create affiliate_clicks table if it doesn't exist (for tracking clicks on referral links)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS affiliate_clicks (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        referrer_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        referral_code VARCHAR(100),
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for better performance
    try {
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_affiliate_referrals_referrer_id ON affiliate_referrals(referrer_id);
        CREATE INDEX IF NOT EXISTS idx_affiliate_referrals_status ON affiliate_referrals(status);
        CREATE INDEX IF NOT EXISTS idx_affiliate_clicks_referrer_id ON affiliate_clicks(referrer_id);
      `);
    } catch (indexError: any) {
      // Indexes might already exist, ignore error
      console.warn('Error creating indexes (may already exist):', indexError.message);
    }

    // Get total affiliates (users who have referred at least one user)
    const totalAffiliatesResult = await pool.query(`
      SELECT COUNT(DISTINCT referrer_id)::int as count
      FROM affiliate_referrals
      WHERE referrer_id NOT IN (SELECT id FROM merchants WHERE role IN ('owner', 'admin'))
    `).catch((err) => {
      console.warn('Error fetching total affiliates:', err);
      return { rows: [{ count: 0 }] };
    });
    const totalAffiliates = totalAffiliatesResult.rows[0]?.count || 0;

    // Get total referral signups
    const totalReferralSignupsResult = await pool.query(`
      SELECT COUNT(*)::int as count
      FROM affiliate_referrals
      WHERE referred_user_id NOT IN (SELECT id FROM merchants WHERE role IN ('owner', 'admin'))
    `).catch((err) => {
      console.warn('Error fetching total referral signups:', err);
      return { rows: [{ count: 0 }] };
    });
    const totalReferralSignups = totalReferralSignupsResult.rows[0]?.count || 0;

    // Get total commissions owed (sum of all active commissions)
    const totalCommissionsResult = await pool.query(`
      SELECT COALESCE(SUM(commission_amount), 0)::decimal as total
      FROM affiliate_referrals
      WHERE status = 'active'
        AND referrer_id NOT IN (SELECT id FROM merchants WHERE role IN ('owner', 'admin'))
    `).catch((err) => {
      console.warn('Error fetching total commissions:', err);
      return { rows: [{ total: '0' }] };
    });
    const totalCommissionsOwed = parseFloat(totalCommissionsResult.rows[0]?.total || '0');

    // Get top affiliates by performance (signups + commissions)
    const topAffiliatesResult = await pool.query(`
      SELECT 
        m.id,
        m.name,
        m.email,
        COALESCE(COUNT(DISTINCT ar.id), 0)::int as signups,
        COALESCE(COUNT(DISTINCT ac.id), 0)::int as clicks,
        COALESCE(SUM(CASE WHEN ar.status = 'active' THEN ar.commission_amount ELSE 0 END), 0)::decimal as commission
      FROM merchants m
      LEFT JOIN affiliate_referrals ar ON ar.referrer_id = m.id
      LEFT JOIN affiliate_clicks ac ON ac.referrer_id = m.id
      WHERE (m.role NOT IN ('owner', 'admin') OR m.role IS NULL)
      GROUP BY m.id, m.name, m.email
      HAVING COUNT(DISTINCT ar.id) > 0 OR COUNT(DISTINCT ac.id) > 0
      ORDER BY signups DESC, commission DESC
      LIMIT 10
    `).catch((err) => {
      console.warn('Error fetching top affiliates, returning empty array:', err);
      return { rows: [] };
    });

    const topAffiliates = topAffiliatesResult.rows.map((row) => ({
      id: String(row.id),
      name: row.name || row.email || 'مستخدم غير معروف',
      email: row.email || '',
      clicks: typeof row.clicks === 'number' ? row.clicks : parseInt(String(row.clicks || '0'), 10),
      signups: typeof row.signups === 'number' ? row.signups : parseInt(String(row.signups || '0'), 10),
      commission: typeof row.commission === 'number' ? parseFloat(String(row.commission)) : parseFloat(String(row.commission || '0'))
    }));

    const stats = {
      totalAffiliates,
      totalReferralSignups,
      totalCommissionsOwed,
      topAffiliates
    };

    res.json({
      success: true,
      data: stats
    });
  } catch (error: any) {
    console.error('Error fetching affiliate stats:', error);
    next(error);
  }
};

/**
 * Get admin notifications
 */
export const getAdminNotifications = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // Ensure admin_notifications table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_notifications (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        type VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        data JSONB,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        read_at TIMESTAMP
      )
    `);

    const { unreadOnly } = req.query;
    
    let query = `
      SELECT id, type, title, message, data, is_read, created_at, read_at
      FROM admin_notifications
    `;
    
    const params: any[] = [];
    
    if (unreadOnly === 'true') {
      query += ` WHERE is_read = FALSE`;
    }
    
    query += ` ORDER BY created_at DESC LIMIT 100`;
    
    const result = await pool.query(query, params);
    
    const notifications = result.rows.map((row) => ({
      id: String(row.id),
      type: row.type,
      title: row.title,
      message: row.message,
      data: row.data || {},
      isRead: row.is_read,
      createdAt: new Date(row.created_at),
      readAt: row.read_at ? new Date(row.read_at) : null
    }));

    res.json({
      success: true,
      data: notifications
    });
  } catch (error: any) {
    console.error('Error fetching admin notifications:', error);
    next(error);
  }
};

/**
 * Mark notification as read
 */
export const markNotificationAsRead = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    
    await pool.query(
      `UPDATE admin_notifications 
       SET is_read = TRUE, read_at = CURRENT_TIMESTAMP 
       WHERE id = $1`,
      [id]
    );

    res.json({
      success: true,
      message: 'Notification marked as read'
    });
  } catch (error: any) {
    console.error('Error marking notification as read:', error);
    next(error);
  }
};

/**
 * Mark all notifications as read
 */
export const markAllNotificationsAsRead = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    await pool.query(
      `UPDATE admin_notifications 
       SET is_read = TRUE, read_at = CURRENT_TIMESTAMP 
       WHERE is_read = FALSE`
    );

    res.json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error: any) {
    console.error('Error marking all notifications as read:', error);
    next(error);
  }
};

export const getGlobalSettings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // Try to get settings from global_settings table
    let settings = null;
    try {
      const result = await pool.query(
        `SELECT value::jsonb FROM global_settings WHERE key = 'admin_global_settings'`
      );
      if (result.rows.length > 0 && result.rows[0].value) {
        settings = result.rows[0].value;
      }
    } catch (err) {
      console.warn('Could not fetch global settings from database:', err);
    }

    // Default settings
    const defaultSettings = {
      trialDays: 7,
      trialAiLimit: 200,
      defaultAiModel: 'OpenAI GPT-4o mini',
      features: {
        affiliateEnabled: true,
        landingBotEnabled: true,
        dashboardBotEnabled: true,
        productsBotEnabled: true,
        servicesBotEnabled: true
      },
      bots: {
        productsBot: {
          enabled: true,
          systemMessage: PRODUCT_BOT_SYSTEM_PROMPT
        },
        servicesBot: {
          enabled: true,
          systemMessage: SERVICE_BOT_SYSTEM_PROMPT
        }
      },
      paymentMethods: {
        shamCash: {
          enabled: true,
          walletAddress: '',
          qrImageUrl: '',
          instructions: 'حوّل المبلغ إلى عنوان محفظة شام كاش ثم ارفع إثبات التحويل (صورة أو PDF).'
        },
        usdt: {
          enabled: true,
          walletAddress: '',
          qrImageUrl: '',
          network: 'TRC20',
          instructions: 'حوّل المبلغ بـ USDT إلى عنوان المحفظة ثم ارفع إثبات التحويل (صورة أو PDF).'
        }
      }
    };

    // Merge with saved settings (deep merge for nested objects)
    const finalSettings = settings ? {
      ...defaultSettings,
      ...settings,
      features: {
        ...defaultSettings.features,
        ...(settings.features || {})
      },
      bots: {
        productsBot: {
          ...defaultSettings.bots.productsBot,
          ...(settings.bots?.productsBot || {})
        },
        servicesBot: {
          ...defaultSettings.bots.servicesBot,
          ...(settings.bots?.servicesBot || {})
        }
      },
      paymentMethods: {
        shamCash: {
          ...defaultSettings.paymentMethods.shamCash,
          ...(settings.paymentMethods?.shamCash || {})
        },
        usdt: {
          ...defaultSettings.paymentMethods.usdt,
          ...(settings.paymentMethods?.usdt || {})
        }
      }
    } : defaultSettings;

    res.json({
      success: true,
      data: finalSettings
    });
  } catch (error) {
    next(error);
  }
};

export const updateGlobalSettings = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const settings = req.body;

    // Ensure global_settings table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS global_settings (
        key VARCHAR(255) PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Update System Messages in geminiService.ts if bots settings are provided
    if (settings.bots) {
      try {
        if (settings.bots.productsBot?.systemMessage) {
          await updateGeminiServicePrompt('productsBot', settings.bots.productsBot.systemMessage);
        }
        if (settings.bots.servicesBot?.systemMessage) {
          await updateGeminiServicePrompt('servicesBot', settings.bots.servicesBot.systemMessage);
        }
      } catch (fileUpdateError: any) {
        console.error('Error updating geminiService.ts:', fileUpdateError);
        // Continue with database update even if file update fails
        // We don't want to block the settings save if file update fails
      }
    }

    // Update or insert settings
    await pool.query(
      `INSERT INTO global_settings (key, value, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (key) 
       DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
      ['admin_global_settings', JSON.stringify(settings)]
    );

    res.json({
      success: true,
      message: 'Settings updated successfully',
      data: settings
    });
  } catch (error: any) {
    console.error('Error updating global settings:', error);
    next(error);
  }
};

/**
 * Get email recipient count based on type
 */
export const getEmailRecipientCount = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { type } = req.query;

    let query = '';
    let params: any[] = [];

    switch (type) {
      case 'all':
        query = `SELECT COUNT(*)::int as count FROM merchants WHERE role NOT IN ('owner', 'admin') OR role IS NULL`;
        break;
      case 'active':
        query = `SELECT COUNT(*)::int as count 
                 FROM merchants 
                 WHERE (role NOT IN ('owner', 'admin') OR role IS NULL)
                 AND subscription_status = 'active'`;
        break;
      case 'trial':
        query = `SELECT COUNT(*)::int as count 
                 FROM merchants 
                 WHERE (role NOT IN ('owner', 'admin') OR role IS NULL)
                 AND subscription_plan = 'trial'`;
        break;
      case 'paid':
        query = `SELECT COUNT(*)::int as count 
                 FROM merchants 
                 WHERE (role NOT IN ('owner', 'admin') OR role IS NULL)
                 AND subscription_plan IN ('comments', 'single', 'social', 'yearly', 'starter', 'pro', 'business')
                 AND subscription_status = 'active'`;
        break;
      default:
        return res.status(400).json({
          success: false,
          error: { message: 'Invalid recipient type' }
        });
    }

    const result = await pool.query(query, params);
    const count = result.rows[0]?.count || 0;

    res.json({
      success: true,
      data: count
    });
  } catch (error: any) {
    console.error('Error getting email recipient count:', error);
    next(error);
  }
};

/**
 * Search merchant emails for custom broadcast recipients (typeahead)
 */
export const searchEmailRecipients = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const rawQ = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!rawQ) {
      return res.json({ success: true, data: [] });
    }

    // Cap pattern length to avoid pathological LIKE queries
    const q = rawQ.slice(0, 100);
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '20'), 10) || 20, 1), 50);

    const result = await pool.query(
      `SELECT email, name
       FROM merchants
       WHERE email IS NOT NULL
         AND TRIM(email) <> ''
         AND (role NOT IN ('owner', 'admin') OR role IS NULL)
         AND (
           email ILIKE $1
           OR COALESCE(name, '') ILIKE $1
         )
       ORDER BY
         CASE WHEN email ILIKE $2 THEN 0 ELSE 1 END,
         email ASC
       LIMIT $3`,
      [`%${q}%`, `${q}%`, limit]
    );

    res.json({
      success: true,
      data: result.rows.map((row) => ({
        email: row.email as string,
        name: (row.name as string) || null,
      })),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Send email broadcast
 */
export const sendEmailBroadcast = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { subject, message, recipientType, customEmails, isHtml } = req.body;

    if (!subject || !message) {
      return res.status(400).json({
        success: false,
        error: { message: 'Subject and message are required' }
      });
    }

    let recipientEmails: string[] = [];

    if (recipientType === 'custom') {
      if (!customEmails || !Array.isArray(customEmails) || customEmails.length === 0) {
        return res.status(400).json({
          success: false,
          error: { message: 'Custom emails list is required' }
        });
      }
      recipientEmails = customEmails;
    } else {
      let query = '';
      switch (recipientType) {
        case 'all':
          query = `SELECT email FROM merchants WHERE (role NOT IN ('owner', 'admin') OR role IS NULL) AND email IS NOT NULL`;
          break;
        case 'active':
          query = `SELECT email FROM merchants 
                   WHERE (role NOT IN ('owner', 'admin') OR role IS NULL)
                   AND subscription_status = 'active' 
                   AND email IS NOT NULL`;
          break;
        case 'trial':
          query = `SELECT email FROM merchants 
                   WHERE (role NOT IN ('owner', 'admin') OR role IS NULL)
                   AND subscription_plan = 'trial' 
                   AND email IS NOT NULL`;
          break;
        case 'paid':
          query = `SELECT email FROM merchants 
                   WHERE (role NOT IN ('owner', 'admin') OR role IS NULL)
                   AND subscription_plan IN ('comments', 'single', 'social', 'yearly', 'starter', 'pro', 'business')
                   AND subscription_status = 'active' 
                   AND email IS NOT NULL`;
          break;
        default:
          return res.status(400).json({
            success: false,
            error: { message: 'Invalid recipient type' }
          });
      }

      const result = await pool.query(query);
      recipientEmails = result.rows.map(row => row.email).filter(Boolean);
    }

    if (recipientEmails.length === 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'No recipients found' }
      });
    }

    // Import email service
    const { sendBroadcastEmail } = await import('../utils/emailService.js');
    const result = await sendBroadcastEmail(
      recipientEmails,
      subject,
      message,
      isHtml !== false
    );

    res.json({
      success: result.sent > 0,
      data: {
        sent: result.sent,
        failed: result.failed,
        errors: result.errors
      }
    });
  } catch (error: any) {
    console.error('Error sending email broadcast:', error);
    next(error);
  }
};

/**
 * Get notification recipient count based on type
 */
export const getNotificationRecipientCount = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { type } = req.query;

    let query = '';
    let params: any[] = [];

    switch (type) {
      case 'all':
        query = `SELECT COUNT(*)::int as count FROM merchants WHERE role NOT IN ('owner', 'admin') OR role IS NULL`;
        break;
      case 'active':
        query = `SELECT COUNT(*)::int as count 
                 FROM merchants 
                 WHERE (role NOT IN ('owner', 'admin') OR role IS NULL)
                 AND subscription_status = 'active'`;
        break;
      case 'trial':
        query = `SELECT COUNT(*)::int as count 
                 FROM merchants 
                 WHERE (role NOT IN ('owner', 'admin') OR role IS NULL)
                 AND subscription_plan = 'trial'`;
        break;
      case 'paid':
        query = `SELECT COUNT(*)::int as count 
                 FROM merchants 
                 WHERE (role NOT IN ('owner', 'admin') OR role IS NULL)
                 AND subscription_plan IN ('comments', 'single', 'social', 'yearly', 'starter', 'pro', 'business')
                 AND subscription_status = 'active'`;
        break;
      default:
        return res.status(400).json({
          success: false,
          error: { message: 'Invalid recipient type' }
        });
    }

    const result = await pool.query(query, params);
    const count = result.rows[0]?.count || 0;

    res.json({
      success: true,
      data: count
    });
  } catch (error: any) {
    console.error('Error getting notification recipient count:', error);
    next(error);
  }
};

/**
 * Send user notifications
 */
export const sendUserNotification = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { title, message, type, recipientType, customUserIds, data } = req.body;

    if (!title || !message) {
      return res.status(400).json({
        success: false,
        error: { message: 'Title and message are required' }
      });
    }

    // Ensure user_notifications table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_notifications (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL DEFAULT 'info',
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        data JSONB,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        read_at TIMESTAMP
      )
    `);

    let recipientIds: string[] = [];

    if (recipientType === 'custom') {
      if (!customUserIds || !Array.isArray(customUserIds) || customUserIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: { message: 'Custom user IDs list is required' }
        });
      }
      recipientIds = customUserIds;
    } else {
      let query = '';
      switch (recipientType) {
        case 'all':
          query = `SELECT id FROM merchants WHERE (role NOT IN ('owner', 'admin') OR role IS NULL)`;
          break;
        case 'active':
          query = `SELECT id FROM merchants 
                   WHERE (role NOT IN ('owner', 'admin') OR role IS NULL)
                   AND subscription_status = 'active'`;
          break;
        case 'trial':
          query = `SELECT id FROM merchants 
                   WHERE (role NOT IN ('owner', 'admin') OR role IS NULL)
                   AND subscription_plan = 'trial'`;
          break;
        case 'paid':
          query = `SELECT id FROM merchants 
                   WHERE (role NOT IN ('owner', 'admin') OR role IS NULL)
                   AND subscription_plan IN ('comments', 'single', 'social', 'yearly', 'starter', 'pro', 'business')
                   AND subscription_status = 'active'`;
          break;
        default:
          return res.status(400).json({
            success: false,
            error: { message: 'Invalid recipient type' }
          });
      }

      const result = await pool.query(query);
      recipientIds = result.rows.map(row => String(row.id));
    }

    if (recipientIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: { message: 'No recipients found' }
      });
    }

    // Insert notifications in batches
    const batchSize = 100;
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    console.log(`sendUserNotification: Sending to ${recipientIds.length} recipients`);
    
    for (let i = 0; i < recipientIds.length; i += batchSize) {
      const batch = recipientIds.slice(i, i + batchSize);
      
      for (const merchantId of batch) {
        try {
          const notificationId = await createMerchantNotification({
            merchantId,
            type: (type || 'info') as MerchantNotificationType,
            title,
            message,
            data: data && typeof data === 'object' ? data : { kind: 'admin_broadcast' },
          });
          if (!notificationId) {
            throw new Error('Failed to create notification');
          }
          console.log(`sendUserNotification: Created notification ${notificationId} for merchant ${merchantId}`);
          sent++;
        } catch (error: any) {
          console.error(`sendUserNotification: Failed to create notification for merchant ${merchantId}:`, error);
          failed++;
          errors.push(`${merchantId}: ${error.message || 'Unknown error'}`);
        }
      }
    }
    
    console.log(`sendUserNotification: Result - sent: ${sent}, failed: ${failed}`);

    res.json({
      success: sent > 0,
      data: {
        sent,
        failed,
        errors: errors.slice(0, 10) // Limit errors to first 10
      }
    });
  } catch (error: any) {
    console.error('Error sending user notifications:', error);
    next(error);
  }
};

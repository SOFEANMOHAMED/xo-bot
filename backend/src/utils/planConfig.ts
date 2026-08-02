import pool from '../database/connection.js';
import {
  DEFAULT_PLAN_CONFIGS,
  type PaidPlanKey,
  isPaidPlanKey
} from './planDefinitions.js';

/**
 * Helper function to get plan config from database or defaults
 */
export async function getPlanConfig(planKey: string): Promise<{
  name: string;
  price: number;
  features: string[];
  billingPeriod: 'monthly' | 'yearly';
  description: string;
}> {
  try {
    const result = await pool.query(
      `SELECT value::jsonb FROM global_settings WHERE key = $1`,
      [`plan_${planKey}`]
    );

    if (result.rows.length > 0 && result.rows[0].value) {
      const config = result.rows[0].value;
      const defaults = getDefaultPlanBundle(planKey);
      return {
        name: config.name || defaults.name,
        price: typeof config.price === 'number' ? config.price : defaults.price,
        features: Array.isArray(config.features) && config.features.length > 0
          ? config.features
          : defaults.features,
        billingPeriod: config.billingPeriod === 'yearly' ? 'yearly' : defaults.billingPeriod,
        description: config.description || defaults.description
      };
    }
  } catch (err) {
    console.warn(`Could not fetch plan config for ${planKey}:`, err);
  }

  return getDefaultPlanBundle(planKey);
}

function getDefaultPlanBundle(planKey: string) {
  if (isPaidPlanKey(planKey)) {
    return DEFAULT_PLAN_CONFIGS[planKey];
  }
  // Legacy display fallbacks
  const legacy: Record<string, (typeof DEFAULT_PLAN_CONFIGS)[PaidPlanKey]> = {
    starter: DEFAULT_PLAN_CONFIGS.comments,
    pro: DEFAULT_PLAN_CONFIGS.single,
    business: DEFAULT_PLAN_CONFIGS.social
  };
  return (
    legacy[planKey] || {
      name: planKey,
      price: 0,
      features: [],
      billingPeriod: 'monthly' as const,
      description: ''
    }
  );
}

/**
 * Calculate commission amount for a plan (30% of plan price)
 */
export async function calculateCommission(planKey: string): Promise<number> {
  if (planKey === 'trial') {
    return 0;
  }

  const planConfig = await getPlanConfig(planKey);
  return planConfig.price * 0.3;
}

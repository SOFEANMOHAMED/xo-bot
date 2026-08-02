/**
 * Seed / refresh subscription plans in global_settings.
 * Run: cd backend && npx tsx src/database/migrations/seed_subscription_plans.ts
 */
import pool from '../connection.js';
import {
  DEFAULT_PLAN_CONFIGS,
  DEFAULT_PLAN_LIMITS,
  PAID_PLAN_KEYS
} from '../../utils/planDefinitions.js';

async function seed() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS global_settings (
      key VARCHAR(255) PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  for (const key of PAID_PLAN_KEYS) {
    const config = DEFAULT_PLAN_CONFIGS[key];
    const limits = DEFAULT_PLAN_LIMITS[key];

    await pool.query(
      `INSERT INTO global_settings (key, value, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (key)
       DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
      [`plan_${key}`, JSON.stringify(config)]
    );

    await pool.query(
      `INSERT INTO global_settings (key, value, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (key)
       DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
      [`plan_limits_${key}`, JSON.stringify(limits)]
    );

    console.log(`✓ Seeded plan_${key} @ $${config.price} (${config.billingPeriod})`);
  }

  // Trial limits
  await pool.query(
    `INSERT INTO global_settings (key, value, updated_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT (key)
     DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
    [`plan_limits_trial`, JSON.stringify(DEFAULT_PLAN_LIMITS.trial)]
  );
  console.log('✓ Seeded plan_limits_trial');

  await pool.end();
  console.log('Done.');
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});

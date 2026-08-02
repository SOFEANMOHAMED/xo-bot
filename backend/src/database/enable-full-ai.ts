/**
 * Enable Full AI Mode for a merchant
 * Run: npm run enable-full-ai
 */

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const MERCHANT_ID = '231ddf1d-c35f-48c0-82f5-72f896e8404e'; // Replace with your merchant ID

async function enableFullAI() {
  console.log('🤖 Enabling Full AI Mode...');
  
  try {
    // Update bot config to enable full AI mode
    const result = await pool.query(`
      UPDATE bots
      SET bot_config = COALESCE(bot_config, '{}'::jsonb) || '{"use_full_ai_mode": true}'::jsonb
      WHERE merchant_id = $1
      RETURNING id, name, bot_config
    `, [MERCHANT_ID]);
    
    if (result.rows.length === 0) {
      console.error('❌ No bot found for merchant:', MERCHANT_ID);
      process.exit(1);
    }
    
    console.log('✅ Full AI Mode enabled successfully!');
    console.log('📋 Bot Config:', result.rows[0].bot_config);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error enabling full AI mode:', error);
    process.exit(1);
  }
}

enableFullAI();

/**
 * Run migration to create telegram_bots table
 * This script can be run manually or via npm script
 */

import pool from '../connection.js';
import crypto from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Starting telegram_bots table migration...');

    // Read migration SQL file (table creation only)
    const migrationPath = join(__dirname, 'create_telegram_bots_table.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf-8');

    // Execute migration (creates table)
    await client.query(migrationSQL);

    console.log('✅ telegram_bots table created');

    // Migrate existing bots from merchant_settings
    console.log('Migrating existing bots from merchant_settings...');
    
    // Check if telegram_webhook_secret column exists
    const columnCheck = await client.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'merchant_settings' AND column_name = 'telegram_webhook_secret'
      ) as exists
    `);
    
    const hasWebhookSecretColumn = columnCheck.rows[0]?.exists || false;
    
    let merchantsQuery: string;
    if (hasWebhookSecretColumn) {
      merchantsQuery = `
        SELECT merchant_id, telegram_bot_token, telegram_webhook_secret 
        FROM merchant_settings 
        WHERE telegram_bot_token IS NOT NULL AND telegram_bot_token != ''
      `;
    } else {
      merchantsQuery = `
        SELECT merchant_id, telegram_bot_token
        FROM merchant_settings 
        WHERE telegram_bot_token IS NOT NULL AND telegram_bot_token != ''
      `;
    }
    
    const merchantsResult = await client.query(merchantsQuery);
    
    let migratedCount = 0;
    for (const merchant of merchantsResult.rows) {
      // Generate webhook secret
      let webhookSecret: string;
      if (hasWebhookSecretColumn && merchant.telegram_webhook_secret) {
        webhookSecret = merchant.telegram_webhook_secret;
      } else {
        webhookSecret = crypto.randomBytes(32).toString('hex');
      }
      
      // Insert into telegram_bots (ON CONFLICT DO NOTHING to avoid duplicates)
      try {
        await client.query(`
          INSERT INTO telegram_bots (merchant_id, bot_token, webhook_secret, bot_type, is_active)
          VALUES ($1, $2, $3, 'both', true)
          ON CONFLICT DO NOTHING
        `, [merchant.merchant_id, merchant.telegram_bot_token, webhookSecret]);
        
        migratedCount++;
      } catch (error: any) {
        // Skip if already exists
        if (error.code !== '23505') { // Unique violation
          console.warn(`Warning: Could not migrate bot for merchant ${merchant.merchant_id}:`, error.message);
        }
      }
    }
    
    console.log(`✅ Migration completed successfully!`);
    console.log(`✅ Migrated ${migratedCount} bot(s) from merchant_settings`);

    process.exit(0);
  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();


/**
 * Run migration: add ai_mode column to merchant_settings
 * Safe to run multiple times (IF NOT EXISTS).
 * Usage: npx tsx backend/src/database/migrations/run_ai_mode_migration.ts
 * Or from backend: npx tsx src/database/migrations/run_ai_mode_migration.ts
 */

import pool from '../connection.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function run() {
  try {
    const sql = readFileSync(join(__dirname, 'add_ai_mode_to_merchant_settings.sql'), 'utf-8');
    await pool.query(sql);
    console.log('✅ ai_mode column added to merchant_settings (or already exists)');
  } catch (e) {
    console.error('Migration failed:', e);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();

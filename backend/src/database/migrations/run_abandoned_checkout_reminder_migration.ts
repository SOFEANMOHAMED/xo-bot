/**
 * Run migration: abandoned checkout reminder settings
 * Usage: npm run migrate-abandoned-checkout
 */

import pool from '../connection.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function run() {
  try {
    const sql = readFileSync(join(__dirname, 'add_abandoned_checkout_reminder.sql'), 'utf-8');
    await pool.query(sql);
    console.log('✅ Abandoned checkout reminder columns ready on merchant_settings');
  } catch (e) {
    console.error('Migration failed:', e);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();

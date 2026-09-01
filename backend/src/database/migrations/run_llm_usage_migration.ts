/**
 * Run migration: llm_usage_events ledger
 * Usage: npm run migrate-llm-usage
 */

import pool from '../connection.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function run() {
  try {
    const sql = readFileSync(join(__dirname, 'add_llm_usage_events.sql'), 'utf-8');
    await pool.query(sql);
    console.log('✅ llm_usage_events table ready');
  } catch (e) {
    console.error('Migration failed:', e);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();

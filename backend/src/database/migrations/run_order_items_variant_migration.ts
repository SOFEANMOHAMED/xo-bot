/**
 * Add color/size on order_items so the merchant dashboard can show variants
 * on the product line instead of stuffing them into notes.
 * Usage: npx tsx src/database/migrations/run_order_items_variant_migration.ts
 */

import pool from '../connection.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function run() {
  try {
    const sql = readFileSync(join(__dirname, 'add_order_items_variant.sql'), 'utf-8');
    await pool.query(sql);
    console.log('✅ order_items.color and order_items.size are ready');
  } catch (e) {
    console.error('Migration failed:', e);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();

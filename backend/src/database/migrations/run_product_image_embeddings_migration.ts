/**
 * Run migration: product_image_embeddings (CLIP visual matching)
 * Usage: cd backend && npm run migrate-product-image-embeddings
 */

import pool from '../connection.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function run() {
  try {
    const sql = readFileSync(join(__dirname, 'add_product_image_embeddings.sql'), 'utf-8');
    await pool.query(sql);
    console.log('✅ product_image_embeddings table ready');
  } catch (e) {
    console.error('Migration failed:', e);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();

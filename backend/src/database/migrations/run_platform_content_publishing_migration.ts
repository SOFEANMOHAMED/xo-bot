/**
 * Run migration: platform (super-admin) content publishing tables
 * Usage: npm run migrate-platform-content-publishing
 */

import pool from '../connection.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function run() {
  try {
    const sql = readFileSync(join(__dirname, 'add_platform_content_publishing.sql'), 'utf-8');
    await pool.query(sql);
    console.log('✅ Platform content publishing tables ready');
  } catch (e) {
    console.error('Migration failed:', e);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();

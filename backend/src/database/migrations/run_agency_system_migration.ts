/**
 * Run migration: agency seats system
 * Usage: npm run migrate-agency-system
 */

import pool from '../connection.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function run() {
  try {
    const sql = readFileSync(join(__dirname, 'add_agency_system.sql'), 'utf-8');
    await pool.query(sql);
    console.log('✅ agency system tables ready');
  } catch (e) {
    console.error('Migration failed:', e);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();

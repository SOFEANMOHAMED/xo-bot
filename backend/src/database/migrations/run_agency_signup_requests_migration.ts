/**
 * Run migration: agency signup requests
 * Usage: npm run migrate-agency-signup-requests
 */

import pool from '../connection.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function run() {
  try {
    const sql = readFileSync(join(__dirname, 'add_agency_signup_requests.sql'), 'utf-8');
    await pool.query(sql);
    console.log('✅ agency_signup_requests table ready');
  } catch (e) {
    console.error('Migration failed:', e);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();

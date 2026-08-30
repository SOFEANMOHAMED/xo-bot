/**
 * Usage: npm run migrate-social-story-content
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import pool from '../connection.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function run() {
  try {
    const sql = readFileSync(join(__dirname, 'add_social_story_content.sql'), 'utf-8');
    await pool.query(sql);
    console.log('Social story content columns / constraints ready');
  } catch (e) {
    console.error('Migration failed:', e);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();

/**
 * Migration: create `pages` table and seed default legal pages (privacy, terms).
 * Run once if public CMS pages return 500 / "relation pages does not exist".
 */

import pool from '../connection.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  const client = await pool.connect();

  try {
    console.log('Starting pages table migration...');

    const sqlPath = path.join(__dirname, '..', 'create-pages-table.sql');
    const sql = fs.readFileSync(sqlPath, 'utf-8');

    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');

    console.log('Pages table migration completed successfully.');

    const verify = await client.query(
      `SELECT slug, title FROM pages WHERE slug IN ('privacy-policy', 'terms-of-service') ORDER BY slug`
    );
    console.log('Rows:', verify.rows);
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    const message = error instanceof Error ? error.message : String(error);
    console.error('Migration failed:', message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();

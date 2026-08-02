/**
 * Migration Script: Add Google OAuth Support
 * Adds google_id and auth_provider columns to merchants table
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
    console.log('🔄 Starting Google OAuth migration...');
    
    // Read SQL file
    const sqlPath = path.join(__dirname, '0003_add_google_oauth_support.sql');
    const sql = fs.readFileSync(sqlPath, 'utf-8');
    
    // Execute migration
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    
    console.log('✅ Google OAuth migration completed successfully!');
    
    // Verify columns exist
    const verifyResult = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'merchants' 
      AND column_name IN ('google_id', 'auth_provider')
      ORDER BY column_name
    `);
    
    console.log('\n📋 Verification:');
    verifyResult.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable}, default: ${row.column_default || 'none'})`);
    });
    
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();


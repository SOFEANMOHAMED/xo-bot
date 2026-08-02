/**
 * Migration Script: Add viewed_at column to orders table
 * This allows tracking which orders have been viewed by the merchant
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
    console.log('🔄 Starting orders viewed_at migration...');
    
    // Read SQL file
    const sqlPath = path.join(__dirname, 'add_orders_viewed_at.sql');
    const sql = fs.readFileSync(sqlPath, 'utf-8');
    
    // Execute migration
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    
    console.log('✅ Orders viewed_at migration completed successfully!');
    
    // Verify column exists
    const verifyResult = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'orders' 
      AND column_name = 'viewed_at'
    `);
    
    if (verifyResult.rows.length > 0) {
      console.log('\n📋 Verification:');
      const row = verifyResult.rows[0];
      console.log(`  - ${row.column_name}: ${row.data_type} (nullable: ${row.is_nullable})`);
      console.log('✅ Column viewed_at exists in orders table');
    } else {
      console.log('⚠️  Warning: Could not verify column viewed_at');
    }
    
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


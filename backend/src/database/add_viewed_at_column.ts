/**
 * Script to add viewed_at column to orders table
 * Run with: tsx src/database/add_viewed_at_column.ts
 */

import pool from './connection.js';

async function addViewedAtColumn() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Adding viewed_at column to orders table...');
    
    // Check if column already exists
    const checkResult = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'orders' 
      AND column_name = 'viewed_at'
    `);
    
    if (checkResult.rows.length > 0) {
      console.log('✅ Column viewed_at already exists in orders table');
      return;
    }
    
    // Add the column
    await client.query('BEGIN');
    await client.query(`
      ALTER TABLE orders 
      ADD COLUMN viewed_at TIMESTAMP
    `);
    await client.query('COMMIT');
    
    console.log('✅ Column viewed_at added successfully!');
    
    // Verify
    const verifyResult = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = 'orders' 
      AND column_name = 'viewed_at'
    `);
    
    if (verifyResult.rows.length > 0) {
      const row = verifyResult.rows[0];
      console.log(`\n📋 Verification:`);
      console.log(`  - Column: ${row.column_name}`);
      console.log(`  - Type: ${row.data_type}`);
      console.log(`  - Nullable: ${row.is_nullable}`);
      console.log('✅ Column verified successfully!');
    }
    
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to add column:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

addViewedAtColumn();


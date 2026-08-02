/**
 * Migration: Add colors column to products table
 * This script adds the colors column if it doesn't exist
 */

import pool from './connection.js';
import { logger } from '../utils/logger.js';

async function addColorsColumn() {
  const client = await pool.connect();
  
  try {
    logger.info('Starting migration: Add colors column to products table');
    
    // Check if column exists
    const checkResult = await client.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'products' AND column_name = 'colors'
    `);
    
    if (checkResult.rows.length > 0) {
      logger.info('✅ Colors column already exists, skipping migration');
      console.log('✅ Colors column already exists');
      return;
    }
    
    // Add colors column
    await client.query(`
      ALTER TABLE products
      ADD COLUMN colors TEXT[];
    `);
    
    logger.info('✅ Successfully added colors column to products table');
    console.log('✅ Successfully added colors column to products table');
    
  } catch (error) {
    logger.error('❌ Error adding colors column', error as Error);
    console.error('❌ Error adding colors column:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run migration
addColorsColumn()
  .then(() => {
    console.log('✅ Migration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  });

/**
 * Migration script to add role column to merchants table
 * Run with: node src/database/add-role-migration.mjs
 */

import dotenv from 'dotenv';
import pg from 'pg';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '../../../.env') });

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'xobot_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

async function addRoleColumn() {
  try {
    console.log('🔧 Adding role column to merchants table...\n');

    // Check if role column exists
    console.log('🔍 Checking if role column exists...');
    const checkResult = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='merchants' AND column_name='role';
    `);

    if (checkResult.rows.length > 0) {
      console.log('✅ Role column already exists\n');
      process.exit(0);
    }

    // Add role column
    console.log('📝 Adding role column...');
    await pool.query(`
      ALTER TABLE merchants 
      ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user' 
      CHECK (role IN ('owner', 'admin', 'user'));
    `);

    // Create index
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_merchants_role ON merchants(role);
    `);

    console.log('✅ Role column added successfully!\n');
    console.log('✅ Migration complete!');
    console.log('💡 You can now create a super admin using create-super-admin.ts\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

addRoleColumn();


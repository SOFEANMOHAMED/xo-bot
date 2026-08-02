/**
 * Run migration to add hybrid orchestrator support
 * This script adds last_error column and ensures all required columns exist
 */

import pool from '../connection.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('Starting hybrid orchestrator migration...');

    // Read migration SQL file
    const migrationPath = join(__dirname, '0002_add_hybrid_orchestrator_support.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf-8');

    // Execute migration
    await client.query(migrationSQL);

    console.log('✅ Hybrid orchestrator columns added successfully');

    // Verify migration
    console.log('Verifying migration...');
    
    // Check conversations table
    const convCheck = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'conversations' 
        AND column_name IN ('conversation_state', 'current_intent', 'session_metadata', 'stage', 'last_error')
      ORDER BY column_name
    `);
    
    console.log('Conversations table columns:', convCheck.rows);
    
    const requiredConvColumns = ['conversation_state', 'current_intent', 'session_metadata', 'stage', 'last_error'];
    const foundConvColumns = convCheck.rows.map(r => r.column_name);
    const missingConvColumns = requiredConvColumns.filter(col => !foundConvColumns.includes(col));
    
    if (missingConvColumns.length > 0) {
      throw new Error(`Missing conversation columns: ${missingConvColumns.join(', ')}`);
    }
    
    // Check messages table
    const msgCheck = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'messages' 
        AND column_name IN ('metadata', 'intent', 'entities')
      ORDER BY column_name
    `);
    
    console.log('Messages table columns:', msgCheck.rows);
    
    const requiredMsgColumns = ['metadata', 'intent', 'entities'];
    const foundMsgColumns = msgCheck.rows.map(r => r.column_name);
    const missingMsgColumns = requiredMsgColumns.filter(col => !foundMsgColumns.includes(col));
    
    if (missingMsgColumns.length > 0) {
      throw new Error(`Missing message columns: ${missingMsgColumns.join(', ')}`);
    }
    
    // Check composite index
    const indexCheck = await client.query(`
      SELECT indexname
      FROM pg_indexes 
      WHERE tablename = 'conversations'
        AND indexname = 'idx_conversations_merchant_platform_user'
    `);
    
    if (indexCheck.rows.length === 0) {
      console.warn('⚠️  Composite index idx_conversations_merchant_platform_user not found');
    } else {
      console.log('✅ Composite index created');
    }
    
    console.log('✅ Migration completed successfully!');

    process.exit(0);
  } catch (error: any) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();


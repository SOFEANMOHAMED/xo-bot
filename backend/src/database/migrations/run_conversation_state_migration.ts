/**
 * Run migration to add conversation state columns
 * This script adds support for smart sales bot state tracking
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
    console.log('Starting conversation state migration...');

    // Read migration SQL file
    const migrationPath = join(__dirname, 'add_conversation_state.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf-8');

    // Execute migration
    await client.query(migrationSQL);

    console.log('✅ Conversation state columns added successfully');

    // Verify migration
    console.log('Verifying migration...');
    
    // Check conversations table
    const convCheck = await client.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns 
      WHERE table_name = 'conversations' 
        AND column_name IN ('conversation_state', 'current_intent', 'session_metadata', 'stage')
      ORDER BY column_name
    `);
    
    console.log('Conversations table columns:', convCheck.rows);
    
    if (convCheck.rows.length !== 4) {
      throw new Error('Not all conversation columns were added');
    }
    
    // Check messages table
    const msgCheck = await client.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns 
      WHERE table_name = 'messages' 
        AND column_name IN ('metadata', 'intent', 'entities')
      ORDER BY column_name
    `);
    
    console.log('Messages table columns:', msgCheck.rows);
    
    if (msgCheck.rows.length !== 3) {
      throw new Error('Not all message columns were added');
    }
    
    // Check indexes
    const indexCheck = await client.query(`
      SELECT indexname
      FROM pg_indexes 
      WHERE tablename IN ('conversations', 'messages')
        AND indexname IN (
          'idx_conversations_state_gin',
          'idx_conversations_current_intent',
          'idx_conversations_stage',
          'idx_messages_entities_gin',
          'idx_messages_intent'
        )
    `);
    
    console.log('Indexes created:', indexCheck.rows.map(r => r.indexname));
    
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


import pool from '../database/connection.js';
import { logger } from '../utils/logger.js';

/**
 * Add attachments column to support_ticket_replies table
 */
async function addAttachmentsColumn() {
  try {
    console.log('Adding attachments column to support_ticket_replies table...');

    await pool.query(`
      ALTER TABLE support_ticket_replies 
      ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;
    `);

    await pool.query(`
      COMMENT ON COLUMN support_ticket_replies.attachments IS 'Array of attachment objects with url, filename, mimetype, size';
    `);

    console.log('✅ Attachments column added successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error adding attachments column:', error);
    process.exit(1);
  }
}

addAttachmentsColumn();


import pool from '../database/connection.js';
import { logger } from '../utils/logger.js';

/**
 * Create support_ticket_replies table
 * Run this script to create the support ticket replies table in the database
 */
async function createSupportRepliesTable() {
  try {
    console.log('Creating support_ticket_replies table...');

    // Create table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS support_ticket_replies (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
        sender_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        sender_type VARCHAR(20) NOT NULL CHECK (sender_type IN ('user', 'admin')),
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create indexes
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_support_replies_ticket_id ON support_ticket_replies(ticket_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_support_replies_created_at ON support_ticket_replies(created_at DESC);
    `);

    // Add comment
    await pool.query(`
      COMMENT ON TABLE support_ticket_replies IS 'Replies to support tickets from users and admins';
    `);

    console.log('✅ Support ticket replies table created successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating support_ticket_replies table:', error);
    process.exit(1);
  }
}

createSupportRepliesTable();


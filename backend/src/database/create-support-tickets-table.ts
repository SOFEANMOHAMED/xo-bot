import pool from '../database/connection.js';
import { logger } from '../utils/logger.js';

/**
 * Create support_tickets table
 * Run this script to create the support tickets table in the database
 */
async function createSupportTicketsTable() {
  try {
    console.log('Creating support_tickets table...');

    // Create table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        subject VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        status VARCHAR(50) DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
        priority VARCHAR(50) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
        admin_response TEXT,
        admin_id UUID REFERENCES merchants(id) ON DELETE SET NULL,
        resolved_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Create indexes
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_support_tickets_merchant_id ON support_tickets(merchant_id);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_support_tickets_created_at ON support_tickets(created_at DESC);
    `);

    // Add comment
    await pool.query(`
      COMMENT ON TABLE support_tickets IS 'Support tickets from users to admins';
    `);

    console.log('✅ Support tickets table created successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating support_tickets table:', error);
    process.exit(1);
  }
}

createSupportTicketsTable();


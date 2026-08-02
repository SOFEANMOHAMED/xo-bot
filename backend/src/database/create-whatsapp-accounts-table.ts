import pool from './connection.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function createWhatsAppAccountsTable() {
  try {
    const sqlPath = path.join(__dirname, 'create-whatsapp-accounts-table.sql');
    const sql = fs.readFileSync(sqlPath, 'utf-8');
    
    await pool.query(sql);
    
    logger.info('WhatsApp accounts table created successfully');
    console.log('✅ WhatsApp accounts table created successfully');
  } catch (error: any) {
    if (error.code === '42P07') {
      logger.info('WhatsApp accounts table already exists');
      console.log('ℹ️  WhatsApp accounts table already exists');
    } else {
      logger.error('Error creating WhatsApp accounts table', error);
      console.error('❌ Error creating WhatsApp accounts table:', error.message);
      throw error;
    }
  } finally {
    await pool.end();
  }
}

createWhatsAppAccountsTable();


import pool from './connection.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function createCustomersTable() {
  try {
    const sqlPath = path.join(__dirname, 'create-customers-table.sql');
    const sql = fs.readFileSync(sqlPath, 'utf-8');
    
    await pool.query(sql);
    
    logger.info('Customers tables created successfully');
    console.log('✅ Customers tables created successfully');
  } catch (error: any) {
    if (error.code === '42P07') {
      logger.info('Customers tables already exist');
      console.log('ℹ️  Customers tables already exist');
    } else {
      logger.error('Error creating customers tables', error);
      console.error('❌ Error creating customers tables:', error.message);
      throw error;
    }
  } finally {
    await pool.end();
  }
}

createCustomersTable();


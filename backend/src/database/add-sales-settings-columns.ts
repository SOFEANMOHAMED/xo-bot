import { readFileSync } from 'fs';
import { join } from 'path';
import pool from '../database/connection.js';

async function addSalesSettingsColumns() {
  try {
    const sqlPath = join(process.cwd(), 'src', 'database', 'add-sales-settings-columns.sql');
    const sql = readFileSync(sqlPath, 'utf-8');
    
    await pool.query(sql);
    
    console.log('✅ Successfully added sales settings columns to merchant_settings table');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error adding sales settings columns:', error);
    process.exit(1);
  }
}

addSalesSettingsColumns();


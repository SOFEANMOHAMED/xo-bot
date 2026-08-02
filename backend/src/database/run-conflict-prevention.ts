import fs from 'fs';
import path from 'path';
import pool from './connection.js';

async function runSQL() {
  try {
    const sqlPath = path.join(process.cwd(), 'src/database/add-conversation-conflict-prevention.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    const result = await pool.query(sql);
    console.log('SQL Executed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error executing SQL:', error);
    process.exit(1);
  }
}

runSQL();

/**
 * Apply database indexes for performance optimization
 * Run this script to add indexes to existing database
 */

import pool from './connection.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function applyIndexes() {
  try {
    const indexesSQL = readFileSync(join(__dirname, 'indexes.sql'), 'utf-8');
    const statements = indexesSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    console.log('Applying database indexes...');
    
    for (const statement of statements) {
      try {
        await pool.query(statement);
        console.log(`✓ Applied: ${statement.substring(0, 50)}...`);
      } catch (error: any) {
        // Ignore "already exists" errors
        if (!error.message.includes('already exists')) {
          console.error(`✗ Error applying index: ${error.message}`);
        }
      }
    }

    console.log('Database indexes applied successfully!');
  } catch (error: any) {
    console.error('Error applying indexes:', error);
    throw error;
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  applyIndexes()
    .then(() => {
      console.log('Done!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Failed:', error);
      process.exit(1);
    });
}


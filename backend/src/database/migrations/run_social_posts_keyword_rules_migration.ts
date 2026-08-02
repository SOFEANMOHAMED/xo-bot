import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../connection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function run() {
  const sqlPath = path.join(__dirname, 'add_social_posts_and_keyword_rules.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log('Social posts / keyword rules / content links migration OK');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

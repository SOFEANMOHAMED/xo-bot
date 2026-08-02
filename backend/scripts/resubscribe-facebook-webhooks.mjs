/**
 * One-shot: re-subscribe all linked Facebook pages including message_echoes
 * so Inbox human replies disable the bot for that conversation.
 *
 * Usage: node scripts/resubscribe-facebook-webhooks.mjs
 * (loads ../.env via process — run from backend cwd with env already exported or dotenv)
 */
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env');

for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!m) continue;
  if (process.env[m[1]] !== undefined) continue;
  let v = m[2];
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  process.env[m[1]] = v;
}

const FIELDS =
  'messages,messaging_postbacks,message_deliveries,message_reads,message_echoes,feed';

const pool = new pg.Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

const { rows } = await pool.query(
  `SELECT page_id, page_name, access_token, merchant_id FROM facebook_pages`
);

console.log(`Re-subscribing ${rows.length} Facebook page(s) with: ${FIELDS}`);

let ok = 0;
let fail = 0;

for (const row of rows) {
  try {
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(row.page_id)}/subscribed_apps`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscribed_fields: FIELDS,
          access_token: row.access_token
        })
      }
    );
    const data = await res.json();
    if (res.ok && data.success !== false) {
      ok += 1;
      console.log(`✓ ${row.page_name || row.page_id}`, data);
    } else {
      fail += 1;
      console.error(`✗ ${row.page_name || row.page_id}`, data);
    }
  } catch (e) {
    fail += 1;
    console.error(`✗ ${row.page_name || row.page_id}`, e);
  }
}

await pool.end();
console.log(`Done. ok=${ok} fail=${fail}`);
process.exit(fail > 0 ? 1 : 0);

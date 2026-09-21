/**
 * Throwaway merchants for xobot_test only.
 * Fixture failure must throw (suite FAIL) — never skip, never reuse production rows.
 */
import type { Pool, PoolClient } from 'pg';
import {
  NODE_ENV_TEST,
  assertTestDatabaseAllowed,
} from './testDatabasePolicy.js';

export type SqlQueryable = Pool | PoolClient;

const THROW_AWAY_PASSWORD_PLACEHOLDER = 'test-only-not-a-real-hash';
const THROW_AWAY_AUTH_PROVIDER = 'email';
const THROW_AWAY_ROLE = 'user';

export function assertIsolatedTestDb(): void {
  if (process.env.NODE_ENV !== NODE_ENV_TEST) {
    throw new Error('Refuses to run unless NODE_ENV=test and DB_NAME ends with _test (never xobot_db)');
  }
  assertTestDatabaseAllowed(process.env.NODE_ENV, process.env.DB_NAME);
}

export async function insertThrowawayMerchant(
  client: SqlQueryable,
  label: string,
): Promise<string> {
  assertIsolatedTestDb();
  const stamp = Date.now();
  const rand = Math.random().toString(16).slice(2, 10);
  const result = await client.query<{ id: string }>(
    `INSERT INTO merchants (email, password_hash, name, auth_provider, role)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      `throwaway_${label}_${stamp}_${rand}@xobot.test`,
      THROW_AWAY_PASSWORD_PLACEHOLDER,
      `Throwaway ${label} ${stamp}`,
      THROW_AWAY_AUTH_PROVIDER,
      THROW_AWAY_ROLE,
    ],
  );
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error(`Failed to create throwaway merchant for ${label}`);
  }
  return String(id);
}

export async function deleteThrowawayMerchant(
  client: SqlQueryable,
  merchantId: string,
): Promise<void> {
  await client.query(
    `DELETE FROM messages
     WHERE conversation_id IN (SELECT id FROM conversations WHERE merchant_id = $1)`,
    [merchantId],
  );
  await client.query('DELETE FROM conversations WHERE merchant_id = $1', [merchantId]);
  await client.query('DELETE FROM merchants WHERE id = $1', [merchantId]);
}

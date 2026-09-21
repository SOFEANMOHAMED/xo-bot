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

/** WHY bounded: import graph of helpers starts unref'd timers; pool.end() may never settle. */
export const POOL_END_TIMEOUT_MS = 2_000;

export type ThrowawayCatalogProduct = {
  name: string;
  price: number;
  currency: string;
  category: string;
  stock: number;
  source: string;
  externalId: string | null;
};

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

export async function insertThrowawayCatalogProducts(
  client: SqlQueryable,
  merchantId: string,
  products: readonly ThrowawayCatalogProduct[],
): Promise<string[]> {
  assertIsolatedTestDb();
  if (products.length === 0) {
    throw new Error('Failed to create throwaway catalog products: empty list');
  }
  const ids: string[] = [];
  for (const product of products) {
    const result = await client.query<{ id: string }>(
      `INSERT INTO products (
         merchant_id, name, price, currency, category, stock, source, external_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        merchantId,
        product.name,
        product.price,
        product.currency,
        product.category,
        product.stock,
        product.source,
        product.externalId,
      ],
    );
    const id = result.rows[0]?.id;
    if (!id) {
      throw new Error(`Failed to create throwaway catalog product ${product.name}`);
    }
    ids.push(String(id));
  }
  return ids;
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
  await client.query('DELETE FROM products WHERE merchant_id = $1', [merchantId]);
  await client.query('DELETE FROM merchants WHERE id = $1', [merchantId]);
}

/**
 * Close the test pool, then always exit.
 * WHY: conversation.controller → sendMerchantReply → whatsappWeb inbound →
 * cacheService starts module-level setInterval (not unref'd). Those handles
 * keep the event loop alive after cleanup, so a successful suite never exits
 * and test-all's 60s spawnSync timeout turns a pass into FAIL. pool.end() can
 * also wait forever on a still-checked-out client. Race + process.exit is the
 * honest process boundary for NODE_ENV=test; it does not change production.
 */
export async function endPoolAndExit(pool: Pool, exitCode: number): Promise<never> {
  let code = exitCode;
  try {
    await Promise.race([
      pool.end(),
      new Promise<void>((resolve) => {
        setTimeout(resolve, POOL_END_TIMEOUT_MS);
      }),
    ]);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('pool.end failed:', message);
    if (code === 0) {
      code = 1;
    }
  }
  process.exit(code);
}

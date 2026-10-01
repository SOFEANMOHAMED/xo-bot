/**
 * Regression: 1-char search queries (size answers like "m") must not throw SQL syntax errors.
 * Run: npm run test-search-short-query
 */

import pool from '../database/connection.js';
import { searchProducts } from './product-search.js';
import {
  assertIsolatedTestDb,
  deleteThrowawayMerchant,
  endPoolAndExit,
  insertThrowawayCatalogProducts,
  insertThrowawayMerchant,
} from '../database/testDbFixtures.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function main(): Promise<void> {
  assertIsolatedTestDb();
  let merchantId: string | null = null;
  let passed = 0;

  try {
    merchantId = await insertThrowawayMerchant(pool, 'search_short');
    await insertThrowawayCatalogProducts(pool, merchantId, [
      {
        name: 'ThrowawayShirtShortSearch',
        price: 50,
        currency: 'USD',
        category: 'shirts',
        stock: 5,
        source: 'manual',
        externalId: null,
      },
    ]);

    for (const query of ['m', 's', 'l', '1', 'a']) {
      let threw: unknown = null;
      let results: Awaited<ReturnType<typeof searchProducts>> | null = null;
      try {
        results = await searchProducts(merchantId, query, { inStockOnly: false }, 5);
      } catch (err) {
        threw = err;
      }
      assert(
        threw === null,
        `searchProducts("${query}") must not throw, got: ${
          threw instanceof Error ? threw.message : String(threw)
        }`
      );
      assert(Array.isArray(results), `searchProducts("${query}") must return an array`);
      passed++;
      console.log(`✓ short query "${query}" did not throw (returned ${results!.length})`);
    }

    console.log(`\nAll ${passed} short-query search cases passed.`);
  } finally {
    if (merchantId) {
      await deleteThrowawayMerchant(pool, merchantId);
    }
    await endPoolAndExit(pool, 0);
  }
}

main().catch(async (err) => {
  console.error(err);
  await endPoolAndExit(pool, 1);
});

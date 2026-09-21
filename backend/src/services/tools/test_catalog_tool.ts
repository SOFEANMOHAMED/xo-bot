/**
 * Catalog tool against throwaway merchant + products in xobot_test.
 * Fixture failure is FAIL (non-zero). Never silent-exit 0 with «no products».
 */

import pool from '../../database/connection.js';
import toolRegistry from './toolRegistry.js';
import { CatalogTool } from './catalogTool.js';
import type { ToolContext, ToolResult } from './tool.interface.js';
import {
  assertIsolatedTestDb,
  deleteThrowawayMerchant,
  endPoolAndExit,
  insertThrowawayCatalogProducts,
  insertThrowawayMerchant,
  type ThrowawayCatalogProduct,
} from '../../database/testDbFixtures.js';

const WATCH_NAME = 'ThrowawayWatchFixture';
const PHONE_NAME = 'ThrowawayPhoneFixture';
const SHOPIFY_EXTERNAL_ID = 'throwaway-shopify-gid-1';
const CATALOG_INTENTS = [
  'browse',
  'product_query',
  'price',
  'availability',
  'comparison',
  'order',
] as const;

const THROW_AWAY_PRODUCTS: readonly ThrowawayCatalogProduct[] = [
  {
    name: WATCH_NAME,
    price: 199.5,
    currency: 'USD',
    category: 'watches',
    stock: 4,
    source: 'shopify',
    externalId: SHOPIFY_EXTERNAL_ID,
  },
  {
    name: PHONE_NAME,
    price: 89,
    currency: 'USD',
    category: 'phones',
    stock: 12,
    source: 'manual',
    externalId: null,
  },
];

function exitCodeFromProcess(): number {
  return process.exitCode === 1 ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

type CatalogProductRow = {
  id: string;
  name: string;
  price: unknown;
  currency: unknown;
  stock: unknown;
  source: unknown;
  externalId: unknown;
};

function catalogProducts(data: unknown): CatalogProductRow[] {
  if (!isRecord(data) || !Array.isArray(data.products)) {
    return [];
  }
  const rows: CatalogProductRow[] = [];
  for (const item of data.products) {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string') {
      continue;
    }
    rows.push({
      id: item.id,
      name: item.name,
      price: item.price,
      currency: item.currency,
      stock: item.stock,
      source: item.source,
      externalId: item.externalId,
    });
  }
  return rows;
}

function productFromResult(result: ToolResult): CatalogProductRow {
  if (!result.success) {
    throw new Error(`Catalog lookup failed: ${result.error || 'unknown error'}`);
  }
  const data = result.data;
  if (isRecord(data) && isRecord(data.product)) {
    const product = data.product;
    const id = product.id;
    const name = product.name;
    if (typeof id !== 'string' || typeof name !== 'string') {
      throw new Error('Catalog product missing id or name');
    }
    return {
      id,
      name,
      price: product.price,
      currency: product.currency,
      stock: product.stock,
      source: product.source,
      externalId: product.externalId,
    };
  }
  const products = catalogProducts(data);
  if (products.length === 0) {
    throw new Error('Catalog lookup returned no product');
  }
  return products[0];
}

async function runTest() {
  assertIsolatedTestDb();
  let merchantId: string | undefined;
  try {
    console.log('Starting Catalog Tool test...\n');

    toolRegistry.registerTool(new CatalogTool());
    console.log('✅ Catalog tool registered\n');

    merchantId = await insertThrowawayMerchant(pool, 'catalog_tool');
    if (!merchantId) {
      throw new Error('Failed to create throwaway merchant');
    }
    const productIds = await insertThrowawayCatalogProducts(
      pool,
      merchantId,
      THROW_AWAY_PRODUCTS,
    );
    if (productIds.length !== THROW_AWAY_PRODUCTS.length) {
      throw new Error('Failed to create throwaway catalog products');
    }
    console.log(`Testing with throwaway merchant ID: ${merchantId}\n`);

    const ctx: ToolContext = {
      merchantId,
      platform: 'test',
      conversationId: 'test-conv-catalog',
    };

    console.log('--- Test 1: Search products (empty query → top products) ---');
    const searchResults = await toolRegistry.executeToolsForIntent(
      'browse',
      { query: '', limit: 3 },
      ctx,
    );
    if (searchResults.length === 0 || !searchResults[0].success) {
      throw new Error(`Search failed: ${searchResults[0]?.error || 'no catalog result'}`);
    }
    const topProducts = catalogProducts(searchResults[0].data);
    const topNames = topProducts.map((p) => p.name);
    if (!topNames.includes(WATCH_NAME) || !topNames.includes(PHONE_NAME)) {
      throw new Error(`Top products missing fixtures: ${topNames.join(', ') || '(empty)'}`);
    }
    console.log(`✅ Found ${topProducts.length} products`);

    console.log('\n--- Test 2: Get product by ID ---');
    const byIdResult = await toolRegistry.executeTool(
      'catalog',
      { productId: productIds[0] },
      ctx,
    );
    const byId = productFromResult(byIdResult);
    if (byId.id !== productIds[0] || byId.name !== WATCH_NAME) {
      throw new Error('Get by ID returned the wrong product');
    }
    console.log(`✅ Product retrieved by ID: ${byId.name}`);

    console.log('\n--- Test 3: Get product by external ID (Shopify) ---');
    const byExternalIdResult = await toolRegistry.executeTool(
      'catalog',
      { externalId: SHOPIFY_EXTERNAL_ID, source: 'shopify' },
      ctx,
    );
    const byExternal = productFromResult(byExternalIdResult);
    if (byExternal.name !== WATCH_NAME) {
      throw new Error('Get by external ID returned the wrong product');
    }
    console.log(`✅ Product retrieved by external ID: ${byExternal.name}`);

    console.log('\n--- Test 4: Test different intents ---');
    for (const intent of CATALOG_INTENTS) {
      const tools = toolRegistry.getToolsForIntent(intent);
      if (!tools.some((t) => t.name === 'catalog')) {
        throw new Error(`Catalog tool cannot handle intent: ${intent}`);
      }
      console.log(`✅ Catalog tool can handle intent: ${intent}`);
    }

    console.log('\n--- Test 5: Search with query ---');
    const queryResults = await toolRegistry.executeTool(
      'catalog',
      { query: WATCH_NAME, limit: 3 },
      ctx,
    );
    if (!queryResults.success) {
      throw new Error(`Search with query failed: ${queryResults.error || 'unknown error'}`);
    }
    const queried = catalogProducts(queryResults.data);
    if (!queried.some((p) => p.name === WATCH_NAME)) {
      throw new Error(`Search with query did not return ${WATCH_NAME}`);
    }
    console.log(`✅ Search with query returned ${queried.length} products`);

    console.log('\n✅ All tests completed successfully!');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('❌ Test failed:', message);
    console.error(error);
    process.exitCode = 1;
  } finally {
    try {
      if (merchantId) {
        await deleteThrowawayMerchant(pool, merchantId);
        console.log('Deleted throwaway merchant:', merchantId);
      }
    } catch (cleanupError: unknown) {
      const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      console.error('Throwaway merchant cleanup failed:', message);
      process.exitCode = 1;
    }
    await endPoolAndExit(pool, exitCodeFromProcess());
  }
}

runTest();

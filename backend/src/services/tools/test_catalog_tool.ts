/**
 * Test script for Catalog Tool
 * Tests catalog tool with Shopify-synced data
 */

import pool from '../../database/connection.js';
import toolRegistry from './toolRegistry.js';
import { CatalogTool } from './catalogTool.js';
import { logger } from '../../utils/logger.js';

async function runTest() {
  try {
    console.log('Starting Catalog Tool test...\n');

    // Register catalog tool
    toolRegistry.registerTool(new CatalogTool());
    console.log('✅ Catalog tool registered\n');

    // Get a merchant with products (preferably with Shopify sync)
    const merchantResult = await pool.query(
      `SELECT DISTINCT merchant_id 
       FROM products 
       WHERE merchant_id IS NOT NULL 
       LIMIT 1`
    );

    if (merchantResult.rows.length === 0) {
      console.log('⚠️  No merchants with products found. Please add products first.');
      process.exit(0);
    }

    const merchantId = merchantResult.rows[0].merchant_id;
    console.log(`Testing with merchant ID: ${merchantId}\n`);

    // Check if merchant has Shopify products
    const shopifyProductsResult = await pool.query(
      `SELECT COUNT(*) as count, 
              COUNT(CASE WHEN source = 'shopify' THEN 1 END) as shopify_count
       FROM products 
       WHERE merchant_id = $1`,
      [merchantId]
    );

    const totalProducts = parseInt(shopifyProductsResult.rows[0].count);
    const shopifyProducts = parseInt(shopifyProductsResult.rows[0].shopify_count);

    console.log(`📊 Products for merchant:`);
    console.log(`   Total: ${totalProducts}`);
    console.log(`   Shopify-synced: ${shopifyProducts}`);
    console.log(`   Manual: ${totalProducts - shopifyProducts}\n`);

    // Test context
    const ctx = {
      merchantId,
      platform: 'test',
      conversationId: 'test-conv-123'
    };

    // ==================== TEST 1: Search products ====================
    console.log('--- Test 1: Search products ---');
    const searchResults = await toolRegistry.executeToolsForIntent(
      'browse',
      { query: '', limit: 3 },
      ctx
    );

    if (searchResults.length > 0 && searchResults[0].success) {
      const products = searchResults[0].data.products || [];
      console.log(`✅ Found ${products.length} products:`);
      products.forEach((p: any, i: number) => {
        console.log(`   ${i + 1}. ${p.name} - ${p.price} ${p.currency} (Stock: ${p.stock}, Source: ${p.source})`);
      });
    } else {
      console.log('❌ Search failed:', searchResults[0]?.error);
    }
    console.log('');

    // ==================== TEST 2: Get product by ID ====================
    if (totalProducts > 0) {
      console.log('--- Test 2: Get product by ID ---');
      const productResult = await pool.query(
        `SELECT id FROM products WHERE merchant_id = $1 LIMIT 1`,
        [merchantId]
      );

      if (productResult.rows.length > 0) {
        const productId = productResult.rows[0].id;
        const byIdResult = await toolRegistry.executeTool(
          'catalog',
          { productId },
          ctx
        );

        if (byIdResult.success) {
          const product = byIdResult.data.product;
          console.log(`✅ Product retrieved by ID:`);
          console.log(`   Name: ${product.name}`);
          console.log(`   Price: ${product.price} ${product.currency}`);
          console.log(`   Stock: ${product.stock}`);
          console.log(`   Source: ${product.source}`);
          if (product.externalId) {
            console.log(`   External ID: ${product.externalId}`);
          }
        } else {
          console.log('❌ Get by ID failed:', byIdResult.error);
        }
      }
      console.log('');
    }

    // ==================== TEST 3: Get product by external ID (Shopify) ====================
    if (shopifyProducts > 0) {
      console.log('--- Test 3: Get product by external ID (Shopify) ---');
      const shopifyProductResult = await pool.query(
        `SELECT external_id FROM products 
         WHERE merchant_id = $1 AND source = 'shopify' AND external_id IS NOT NULL 
         LIMIT 1`,
        [merchantId]
      );

      if (shopifyProductResult.rows.length > 0) {
        const externalId = shopifyProductResult.rows[0].external_id;
        const byExternalIdResult = await toolRegistry.executeTool(
          'catalog',
          { externalId, source: 'shopify' },
          ctx
        );

        if (byExternalIdResult.success) {
          const product = byExternalIdResult.data.product;
          console.log(`✅ Product retrieved by external ID:`);
          console.log(`   Name: ${product.name}`);
          console.log(`   External ID: ${product.externalId}`);
          console.log(`   Source: ${product.source}`);
        } else {
          console.log('❌ Get by external ID failed:', byExternalIdResult.error);
        }
      }
      console.log('');
    }

    // ==================== TEST 4: Test different intents ====================
    console.log('--- Test 4: Test different intents ---');
    const intents = ['browse', 'product_query', 'price', 'availability', 'comparison', 'order'];
    
    for (const intent of intents) {
      const tools = toolRegistry.getToolsForIntent(intent);
      const catalogTool = tools.find(t => t.name === 'catalog');
      if (catalogTool) {
        console.log(`✅ Catalog tool can handle intent: ${intent}`);
      } else {
        console.log(`❌ Catalog tool cannot handle intent: ${intent}`);
      }
    }
    console.log('');

    // ==================== TEST 5: Search with query ====================
    console.log('--- Test 5: Search with query ---');
    const queryResults = await toolRegistry.executeTool(
      'catalog',
      { query: 'product', limit: 3 },
      ctx
    );

    if (queryResults.success) {
      const products = queryResults.data.products || [];
      console.log(`✅ Search with query returned ${products.length} products`);
      if (products.length > 0) {
        console.log(`   First product: ${products[0].name}`);
      }
    } else {
      console.log('❌ Search with query failed:', queryResults.error);
    }
    console.log('');

    console.log('✅ All tests completed successfully!');

  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runTest();


/**
 * Example: Wrapping existing catalogTool.ts as a Tool
 * This shows how to integrate existing tools into the new tool system
 */

import { Tool, ToolContext, ToolResult } from './tool.interface.js';
import { searchProducts, getProductDetails, getTopProducts, type Product } from './catalogTool.js';
import { logger } from '../../utils/logger.js';

/**
 * Catalog Tool wrapper
 * Wraps existing catalogTool.ts functions into the Tool interface
 */
export class CatalogToolWrapper implements Tool {
  name = 'catalog';
  description = 'Search and retrieve product information from catalog';

  /**
   * Catalog tool can handle product-related intents
   */
  canHandle(intent: string): boolean {
    return [
      'price',
      'availability',
      'order',
      'browse',
      'product_query',
      'search'
    ].includes(intent);
  }

  /**
   * Execute catalog search or product retrieval
   * 
   * Input format:
   * - { query: string, filters?: {...} } - Search products
   * - { productId: string } - Get specific product
   * - { top: number } - Get top products
   */
  async execute(input: any, ctx: ToolContext): Promise<ToolResult> {
    try {
      // Handle product ID lookup
      if (input.productId) {
        const product = await getProductDetails(ctx.merchantId, input.productId);
        
        if (!product) {
          return {
            name: this.name,
            data: null,
            success: false,
            error: 'Product not found',
            metadata: { productId: input.productId }
          };
        }

        return {
          name: this.name,
          data: { product },
          success: true,
          metadata: { productId: input.productId, type: 'single' }
        };
      }

      // Handle top products request
      if (input.top) {
        const products = await getTopProducts(ctx.merchantId);
        
        return {
          name: this.name,
          data: { products: products.slice(0, input.top || 3) },
          success: true,
          metadata: { type: 'top', count: products.length }
        };
      }

      // Handle search query
      const query = input.query || input.search || '';
      const filters = input.filters || {};

      if (!query && Object.keys(filters).length === 0) {
        // No query or filters, return top products as fallback
        const products = await getTopProducts(ctx.merchantId);
        
        return {
          name: this.name,
          data: { products },
          success: true,
          metadata: { type: 'fallback', count: products.length }
        };
      }

      // Search products
      const products = await searchProducts(ctx.merchantId, query, filters);

      return {
        name: this.name,
        data: { products },
        success: true,
        metadata: {
          type: 'search',
          query,
          filters,
          count: products.length
        }
      };
    } catch (error: any) {
      logger.error('Error in catalog tool', error as Error, {
        merchantId: ctx.merchantId,
        input
      });

      return {
        name: this.name,
        data: null,
        success: false,
        error: error.message || 'Catalog search failed',
        metadata: { input }
      };
    }
  }
}


/**
 * Tools System - Main Entry Point
 * 
 * Export all tool-related interfaces, types, and the registry
 */

import { logger } from '../../utils/logger.js';

// Export interfaces and types
export type { Tool, ToolContext, ToolResult, ToolSchema } from './tool.interface.js';

// Export registry (singleton)
export { default as toolRegistry, ToolRegistry } from './toolRegistry.js';

// Export example wrappers (for reference)
export { CatalogToolWrapper } from './exampleCatalogToolWrapper.js';

// Export Catalog Tool
export { CatalogTool } from './catalogTool.js';

/**
 * Initialize tools system
 * Call this function at application startup to register all tools
 * 
 * Example:
 * ```typescript
 * import { initializeTools } from './services/tools/index.js';
 * 
 * // In your app initialization
 * initializeTools();
 * ```
 */
/**
 * Initialize tools system
 * Registers all available tools
 * Call this at application startup
 */
export async function initializeTools() {
  try {
    // Import toolRegistry
    const { default: toolRegistry } = await import('./toolRegistry.js');
    
    // Register Catalog Tool
    const { CatalogTool } = await import('./catalogTool.js');
    toolRegistry.registerTool(new CatalogTool());
    logger.info('Catalog tool registered');
  } catch (error: any) {
    logger.error('Failed to register catalog tool', error as Error);
  }
  
  // TODO: Register other tools when they are created
  // const { ShippingTool } = await import('./shippingTool.js');
  // toolRegistry.registerTool(new ShippingTool());
  // const { CheckoutTool } = await import('./checkoutTool.js');
  // toolRegistry.registerTool(new CheckoutTool());
}


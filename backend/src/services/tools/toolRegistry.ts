/**
 * Tool Registry
 * Central registry for managing and executing tools
 */

import { Tool, ToolContext, ToolResult } from './tool.interface.js';
import { logger } from '../../utils/logger.js';

/**
 * Registry for all available tools
 */
class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  /**
   * Register a tool in the registry
   * 
   * @param tool - Tool instance to register
   * @throws Error if tool with same name already exists
   */
  registerTool(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool with name "${tool.name}" is already registered`);
    }

    this.tools.set(tool.name, tool);
    logger.info('Tool registered', {
      toolName: tool.name,
      description: tool.description
    });
  }

  /**
   * Unregister a tool from the registry
   * 
   * @param toolName - Name of the tool to unregister
   */
  unregisterTool(toolName: string): void {
    if (this.tools.delete(toolName)) {
      logger.info('Tool unregistered', { toolName });
    }
  }

  /**
   * Get all tools that can handle a given intent
   * 
   * @param intent - The intent to check (e.g., "price", "order", "shipping")
   * @returns Array of tools that can handle this intent
   */
  getToolsForIntent(intent: string): Tool[] {
    const matchingTools: Tool[] = [];

    for (const tool of this.tools.values()) {
      if (tool.canHandle(intent)) {
        matchingTools.push(tool);
      }
    }

    return matchingTools;
  }

  /**
   * Execute all tools that can handle a given intent
   * 
   * @param intent - The intent to execute tools for
   * @param input - Tool-specific input
   * @param ctx - Execution context
   * @returns Array of tool results (one per tool executed)
   */
  async executeToolsForIntent(
    intent: string,
    input: any,
    ctx: ToolContext
  ): Promise<ToolResult[]> {
    const tools = this.getToolsForIntent(intent);

    if (tools.length === 0) {
      logger.debug('No tools found for intent', { intent });
      return [];
    }

    logger.info('Executing tools for intent', {
      intent,
      toolCount: tools.length,
      toolNames: tools.map(t => t.name)
    });

    // Execute all matching tools in parallel
    const results = await Promise.allSettled(
      tools.map(async (tool) => {
        try {
          const result = await tool.execute(input, ctx);
          return result;
        } catch (error: any) {
          logger.error(`Error executing tool ${tool.name}`, error as Error, {
            intent,
            toolName: tool.name,
            merchantId: ctx.merchantId
          });

          return {
            name: tool.name,
            data: null,
            success: false,
            error: error.message || 'Unknown error',
            metadata: { intent }
          } as ToolResult;
        }
      })
    );

    // Extract results from Promise.allSettled
    const toolResults: ToolResult[] = results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        const tool = tools[index];
        return {
          name: tool.name,
          data: null,
          success: false,
          error: result.reason?.message || 'Unknown error',
          metadata: { intent }
        } as ToolResult;
      }
    });

    return toolResults;
  }

  /**
   * Execute a specific tool by name
   * 
   * @param toolName - Name of the tool to execute
   * @param input - Tool-specific input
   * @param ctx - Execution context
   * @returns Tool result
   * @throws Error if tool not found
   */
  async executeTool(
    toolName: string,
    input: any,
    ctx: ToolContext
  ): Promise<ToolResult> {
    const tool = this.tools.get(toolName);

    if (!tool) {
      throw new Error(`Tool "${toolName}" not found in registry`);
    }

    try {
      const result = await tool.execute(input, ctx);
      return result;
    } catch (error: any) {
      logger.error(`Error executing tool ${toolName}`, error as Error, {
        toolName,
        merchantId: ctx.merchantId
      });

      return {
        name: toolName,
        data: null,
        success: false,
        error: error.message || 'Unknown error',
        metadata: { toolName }
      };
    }
  }

  /**
   * Get all registered tools
   * 
   * @returns Array of all registered tools
   */
  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Check if a tool is registered
   * 
   * @param toolName - Name of the tool to check
   * @returns true if tool is registered
   */
  hasTool(toolName: string): boolean {
    return this.tools.has(toolName);
  }

  /**
   * Get a tool by name
   * 
   * @param toolName - Name of the tool to get
   * @returns Tool instance or undefined if not found
   */
  getTool(toolName: string): Tool | undefined {
    return this.tools.get(toolName);
  }
}

// Singleton instance
const toolRegistry = new ToolRegistry();

// Export singleton instance
export default toolRegistry;

// Export class for testing
export { ToolRegistry };


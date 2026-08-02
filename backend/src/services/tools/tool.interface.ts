/**
 * Tool System Interface
 * Plugin-like system for extensible tools (catalog, shipping, checkout, CRM, etc.)
 */

/**
 * Context passed to tools during execution
 */
export type ToolContext = {
  merchantId: string;
  platform: string;
  conversationId: string;
  userId?: string;
  userName?: string;
  [key: string]: any; // Allow additional context fields
};

/**
 * Result returned by a tool after execution
 */
export type ToolResult = {
  name: string;
  data: any;
  success: boolean;
  error?: string;
  metadata?: Record<string, any>;
};

/**
 * Base interface for all tools
 * 
 * Tools are responsible for:
 * 1. Declaring which intents they can handle
 * 2. Executing their logic when called
 * 3. Returning structured results
 */
export interface Tool {
  /**
   * Unique name identifier for this tool
   * Example: "catalog", "shipping", "checkout", "crm"
   */
  name: string;

  /**
   * Description of what this tool does
   */
  description?: string;

  /**
   * Check if this tool can handle a given intent
   * 
   * @param intent - The detected intent (e.g., "price", "order", "shipping")
   * @returns true if this tool should be executed for this intent
   */
  canHandle(intent: string): boolean;

  /**
   * Execute the tool logic
   * 
   * @param input - Tool-specific input (e.g., search query, product ID, order details)
   * @param ctx - Execution context (merchantId, platform, conversationId, etc.)
   * @returns Tool result with data and metadata
   */
  execute(input: any, ctx: ToolContext): Promise<ToolResult>;
}

/**
 * Tool input/output schemas (optional, for documentation)
 */
export interface ToolSchema {
  input?: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
  output?: {
    type: string;
    properties?: Record<string, any>;
  };
}


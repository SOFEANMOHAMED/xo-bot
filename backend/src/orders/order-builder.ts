/**
 * Order Builder - Order ID generation for persistence layer
 */

/**
 * Create order ID
 */
export const generateOrderId = (): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `ORD-${timestamp}-${random}`.toUpperCase();
};

/**
 * Orders Module - Order validation and building
 */

// ==================== ORDER VALIDATOR ====================
export {
  validateOrder,
  hasAllMandatoryFields,
  getNextMissingField,
  extractName,
  extractPhone,
  extractAddress,
  extractDeliveryTime,
  extractCity
} from './order-validator.js';

export type {
  ValidationResult,
  OrderFieldLabels
} from './order-validator.js';

// ==================== ORDER BUILDER ====================
export {
  buildOrderData,
  generateOrderDataTag,
  generateConfirmationMessage,
  generateOrderRequestMessage,
  generateOrderSummary,
  calculateOrderTotal,
  isOrderComplete,
  generateOrderId
} from './order-builder.js';

export type { BuildOrderInput } from './order-builder.js';

// ==================== ORDER STORAGE ====================
export {
  createOrder,
  getOrderById,
  getOrders,
  getCustomerOrders,
  updateOrderStatus,
  cancelOrder,
  updateOrder,
  getOrderStats,
  ensureOrdersTable
} from './order-storage.js';

export type {
  StoredOrder,
  OrderStatus,
  CreateOrderInput,
  OrderQuery
} from './order-storage.js';

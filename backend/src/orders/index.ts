/**
 * Orders Module - Order persistence
 */

export { generateOrderId } from './order-builder.js';

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

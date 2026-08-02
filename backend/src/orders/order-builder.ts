/**
 * Order Builder - Build and format orders
 * Generates order data tags for backend processing
 */

import type { OrderData, Product, Language } from '../core/types.js';
import { logger } from '../utils/logger.js';

// ==================== TYPES ====================

export interface BuildOrderInput {
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  deliveryTime?: string;
  city?: string;
  products: Product[];
  quantities?: Record<string, number>;
  notes?: string;
}

// ==================== ORDER BUILDING ====================

/**
 * Build complete order data
 */
export const buildOrderData = (input: BuildOrderInput): OrderData => {
  const {
    customerName,
    customerPhone,
    customerAddress,
    deliveryTime,
    city,
    products,
    quantities = {},
    notes
  } = input;

  const orderProducts = products.map(product => ({
    productId: product.id,
    productName: product.name,
    quantity: quantities[product.id] || 1,
    price: product.price,
    variant: {
      size: product.sizes?.[0],
      color: product.colors?.[0]
    }
  }));

  const total = orderProducts.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  return {
    customerName,
    customerPhone,
    customerAddress,
    deliveryTime,
    city,
    products: orderProducts,
    total,
    notes
  };
};

/**
 * Generate ORDER_DATA tag for backend processing
 */
export const generateOrderDataTag = (orderData: OrderData): string => {
  const json = JSON.stringify({
    customerName: orderData.customerName,
    customerPhone: orderData.customerPhone,
    customerEmail: orderData.customerEmail || '',
    customerAddress: orderData.customerAddress,
    deliveryTime: orderData.deliveryTime || '',
    products: orderData.products.map(p => ({
      productId: p.productId,
      productName: p.productName,
      quantity: p.quantity,
      price: p.price
    })),
    total: orderData.total,
    notes: orderData.notes || 'طلب من خلال البوت'
  }, null, 2);

  return `\n\n[ORDER_DATA]\n${json}\n[/ORDER_DATA]`;
};

// ==================== ORDER CONFIRMATION MESSAGE ====================

/**
 * Generate order confirmation message
 */
export const generateConfirmationMessage = (
  orderData: OrderData,
  storeName: string,
  language: Language = 'arabic'
): string => {
  if (language === 'arabic') {
    return `شكراً لثقتك ${orderData.customerName}! 🙏

تم استلام طلبك بنجاح من متجر ${storeName}، وسنتواصل معك قريباً لتأكيده.

📋 **ملخص الطلب:**
${orderData.products.map(p => `- ${p.productName} (${p.quantity} قطعة)`).join('\n')}

💰 **المجموع:** ${orderData.total} ${orderData.products[0]?.price ? 'ل.س' : 'USD'}

📍 **التوصيل إلى:** ${orderData.customerAddress}
📞 **رقم التواصل:** ${orderData.customerPhone}`;
  }

  return `Thank you for your trust ${orderData.customerName}! 🙏

Your order has been received successfully from ${storeName}, and we will contact you soon to confirm it.

📋 **Order Summary:**
${orderData.products.map(p => `- ${p.productName} (${p.quantity} units)`).join('\n')}

💰 **Total:** ${orderData.total} USD

📍 **Delivery to:** ${orderData.customerAddress}
📞 **Contact:** ${orderData.customerPhone}`;
};

// ==================== ORDER REQUEST MESSAGE ====================

/**
 * Generate message asking for missing order information
 */
export const generateOrderRequestMessage = (
  missingFields: string[],
  language: Language = 'arabic'
): string => {
  const fieldsList = missingFields.map((field, i) => `${i + 1}. **${field}**`).join('\n');

  if (language === 'arabic') {
    return `تمام! 😊 عشان أجهزلك الطلب، ممكن تعطيني:

${fieldsList}

بس توصلني هالمعلومات، بجهزلك طلبك فوراً! ✨`;
  }

  return `Sure! 😊 To prepare your order, please provide:

${fieldsList}

Once I receive this info, I'll prepare your order right away! ✨`;
};

// ==================== ORDER SUMMARY ====================

/**
 * Generate order summary for review
 */
export const generateOrderSummary = (
  orderData: OrderData,
  language: Language = 'arabic'
): string => {
  if (language === 'arabic') {
    return `📦 **ملخص طلبك:**

👤 **الاسم:** ${orderData.customerName}
📞 **الهاتف:** ${orderData.customerPhone}
📍 **العنوان:** ${orderData.customerAddress}
${orderData.deliveryTime ? `⏰ **وقت التوصيل:** ${orderData.deliveryTime}` : ''}

🛒 **المنتجات:**
${orderData.products.map(p => `- ${p.productName} × ${p.quantity} = ${p.price * p.quantity}`).join('\n')}

💵 **المجموع الكلي:** ${orderData.total}

هل المعلومات صحيحة؟`;
  }

  return `📦 **Your Order Summary:**

👤 **Name:** ${orderData.customerName}
📞 **Phone:** ${orderData.customerPhone}
📍 **Address:** ${orderData.customerAddress}
${orderData.deliveryTime ? `⏰ **Delivery Time:** ${orderData.deliveryTime}` : ''}

🛒 **Products:**
${orderData.products.map(p => `- ${p.productName} × ${p.quantity} = ${p.price * p.quantity}`).join('\n')}

💵 **Total:** ${orderData.total}

Is this information correct?`;
};

// ==================== HELPERS ====================

/**
 * Calculate order total
 */
export const calculateOrderTotal = (
  products: Array<{ price: number; quantity: number }>
): number => {
  return products.reduce((sum, p) => sum + p.price * p.quantity, 0);
};

/**
 * Validate order data completeness
 */
export const isOrderComplete = (orderData: Partial<OrderData>): boolean => {
  return !!(
    orderData.customerName &&
    orderData.customerPhone &&
    orderData.customerAddress &&
    orderData.products &&
    orderData.products.length > 0
  );
};

/**
 * Create order ID
 */
export const generateOrderId = (): string => {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `ORD-${timestamp}-${random}`.toUpperCase();
};

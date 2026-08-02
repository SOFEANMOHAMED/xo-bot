# Tool System Examples

## نظرة عامة

نظام الأدوات (Tools) هو نظام plugin-like يسمح بإضافة أدوات قابلة للتوسع بسهولة. كل أداة:
- تعلن عن الـ intents التي يمكنها معالجتها
- تنفذ منطقها عند الاستدعاء
- ترجع نتائج منظمة

## مثال 1: إنشاء أداة Catalog

```typescript
// backend/src/services/tools/catalogTool.ts
import { Tool, ToolContext, ToolResult } from './tool.interface.js';
import { searchProducts, getProductDetails } from './catalogTool.js';

export class CatalogTool implements Tool {
  name = 'catalog';
  description = 'Search and retrieve product information';

  canHandle(intent: string): boolean {
    return ['price', 'availability', 'order', 'browse', 'product_query'].includes(intent);
  }

  async execute(input: any, ctx: ToolContext): Promise<ToolResult> {
    try {
      const { query, productId, filters } = input;

      if (productId) {
        // Get specific product
        const product = await getProductDetails(ctx.merchantId, productId);
        return {
          name: this.name,
          data: product ? { product } : null,
          success: !!product,
          error: product ? undefined : 'Product not found',
          metadata: { productId }
        };
      }

      // Search products
      const products = await searchProducts(
        ctx.merchantId,
        query || '',
        filters || {}
      );

      return {
        name: this.name,
        data: { products },
        success: true,
        metadata: {
          count: products.length,
          query,
          filters
        }
      };
    } catch (error: any) {
      return {
        name: this.name,
        data: null,
        success: false,
        error: error.message,
        metadata: { input }
      };
    }
  }
}
```

## مثال 2: إنشاء أداة Shipping

```typescript
// backend/src/services/tools/shippingTool.ts
import { Tool, ToolContext, ToolResult } from './tool.interface.js';
import pool from '../../database/connection.js';

export class ShippingTool implements Tool {
  name = 'shipping';
  description = 'Calculate shipping costs and delivery times';

  canHandle(intent: string): boolean {
    return ['shipping', 'delivery', 'order'].includes(intent);
  }

  async execute(input: any, ctx: ToolContext): Promise<ToolResult> {
    try {
      const { city, country, items } = input;

      // Get merchant shipping settings
      const settingsResult = await pool.query(
        `SELECT shipping_policy, delivery_time 
         FROM merchant_settings 
         WHERE merchant_id = $1`,
        [ctx.merchantId]
      );

      const settings = settingsResult.rows[0] || {};

      // Calculate shipping (simplified example)
      const shippingCost = this.calculateShipping(city, country, items);
      const deliveryTime = settings.delivery_time || '2-5 أيام عمل';

      return {
        name: this.name,
        data: {
          cost: shippingCost,
          deliveryTime,
          policy: settings.shipping_policy
        },
        success: true,
        metadata: { city, country, itemsCount: items?.length || 0 }
      };
    } catch (error: any) {
      return {
        name: this.name,
        data: null,
        success: false,
        error: error.message
      };
    }
  }

  private calculateShipping(city: string, country: string, items: any[]): number {
    // Simplified calculation
    return 10; // Base shipping cost
  }
}
```

## مثال 3: إنشاء أداة Checkout

```typescript
// backend/src/services/tools/checkoutTool.ts
import { Tool, ToolContext, ToolResult } from './tool.interface.js';
import pool from '../../database/connection.js';

export class CheckoutTool implements Tool {
  name = 'checkout';
  description = 'Process orders and create checkout sessions';

  canHandle(intent: string): boolean {
    return ['order', 'checkout', 'purchase'].includes(intent);
  }

  async execute(input: any, ctx: ToolContext): Promise<ToolResult> {
    try {
      const { products, customerInfo, paymentMethod } = input;

      // Validate input
      if (!products || products.length === 0) {
        return {
          name: this.name,
          data: null,
          success: false,
          error: 'No products provided'
        };
      }

      // Calculate total
      const total = products.reduce((sum: number, p: any) => 
        sum + (p.price * p.quantity), 0
      );

      // Create order (simplified)
      const orderResult = await pool.query(
        `INSERT INTO orders (
          merchant_id, customer_name, customer_email,
          customer_phone, total, status, source
        ) VALUES ($1, $2, $3, $4, $5, 'pending', 'bot')
        RETURNING id`,
        [
          ctx.merchantId,
          customerInfo?.name,
          customerInfo?.email,
          customerInfo?.phone,
          total
        ]
      );

      const orderId = orderResult.rows[0].id;

      return {
        name: this.name,
        data: {
          orderId,
          total,
          status: 'pending'
        },
        success: true,
        metadata: {
          productsCount: products.length,
          paymentMethod
        }
      };
    } catch (error: any) {
      return {
        name: this.name,
        data: null,
        success: false,
        error: error.message
      };
    }
  }
}
```

## مثال 4: تسجيل الأدوات واستخدامها

```typescript
// backend/src/services/tools/index.ts
import toolRegistry from './toolRegistry.js';
import { CatalogTool } from './catalogTool.js';
import { ShippingTool } from './shippingTool.js';
import { CheckoutTool } from './checkoutTool.js';

// Register all tools
export function initializeTools() {
  toolRegistry.registerTool(new CatalogTool());
  toolRegistry.registerTool(new ShippingTool());
  toolRegistry.registerTool(new CheckoutTool());
}

// Export registry
export { toolRegistry };
export { Tool, ToolContext, ToolResult } from './tool.interface.js';
```

## مثال 5: استخدام الأدوات في Orchestrator

```typescript
// backend/src/services/orchestrator.service.ts
import toolRegistry from './tools/toolRegistry.js';
import { ToolContext } from './tools/tool.interface.js';

export const processMessage = async (params: ProcessMessageParams) => {
  // ... existing code ...

  // Detect intent
  const detectedIntent = 'price'; // From AI detection

  // Execute tools for this intent
  const toolContext: ToolContext = {
    merchantId: params.merchantId,
    platform: params.platform,
    conversationId: conversation.id,
    userId: params.userId,
    userName: params.userName
  };

  const toolResults = await toolRegistry.executeToolsForIntent(
    detectedIntent,
    {
      query: messageText,
      productId: entities.product_id
    },
    toolContext
  );

  // Process tool results
  let products: any[] = [];
  for (const result of toolResults) {
    if (result.name === 'catalog' && result.success) {
      products = result.data.products || [];
    }
  }

  // Generate reply using tool results
  const reply = generateReply(detectedIntent, {
    storeName,
    products,
    // ... other data from tool results
  });

  // ... rest of the code ...
};
```

## مثال 6: استخدام أداة محددة

```typescript
// Execute a specific tool
const catalogResult = await toolRegistry.executeTool(
  'catalog',
  {
    query: 'هاتف ذكي',
    filters: { inStockOnly: true }
  },
  {
    merchantId: 'uuid',
    platform: 'facebook_messenger',
    conversationId: 'conv-uuid'
  }
);

if (catalogResult.success) {
  const products = catalogResult.data.products;
  // Use products...
}
```

## مثال 7: أداة CRM (مستقبلية)

```typescript
// backend/src/services/tools/crmTool.ts
import { Tool, ToolContext, ToolResult } from './tool.interface.js';
import pool from '../../database/connection.js';

export class CrmTool implements Tool {
  name = 'crm';
  description = 'Manage customer relationships and data';

  canHandle(intent: string): boolean {
    return ['order', 'customer_info', 'update_customer'].includes(intent);
  }

  async execute(input: any, ctx: ToolContext): Promise<ToolResult> {
    try {
      const { action, customerData } = input;

      if (action === 'create_customer') {
        // Create customer in CRM
        const result = await pool.query(
          `INSERT INTO customers (merchant_id, name, email, phone)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [ctx.merchantId, customerData.name, customerData.email, customerData.phone]
        );

        return {
          name: this.name,
          data: { customerId: result.rows[0].id },
          success: true
        };
      }

      // Other CRM actions...
      return {
        name: this.name,
        data: null,
        success: false,
        error: 'Unknown action'
      };
    } catch (error: any) {
      return {
        name: this.name,
        data: null,
        success: false,
        error: error.message
      };
    }
  }
}
```

## مثال 8: أداة WhatsApp (مستقبلية)

```typescript
// backend/src/services/tools/whatsappTool.ts
import { Tool, ToolContext, ToolResult } from './tool.interface.js';

export class WhatsAppTool implements Tool {
  name = 'whatsapp';
  description = 'Send messages via WhatsApp Business API';

  canHandle(intent: string): boolean {
    // WhatsApp tool can handle all intents (it's a platform tool)
    return true;
  }

  async execute(input: any, ctx: ToolContext): Promise<ToolResult> {
    try {
      const { message, phoneNumber } = input;

      // Send WhatsApp message
      // ... implementation ...

      return {
        name: this.name,
        data: { messageId: 'wa-123', status: 'sent' },
        success: true
      };
    } catch (error: any) {
      return {
        name: this.name,
        data: null,
        success: false,
        error: error.message
      };
    }
  }
}
```

## ملاحظات مهمة

1. **Tool Registration**: يجب تسجيل جميع الأدوات عند بدء التطبيق
2. **Error Handling**: جميع الأدوات يجب أن تتعامل مع الأخطاء وتعيد `success: false`
3. **Context**: `ToolContext` يحتوي على معلومات أساسية (merchantId, platform, conversationId)
4. **Parallel Execution**: `executeToolsForIntent` ينفذ جميع الأدوات المتطابقة بالتوازي
5. **Extensibility**: يمكن إضافة أدوات جديدة بسهولة بدون تعديل الكود الموجود


# Tools System

نظام أدوات (Tools) قائم على plugins للمستقبل. يسمح بإضافة أدوات قابلة للتوسع بسهولة.

## الملفات

- `tool.interface.ts` - تعريفات الـ interfaces والـ types
- `toolRegistry.ts` - نظام التسجيل والتنفيذ
- `index.ts` - نقطة الدخول الرئيسية
- `exampleCatalogToolWrapper.ts` - مثال على wrapping أداة موجودة
- `EXAMPLES_TOOL_SYSTEM.md` - أمثلة شاملة

## الاستخدام السريع

### 1. إنشاء أداة جديدة

```typescript
import { Tool, ToolContext, ToolResult } from './tool.interface.js';

export class MyTool implements Tool {
  name = 'my_tool';
  description = 'My tool description';

  canHandle(intent: string): boolean {
    return ['intent1', 'intent2'].includes(intent);
  }

  async execute(input: any, ctx: ToolContext): Promise<ToolResult> {
    // Your logic here
    return {
      name: this.name,
      data: { result: 'data' },
      success: true
    };
  }
}
```

### 2. تسجيل الأداة

```typescript
import toolRegistry from './toolRegistry.js';
import { MyTool } from './myTool.js';

toolRegistry.registerTool(new MyTool());
```

### 3. استخدام الأداة

```typescript
import toolRegistry from './toolRegistry.js';

// Execute tools for an intent
const results = await toolRegistry.executeToolsForIntent(
  'price',
  { query: 'هاتف' },
  {
    merchantId: 'uuid',
    platform: 'facebook_messenger',
    conversationId: 'conv-uuid'
  }
);

// Or execute a specific tool
const result = await toolRegistry.executeTool(
  'catalog',
  { query: 'هاتف' },
  context
);
```

## المميزات

- **Plugin-like**: إضافة أدوات جديدة بدون تعديل الكود الموجود
- **Intent-based**: كل أداة تعلن عن الـ intents التي يمكنها معالجتها
- **Parallel Execution**: تنفيذ جميع الأدوات المتطابقة بالتوازي
- **Error Handling**: معالجة أخطاء شاملة
- **Type-safe**: TypeScript interfaces كاملة
- **Extensible**: يدعم أدوات مستقبلية (WhatsApp, Instagram, CRM, etc.)

## الأدوات المخططة

- ✅ Catalog Tool (مثال)
- ⏳ Shipping Tool
- ⏳ Checkout Tool
- ⏳ CRM Tool
- ⏳ WhatsApp Tool
- ⏳ Instagram Tool
- ⏳ Pricing Rules Tool

## انظر أيضاً

- `EXAMPLES_TOOL_SYSTEM.md` - أمثلة شاملة
- `exampleCatalogToolWrapper.ts` - مثال على wrapping أداة موجودة


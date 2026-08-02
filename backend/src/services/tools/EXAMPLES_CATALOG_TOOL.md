# أمثلة استخدام Catalog Tool

## الوظائف المتاحة

### 1. searchProducts - البحث في المنتجات

```typescript
import { searchProducts } from './tools/catalogTool.js';

// مثال 1: بحث بسيط
const products = await searchProducts(
  merchantId,
  'هاتف ذكي'
);
// يرجع: [{ id, name, price, currency, stock, sizes, imageUrl, externalId, source, ... }]

// مثال 2: بحث مع فلاتر
const filteredProducts = await searchProducts(
  merchantId,
  'هاتف',
  {
    category: 'electronics',
    minPrice: 100,
    maxPrice: 500,
    inStockOnly: true,
    source: 'shopify'
  }
);

// مثال 3: بحث بدون query (فقط فلاتر)
const categoryProducts = await searchProducts(
  merchantId,
  '', // query فارغ
  {
    category: 'electronics',
    inStockOnly: true
  }
);
```

### 2. getProductDetails - الحصول على تفاصيل منتج

```typescript
import { getProductDetails } from './tools/catalogTool.js';

const product = await getProductDetails(
  merchantId,
  'product-uuid-123'
);

if (product) {
  console.log(`Product: ${product.name}`);
  console.log(`Price: ${product.price} ${product.currency}`);
  console.log(`Stock: ${product.stock}`);
  console.log(`Image: ${product.imageUrl}`);
} else {
  console.log('Product not found');
}
```

### 3. getTopProducts - الحصول على أفضل المنتجات (fallback)

```typescript
import { getTopProducts } from './tools/catalogTool.js';

// الحصول على آخر 3 منتجات متوفرة
const topProducts = await getTopProducts(merchantId);
```

## الاستخدام في Orchestrator

```typescript
// في orchestrator.service.ts
import {
  searchProducts as catalogSearchProducts,
  getTopProducts as catalogGetTopProducts
} from './tools/catalogTool.js';

// البحث عن منتجات بناءً على رسالة المستخدم
let products = await catalogSearchProducts(merchantId, messageText, {
  inStockOnly: true // تفضيل المنتجات المتوفرة
});

// إذا لم يجد نتائج، استخدم fallback
if (products.length === 0) {
  products = await catalogGetTopProducts(merchantId);
}
```

## أمثلة متقدمة

### البحث مع فلاتر متعددة

```typescript
// البحث عن هواتف ذكية بسعر بين 200-800 دولار
const smartphones = await searchProducts(
  merchantId,
  'هاتف ذكي',
  {
    category: 'electronics',
    minPrice: 200,
    maxPrice: 800,
    inStockOnly: true
  }
);
```

### البحث حسب المصدر

```typescript
// البحث فقط في منتجات Shopify
const shopifyProducts = await searchProducts(
  merchantId,
  'laptop',
  {
    source: 'shopify',
    inStockOnly: true
  }
);
```

### التحقق من تفاصيل منتج قبل الرد

```typescript
import { getProductDetails } from './tools/catalogTool.js';

// في orchestrator، بعد العثور على منتج
const productId = products[0].id;
const productDetails = await getProductDetails(merchantId, productId);

if (productDetails) {
  // استخدام التفاصيل في الرد
  const reply = `سعر ${productDetails.name} هو ${productDetails.price} ${productDetails.currency}`;
}
```

## الأمان

- ✅ جميع الاستعلامات تستخدم parameterized queries
- ✅ `merchantId` مطلوب دائماً (SaaS isolation)
- ✅ لا يوجد SQL injection risk
- ✅ جميع القيم يتم التحقق منها قبل الاستخدام

## الأداء

- البحث يستخدم `ILIKE` (case-insensitive) للبحث السريع
- ترتيب النتائج: name match > category match > description match
- تفضيل المنتجات المتوفرة (stock > 0)
- الحد الأقصى: 3 منتجات (LIMIT 3)

## معالجة الأخطاء

```typescript
try {
  const products = await searchProducts(merchantId, query);
  // استخدام products
} catch (error) {
  logger.error('Error searching products', error);
  // معالجة الخطأ
  return []; // أو throw error حسب الحاجة
}
```


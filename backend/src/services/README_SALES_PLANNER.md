# Sales Planner

نظام تخطيط حتمي (deterministic) يفرض التقدم في المحادثة. دائماً يسأل سؤال واحد فقط.

## القواعد الرئيسية

### 1. Handoff/Complaint
- **Condition**: `stage === 'handoff'` OR `intent === 'complaint'`
- **Action**: `handoff`
- **Question**: "نعتذر عن أي إزعاج. سنقوم بتحويلك إلى فريق الدعم..."

### 2. Price Inquiry Without Product
- **Condition**: `intent === 'price'` AND no `product_query` AND no `product_id`
- **Action**: `ask_clarify`
- **Question**: "ما المنتج الذي تريد معرفة سعره؟"

### 3. Product Recommendations (1-3 products)
- **Condition**: Has 1-3 products from catalogTool
- **Action**: `recommend_products`
- **Question**: 
  - 1 product: "لدينا [product] بسعر [price]. هل تريد المتابعة؟"
  - 2-3 products: "لدينا [products]. أي منتج تفضل؟"

### 4. Order Ready - Missing Fields
- **Condition**: `intent === 'order'` AND `stage === 'close'`
- **Priority**:
  1. Missing `city` → `confirm_city`: "إلى أي مدينة تريد التوصيل؟"
  2. Missing `size` (if product has sizes) → `confirm_variant`: "ما المقاس الذي تفضله؟"
  3. Missing `color` → `confirm_variant`: "ما اللون الذي تفضله؟"
  4. All fields present → `send_checkout`: "ممتاز! هل تريد إتمام الطلب الآن؟"

### 5. Objection Handling
- **Price Objection**: Offer cheaper alternatives or ask budget
- **Trust Objection**: Offer guarantees/warranty info
- **Shipping Objection**: Ask for city to provide accurate info
- **Quality Objection**: Recommend best value products

### 6. Browse/Product Query
- **Condition**: `intent === 'browse'` OR `intent === 'product_query'`
- **Action**: `recommend_products` if products found, else `ask_clarify`

### 7. Availability Check
- **Condition**: `intent === 'availability'`
- **Action**: Show stock status, ask if want to order or get notified

### 8. Shipping Inquiry
- **Condition**: `intent === 'shipping'`
- **Action**: `confirm_city` if missing, else provide shipping info

### 9. Comparison
- **Condition**: `intent === 'comparison'`
- **Action**: `recommend_products` if 2+ products, else `ask_clarify`

### 10. Default (Greeting/Other)
- **Action**: `ask_clarify`
- **Question**: "مرحباً بك! كيف يمكنني مساعدتك اليوم؟"

## Output Format

```typescript
{
  next_action: 'ask_clarify' | 'recommend_products' | 'confirm_variant' | 'confirm_city' | 'send_checkout' | 'handoff',
  one_question: string,  // Exactly ONE question
  cta_type: 'choose' | 'confirm' | 'order' | 'support',
  recommendation_strategy: 'top_sellers' | 'match_query' | 'upsell' | 'cheaper_alt' | 'best_value' | null,
  should_offer_discount: boolean,
  handoff_reason: string
}
```

## أمثلة

### مثال 1: Complaint
```typescript
Input: { intent: 'complaint', stage: 'handoff', ... }
Output: {
  next_action: 'handoff',
  one_question: 'نعتذر عن أي إزعاج. سنقوم بتحويلك إلى فريق الدعم...',
  cta_type: 'support',
  ...
}
```

### مثال 2: Price Without Product
```typescript
Input: { intent: 'price', entities: {}, toolResults: [] }
Output: {
  next_action: 'ask_clarify',
  one_question: 'ما المنتج الذي تريد معرفة سعره؟',
  cta_type: 'choose',
  ...
}
```

### مثال 3: Order Missing City
```typescript
Input: { intent: 'order', stage: 'close', entities: { product_query: 'هاتف' }, ... }
Output: {
  next_action: 'confirm_city',
  one_question: 'إلى أي مدينة تريد التوصيل؟',
  cta_type: 'confirm',
  ...
}
```

## الاختبار

```bash
npm run test-sales-planner
```

## ملاحظات

- **Always ONE question**: كل output يحتوي على سؤال واحد فقط
- **Deterministic**: نفس الـ input يعطي نفس الـ output دائماً
- **Progress-focused**: كل action يدفع المحادثة للأمام
- **No selling on handoff**: عند handoff، لا بيع، فقط دعم


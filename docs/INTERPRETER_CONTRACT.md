# عقد المُفسّر (Interpreter Contract) — تصميم فقط

**PHASE 4-PREP + تعديلات 1C — لا تنفيذ إنتاجي في هذه الوثيقة.**  
العربية للشرح؛ المعرّفات والمسارات والـ JSON بالإنجليزية.

المرجع القياسي الصالح: `docs/BASELINE.md` (1C) + `docs/BASELINE_BREAKDOWN.md`.  
v1 باطل: `docs/BASELINE_v1_INVALID.md`.

---

## 1) أين يُحقَن في `processWithSalesGPT`

**الموقع:** في بداية المسار الحتمي، **قبل** أي مصنّف كلمات يفهم نص العميل، وبعد تجهيز مرشّحي الكتالوج (§2).

الترتيب داخل `processWithSalesGPT`:

1. قراءة الحالة + آخر ≤6 رسائل.  
2. **استرجاع مرشّحين** (§2) → قوائم مغلقة `allowedProductIds` / `cartLines`.  
3. **Whitelist حتمي** (§5) — إن طابق، لا مُفسّر.  
4. `interpretCustomerTurn` → JSON.  
5. `validateInterpreterResult` ثم تطبيق عبر `cartLineOps` / reducers.  
6. **تفسير واحد:** إذا طُبّق المُفسّر لهذا النوع، **لا تُشغَّل** مصنّفات الكلمات لنفس النوع في نفس الدور (إلا whitelist).  
7. فشل التحقق في الظل/المرحلة الأولى فقط → المصنّف القديم لنفس الدور.

قناة منفصلة عن `agent.ts` `generateJSON` (رد المبيعات).

---

## 2) المدخل — مرشّحو الكتالوج (لا كل الـ ids)

```ts
type InterpreterInput = {
  message: string;
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>; // ≤6
  stateSummary: {
    focusProductId: string | null;
    pendingBotQuestion: 'color' | 'size' | null;
    pendingProductId: string | null;
    awaitingOrderConfirmation: boolean;
    cartStatus: 'building' | 'checking_out' | null;
  };
  /** مغلقة — اتحاد حتمي فقط */
  allowedProductIds: string[];
  cartLines: Array<{
    lineId: string;
    productId: string;
    productName: string;
    color: string | null;
    size: string | null;
    quantity: number;
    currency: string;
    allowedColors: string[];
    allowedSizes: string[];
  }>;
};
```

**بناء `allowedProductIds` (حتمي، مرتّب، top-N):**

1. `focusProductId` إن وُجد.  
2. كل `productId` في السلة.  
3. منتجات مذكورة في الرسالة الحالية / آخر رسائل المستخدم (نفس `findProductsMentionedInText`).  
4. نتائج `searchProducts` / كلمات مفتاحية بحث الكتالوج — **top-N** (مقترح N=8).  
5. لا تُمرَّر كامل الكتالوج الكبير إلى المُفسّر.

---

## 3) المخرج — مفردات مغلقة + دليل نصّي

```ts
type InterpreterActionType =
  | 'set_focus_product'
  | 'ask_clarification'
  | 'select_color'
  | 'select_size'
  | 'set_quantity'
  | 'add_product'
  | 'remove_line'
  | 'cancel_order'
  | 'correct_variant'
  | 'request_photo'
  | 'refuse_photo'
  | 'browse_catalog'
  | 'ask_product_info'
  | 'provide_identity_field'
  | 'affirm_order'
  | 'deny_order'
  | 'handoff_human'
  | 'noop';

type InterpreterAction = {
  type: InterpreterActionType;
  productId?: string;       // ∈ allowedProductIds
  lineId?: string;          // ∈ cartLines
  color?: string;
  size?: string;
  quantity?: number;
  identityField?: 'name' | 'phone' | 'address';
  identityValue?: string;
  infoKind?: 'price' | 'details' | 'availability';
  confidence: number;       // 0..1 — عتبات مؤقتة (§7)
  /** اقتباس حرفي من message يجب أن يكون substring بعد التطبيع الخفيف */
  evidence: string;
  ambiguous: boolean;
};

type InterpreterResult = {
  actions: InterpreterAction[];
  rawModelConfidence: number;
};
```

**التحقق من `evidence`:** بعد إزالة تشكيل اختياري، `message.includes(evidence)` (أو contains بعد normalizeArabic). إن فشل → رفض الإجراء. **لا offsets / evidenceSpan.**

---

## 4) التحقق والتطبيق

- مخطط JSON + مفردات مغلقة + ids من القوائم.  
- على الأكثر `ask_clarification` واحد.  
- تعارض `cancel_order` مع `affirm_order` → رفض المجموعة.  
- التطبيق عبر `cartLineOps` كما في النسخة السابقة من العقد.  
- التثبيت النهائي للطلب يبقى لسكة I4 (المُفسّر يعطي `affirm_order` فقط).

### إجراءات مدمِّرة

`cancel_order` و `remove_line` تتطلب:

1. `confidence` عالي (مؤقتاً ≥ **0.90** إلى حين المعايرة)، **و**  
2. إما `evidence` يطابق عبارة إلغاء/حذف صريحة موثّقة، **أو**  
3. تحويل إلى `ask_clarification` لتأكيد واحد قبل التطبيق.

---

## 5) Whitelist حتمي (دائماً، بلا LLM)

1. طلب تحويل لبشر.  
2. asks-if-bot.  
3. نعم/لا العاريان المربوطان بـ `pending_bot_question` أو `awaiting_order_confirmation`.

---

## 6) ترتيب الترحيل (من breakdown 1C)

| # | النوع | لماذا | عتبة الخروج |
| ---: | --- | --- | --- |
| 1 | **focus + order-intent (SKU مذكور)** | S20 صلب — حذاء→ألوان ساعة | gate ≥ baseline؛ **0** I1 خطأ تركيز على 3× `test-live`؛ توافق focus مع المنتج المذكّر |
| 2 | **photo refusal** | 6× soft حقيقي | I5=100%؛ لا وعد صورة عند الرفض؛ أثر `order`/`refuse_photo` |
| 3 | **quantity / order-intent** | «ساعتين» | تثبيت كمية أو توضيح واحد؛ ≥ baseline |
| 4 | **anti color→identity hijack** | «أنت قلت في أسود» | لا `collect_info` اسم على ذكر لون في سياق qa |
| 5 | color/size selection | hard مستقر | ظل ثم FLIP عند ≥95% اتفاق |
| 6 | variant / add / remove / cancel | قوية hard | بعد استقرار 5 |
| 7 | browse / price/details / OOS | ~100% | ظل فقط عند انحدار |

### بروتوكول لكل نوع

1. **تقييم offline** على سيناريوهات معلَّمة (دقة actions) **قبل** الظل.  
2. **SHADOW** على playground — تسجيل disagreements؛ القرار الفعلي للقديم.  
3. **FLIP** عند gate ≥ baseline للنوع و**صفر P0** عبر 3 تشغيلات.  
4. بعد FLIP: المصنّف القديم لهذا النوع **لا يعمل** في نفس الدور (تفسير واحد).  
5. **DELETE** بعد أسبوع استقرار.

---

## 7) النموذج والميزانية والثقة

| | |
| --- | --- |
| مرشّح أول | `gpt-4o-mini` (structured/JSON إن أُضيف للعميل) |
| احتياط | نموذج medium إن هبطت الدقة offline |
| **latency p95** | **≤ 1.5 s** لكل دور مُفسّر |
| تكلفة تقديرية | ≤ $0.0004 / دور (small) |
| temperature | 0 أو 0.1 |
| العميل الحالي | `generateJSON` = نص + parse؛ يُفضَّل لاحقاً `response_format` JSON |

**عتبات الثقة مؤقتة** ويجب **معايرتها على بيانات معلَّمة** قبل FLIP. القيم الابتدائية المقترحة فقط: تطبيق ≥0.80؛ توضيح 0.55–0.80؛ مدمِّر ≥0.90 + evidence.

### فشل JSON / timeout

| مرحلة | السلوك |
| --- | --- |
| offline / shadow / أول أسبوع بعد FLIP | الرجوع للمصنّف القديم **لنفس الدور فقط** + سجل |
| بعد استقرار النوع | **لا صمت:** `ask_clarification` أو handoff — لا تخمين سلة |

---

## 8) خطة الاختبار

- سيناريوهات معلَّمة لكل TURN TYPE في جدول §6 + امتداد S20/focus.  
- **Offline accuracy** لـ `actions[]` قبل الظل.  
- `test-live` يفصل: درجة قرار المُفسّر vs حقائق الرد (I1–I5).  
- Gate: `test-live.thresholds.json` + عتبات `interpreterByTurnType` لاحقاً.

---

## 9) حدود

- تصميم فقط في 1C / 4-PREP.  
- لا نمو لقوائم keywords لفهم النص.  
- أي تغيير I3/قياس يُعاد معه BASELINE.

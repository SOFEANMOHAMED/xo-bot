# عقد المُفسّر (Interpreter Contract) — تصميم فقط

**PHASE 4-PREP — لا تنفيذ إنتاجي في هذه الوثيقة.**  
العربية للشرح؛ المعرّفات والمسارات والـ JSON بالإنجليزية.

المرجع القياسي: `docs/BASELINE.md` + `docs/BASELINE_BREAKDOWN.md` (قياس 2026-09-21 على `7b4ce19`).

---

## 1) أين يُحقَن في `processWithSalesGPT`

**الموقع:** في بداية المسار الحتمي، **قبل** أي مصنّف كلمات مفتاحية / interim matcher يفهم نص العميل، وبعد تجهيز قوائم السياق فقط.

الترتيب المقترح داخل `index.ts` / `processWithSalesGPT`:

1. قراءة الحالة + آخر الرسائل + كتالوج مختصر (موجود اليوم عبر `getTopProducts` / سلة).
2. بناء **قوائم مُغلقة** للمدخل: `product_ids[]`, `cart_lines[{line_id, product_id, options}]`.
3. **Whitelist حتمي** (انظر §4) — إن طابق، لا يُستدعى المُفسّر.
4. استدعاء `interpretCustomerTurn(...)` → `InterpreterResult`.
5. التحقق (`validateInterpreterResult`) ثم تطبيق الإجراءات عبر `cartLineOps` / reducers.
6. فقط عند الفشل/الظل: المسارات الحالية (`classifyInterimCancelIntent`, `resolvePendingVariantAnswer`, `isExplicitPhotoRequest`, …).

لا يمرّ المُفسّر عبر `generateJSON` الخاص بردّ المبيعات (`agent.ts`)؛ قناة منفصلة بـ system prompt ضيق وخرج JSON فقط.

---

## 2) المدخل (Input)

```ts
type InterpreterInput = {
  message: string;                    // نص العميل الحالي فقط
  recentMessages: Array<{             // آخر 6 رسائل كحد أقصى
    role: 'user' | 'assistant';
    content: string;
  }>;
  stateSummary: {
    focusProductId: string | null;
    pendingBotQuestion: 'color' | 'size' | null;
    pendingProductId: string | null;
    awaitingOrderConfirmation: boolean;
    cartStatus: 'building' | 'checking_out' | null;
  };
  /** مغلقة — لا يجوز للمُفسّر اختراع id خارجها */
  allowedProductIds: string[];
  cartLines: Array<{
    lineId: string;
    productId: string;
    productName: string;
    color: string | null;
    size: string | null;
    quantity: number;
    currency: string;
    allowedColors: string[];          // من الكتالوج لهذا المنتج
    allowedSizes: string[];
  }>;
};
```

---

## 3) المخرج (Output) — مفردات مغلقة

```ts
type InterpreterActionType =
  | 'set_focus_product'
  | 'ask_clarification'          // سؤال واحد كحد أقصى لكل رد
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
  | 'ask_product_info'           // سعر / تفاصيل / توفر
  | 'provide_identity_field'     // name | phone | address
  | 'affirm_order'
  | 'deny_order'
  | 'handoff_human'
  | 'noop';

type InterpreterAction = {
  type: InterpreterActionType;
  productId?: string;            // ∈ allowedProductIds فقط
  lineId?: string;               // ∈ cartLines.lineId فقط
  color?: string;                // ∈ allowedColors للسطر/المنتج
  size?: string;                 // ∈ allowedSizes
  quantity?: number;             // عدد صحيح > 0
  identityField?: 'name' | 'phone' | 'address';
  identityValue?: string;
  infoKind?: 'price' | 'details' | 'availability';
  confidence: number;            // 0..1
  evidenceSpan: { start: number; end: number }; // فهارس UTF-16 في message
  ambiguous: boolean;
};

type InterpreterResult = {
  actions: InterpreterAction[];  // عدة إجراءات لنفس الرسالة مسموحة
  rawModelConfidence: number;
};
```

**قواعد المفردات:**  
- أي `productId` / `lineId` / لون / مقاس خارج القوائم → رفض الإجراء عند التحقق.  
- `ask_clarification` لا يُجمع مع إجراءات مُلزِمة لنفس الحقل في نفس الدور.  
- `handoff_human` يقصّر بقية الإجراءات غير الآمنة.

---

## 4) ماذا يتحقق منه الكود وكيف يُطبَّق

### التحقق (`validateInterpreterResult`) — دوال نقية

- مخطط JSON + أنواع مغلقة.
- كل id ∈ القوائم المقدَّمة.
- `confidence ∈ [0,1]`؛ `evidenceSpan` ضمن طول الرسالة.
- على الأكثر **`ask_clarification` واحد**.
- تعارضات: مثلاً `cancel_order` مع `affirm_order` → رفض المجموعة واستدعاء سياسة الفشل.
- لا يُسمح بإنشاء طلب (`confirm`) من المُفسّر مباشرة — فقط `affirm_order` علم؛ التثبيت يبقى لسكة I4 الحالية.

### التطبيق

| Action | التطبيق |
| --- | --- |
| `select_color` / `correct_variant` / `select_size` / `set_quantity` | `cartLineOps` تحديث السطر `lineId` |
| `add_product` | إضافة/دمج سطر عبر `cartLineOps` / `conversationCart` |
| `remove_line` | `removeCartLineById` |
| `cancel_order` | تفريغ السلة + إنهاء مسار الطلب (نفس أثر سكة whole_cancel) |
| `set_focus_product` | تحديث `extracted_entities.product_id` / recommended |
| `request_photo` / `refuse_photo` | أعلام للـ pipeline (I5) بدل heuristics الصورة |
| `provide_identity_field` | كتابة الحقل في الحالة ثم قوالب `collect_info` إن لزم |
| `affirm_order` / `deny_order` | تغذية `resolveOrderNextAction` / سياسة التأكيد |
| `ask_product_info` / `browse_catalog` | ضبط turn intent قبل القوالب (منع I1 على browse) |
| `handoff_human` | `next_action=handoff` |
| `ask_clarification` | توليد **سؤال واحد** حتمي من قالب قصير؛ لا LLM للنص إن أمكن |
| `noop` | لا شيء |

### عتبات الثقة وسياسة التوضيح

| confidence | السلوك |
| --- | --- |
| **≥ 0.80** وغير `ambiguous` | تطبيق الإجراء |
| **0.55 – 0.80** أو `ambiguous=true` | لا تطبيق مُلزِم؛ إن لزم → `ask_clarification` واحد فقط |
| **< 0.55** | تجاهل إجراء المُفسّر لهذا النوع؛ في مرحلة الظل/الأولى: الرجوع للمصنّف القديم لنفس الدور فقط |

لا يُطرح أكثر من سؤال توضيح واحد لكل رد بوت.

---

## 5) القائمة البيضاء الحتمية (لا تمر بالمُفسّر / LLM)

تبقى في الكود دائماً (حتى بعد حذف keyword classifiers للأنواع الأخرى):

1. **طلب تحويل لبشر** — عبارات handoff صريحة موثّقة (ملف ضيق منفصل، ليس «فهماً» عاماً).
2. **«هل أنت بوت؟» / asks-if-bot** — رد هوية ثابت.
3. **نعم/لا العاريان** عندما `pending_bot_question` أو `awaiting_order_confirmation` مفعّل — ربط مباشر بالفعل المعلّق (`affirm_order` / `deny_order` / إجابة لون قصيرة عبر pending الحالي إلى أن يُستبدل).

كل ما عدا ذلك من فهم نص العميل يُرحَّل تدريجياً إلى المُفسّر حسب §6.

---

## 6) ترتيب الترحيل حسب عدّاد الإخفاقات

واحد **TURN TYPE** في كل مرة. المصدر: `BASELINE_BREAKDOWN.md` §a–§خلاصة.

| الترتيب | النوع | لماذا | عتبة الخروج (exit) قبل حذف الـ keyword |
| ---: | --- | --- | --- |
| 1 | color/size selection | أكبر soft-fail (أسود→qa) | gate: نوع الدور ≥ **baseline** و **≥ 95%** قرار المُفسّر vs معلّم؛ **0** فشل P0 سلة على 3 تشغيلات `test-live` |
| 2 | photo refusal / photo request | رفض صورة ما زال يعد بالlexeme | ≥ baseline النوع؛ I5 = **100%** على 3 تشغيلات |
| 3 | collect name/phone/address | S10 أرقام الهوية | ≥ baseline؛ لا `ungrounded` على phone/address من الملخص؛ I4 = **100%** |
| 4 | variant change | S14 / I3 | ≥ baseline؛ توافق مع `test_p0_cart_integrity` تصحيح اللون؛ I3 يُحدَّث لقبول تغيّر خيار على نفس `lineId` |
| 5 | order-intent + quantity | ساعتين / بدي + منتج | ≥ baseline؛ لا browse على طلب صريح عندما `productId` ∈ القائمة |
| 6 | add product | ضيف القميص | ≥ baseline؛ لا فقدان أسطر (I3) |
| 7 | remove/cancel line | الغي القميص | ≥ baseline؛ يطابق `classifyInterimCancelIntent` الذهبي ثم يستبدله |
| 8 | cancel order | ألغي الطلب كله | ≥ baseline؛ I4 لا يُكسر |
| 9 | confirm/yes-no | (معظمها whitelist) | توثيق فقط إن بقي شيء خارج whitelist |
| 10 | browse-all / product details/price / availability | قوية اليوم (~100%) | ظل فقط إن انحدار؛ عتبة ≥ **98%** |
| 11 | gift/budget / injection / handoff | غير مغطاة / نادرة | تُضاف سيناريوهات ثم ظل |

### بروتوكول لكل نوع

1. **SHADOW (playground):** المُفسّر يعمل؛ القرار الفعلي يبقى للمصنّف الحالي؛ يُسجَّل disagreement (مدخل، خرج المُفسّر، خرج القديم، الحالة) بلا أسرار.
2. **FLIP:** عندما `test-live --gate` يظهر معدل النوع **≥ معدل BASELINE لذلك النوع** و**صفر إخفاقات P0** (I3/I4/فقدان سطر / طلب بلا تأكيد) عبر **3 تشغيلات** متتالية.
3. **DELETE:** بعد **أسبوع** من FLIP مستقر، حذف keyword/interim الخاص بهذا النوع فقط؛ الإبقاء على whitelist §5.

---

## 7) اختيار النموذج والميزانية

| | Small (مرشّح أول للظل) | Medium (إن هبطت الدقة) |
| --- | --- | --- |
| أمثلة | `gpt-4o-mini` (الحالي في العميل) | `gpt-4o` أو معادل structured |
| ميزانية زمنية | **≤ 800 ms** p95 لكل دور مُفسّر | ≤ 1500 ms |
| تكلفة | **≤ $0.0004** / دور تقديرياً | ≤ $0.002 / دور |
| temperature | **0** أو **0.1** | 0.1 |
| خرج | JSON فقط | JSON فقط |

### دعم العميل الحالي (`backend/src/ai/gemini-client.ts`)

- `generateJSON` يستدعي `generateSimple` ثم `JSON.parse` بعد نزع سياج \`\`\` — **لا** `response_format: json_object` في `chat.completions.create` اليوم.
- PHASE 4 يجب إما: (أ) إضافة خيار structured/JSON mode في العميل عند توفره، أو (ب) الإبقاء على parse + تحقق صارم كما اليوم.
- لا تُخلط محاسبة المُفسّر مع رد المبيعات في نفس الـ prompt.

### التحقق من JSON المُفسّر

1. parse ناجح.  
2. `validateInterpreterResult` (أعلاه).  
3. رفض جزئي للإجراءات غير الصالحة مع الإبقاء على الصالح إن غير متعارض (سياسة صريحة في الكود).

### الفشل والرجوع

| المرحلة | timeout / JSON باطل / ثقة منخفضة |
| --- | --- |
| **SHADOW / أول نوع بعد FLIP (أول أسبوع)** | المصنّف القديم **لنفس الدور فقط**؛ يُسجَّل الحدث |
| **بعد استقرار النوع** | **لا صمت:** إن فشل المُفسّر → `ask_clarification` أو handoff سياسة؛ لا تطبيق إجراءات سلة تخمينية |

---

## 8) خطة الاختبار

### سيناريوهات جديدة لكل TURN TYPE

- امتداد `liveEval/liveScenarios.ts` + golden mocked في `test_*` لكل نوع في جدول §6.
- لكل نوع: ≥ 5 سكربتات متعددة الأدوار + paraphrase للهجات على المفاتيح.

### كيف يسجّل `test-live` قرار المُفسّر منفصلاً عن نص الرد

حقول إضافية لكل دور (لا تكسر فاحص الحقائق):

```ts
type LiveTurnInterpreterScore = {
  interpreterActions: InterpreterActionType[];
  interpreterValid: boolean;
  interpreterApplied: boolean;       // false في SHADOW
  agreementWithLegacy: boolean | null;
  decisionClassFromInterpreter: DecisionClass;
  replyFactsPassed: boolean;         // كما اليوم
  invariantsPassed: boolean;
};
```

- **درجة القرار:** تطابق `actions[]` مع المتوقع في السكربت (ids/أنواع) — مستقل عن صياغة الرد.
- **درجة الرد:** `checkReplyFacts` + I1–I5 كما في 1B.
- التقرير: معدل قرار المُفسّر لكل TURN TYPE بجانب معدل الرد؛ الـ gate يمكن أن يفرض الاثنين بعد FLIP.

### بوابات

- الإبقاء على `backend/test-live.thresholds.json` + `--gate`.
- إضافة عتبات فرعية `byTurnType` ولاحقاً `interpreterByTurnType` دون تخفيض صامت لـ P0.

---

## 9) حدود هذه الوثيقة

- تصميم فقط — لا وحدات إنتاج، لا تغيير `processWithSalesGPT` في PHASE 4-PREP.
- لا تُستبدل قوائم interim الموثّقة قبل انتهاء بروتوكول الظل للنوع المعني.
- أي تعديل على تعريف I3 (لون على نفس `lineId`) يُوثَّق في CHANGELOG مع إعادة قياس BASELINE.

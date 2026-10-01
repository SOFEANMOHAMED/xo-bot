# VARIANT_ENGINE — محرك متغيرات المنتج

**الحالة:** V1–V5 منفَّذة. المقاس واللون مربوطان في `processWithSalesGPT` عبر المحرك. `orderColorPolicy` أغلفة + adapter مرادفات (`COLOR_CANONICAL`).  
العربية للشرح؛ المعرّفات والمسارات والـ JSON بالإنجليزية.

المرجع: تدقيق بنيوي 2026-09-24 (خانتان ثابتتان `color`/`size`؛ اللون موصول؛ المقاس نصف موصول).  
عقد المُفسّر الحالي (`docs/INTERPRETER_CONTRACT.md`) ما زال `select_color` / `select_size` — يُحدَّث لاحقاً إلى `select_variant` بعد استقرار المحرك، وليس في V0.

---

## الهدف

معاملة لون، مقاس، وأي محور لاحق (طراز، حجم…) **بنفس السكة**: نوع + قيم كتالوج، بلا دالة مخصصة لكل اسم نوع، وبلا قائمة كلمات لفهم نية العميل.

قيود:

- قيم الكتالوج فقط هي قاموس المطابقة.
- حد استخراج موحّد **أضيق من P1-2** (لا «وُجدت القيمة في جملة طويلة»).
- سلوك اللون انتقل في V5 إلى عقد الاستخراج الصارم (جملة طويلة فيها اسم لون ≠ اختيار).
- `products.colors` / `products.sizes` تبقى مصدر الحقيقة لهذين المحورين — بلا إعادة كتابة صفوف قديمة.

---

## (أ) بنية البيانات

### أ.1 — محور متغير (ذاكرة / عقد)

```ts
/** معرّف حر. المحوران المحجوزان: "color" | "size". */
type VariantAxisId = string;

type VariantAxis = {
  id: VariantAxisId;
  labels: { ar: string; en: string };
  /** القيم كما هي في الكتالوج — كل عنصر خيار بيع واحد (قد يكون مركّباً مثل «أسود وبني»). */
  values: string[];
};
```

محور **فعّال** ⇔ `values.length > 0`. لا علم منفصل يُشغَّل يدوياً.

### أ.2 — تخزين المنتج (بدون migration لكل نوع)

| المصدر | الدور | محجوز؟ |
| --- | --- | --- |
| `products.colors TEXT[]` | مصدر `id: "color"` | نعم |
| `products.sizes TEXT[]` | مصدر `id: "size"` | نعم |
| `products.variant_axes JSONB` | محاور إضافية فقط | لا — صف واحد اختياري |

شكل `variant_axes` (مثال، لا يُنفَّذ في V0):

```json
[
  {
    "id": "style",
    "labels": { "ar": "طراز", "en": "Style" },
    "values": ["رياضي", "كلاسيك"]
  }
]
```

**قاعدة الدمج عند القراءة (`effectiveAxes`):**

1. إذا `colors.length > 0` → محور `color` (تسميات ثابتة من قوالبنا: لون / Color).  
2. إذا `sizes.length > 0` → محور `size` (مقاس / Size).  
3. كل عنصر في `variant_axes` حيث `id` ليس `color` ولا `size` و`values` غير فارغة → يُضاف.  
4. إن وُجد `color` أو `size` داخل JSONB: **الأعمدة تفوز**؛ عنصر JSONB يُتجاهل (لا تعارض صامت).

هجرة **واحدة** اختيارية لاحقاً: `ALTER TABLE products ADD COLUMN variant_axes JSONB NOT NULL DEFAULT '[]'`.  
منتج بلا العمود ≡ `[]`. لا هجرة لكل نوع جديد.

واجهة التاجر الحالية (حقل ألوان + حقل مقاسات) تبقى تكتب العمودين. نوع مستقبلي = محرّر JSON/صفوف على `variant_axes`، ليس عمود SQL جديد.

### أ.3 — الحالة والمحادثة والسلة (توافق خلفي)

اليوم: `extracted_entities.color` / `.size`، `CartItem.color` / `.size`، `pending_bot_question: 'color' | 'size'`.

العقد العام (يُضاف بجانب القديم، لا يُحذف في V1–V4):

```ts
/** قيم مؤكَّدة: مفتاح = axis id، قيمة = تسمية كتالوج كما هي. */
type VariantSelection = Record<VariantAxisId, string>;

type PendingVariantQuestion = {
  axisId: VariantAxisId;
  productId: string;
} | null;
```

- `pending_bot_question` يتسع من enum مغلق إلى **نص = `axisId`**. القيم القديمة `'color'|'size'` تبقى صالحة.  
- `pending_bot_question_product_id` كما هو.  
- الكتابة إلى السلة عبر `setLineVariant(line, axisId, value)`: تحديث `line.variants[axisId]` **و** إن كان `color`/`size` تُنسَخ للحقل القديم. القراءة للون/المقاس تفضّل الحقل القديم إن وُجد حتى V6.  
- `OrderData.products[].variant` يبقى `{ color?, size? }` حتى مرحلة طلب لاحقة؛ محاور إضافية تُضاف عندها في JSONB على `order_items` — خارج V1–V5.

Shopify `product_options` / `option1/2/3` **لا** تدخل القرار في V1–V5. تُسطَّح كما اليوم إلى `colors`/`sizes`. ربطها بـ `variant_axes` مشروع منفصل بعد استقرار المحرك.

---

## (ب) واجهة الدوال (وحدة `salesgpt/variantEngine/`)

وحدة جديدة، بلا استيراد دوري من `orderConfirmationPolicy`. `orderColorPolicy.ts` أغلفة تستدعي المحرك؛ الـ **adapter** للمحور `color` فقط (مرادفات مركّبة / `COLOR_CANONICAL`) — مطابقة **قيمة↔خيار كتالوج**، ليس فهم نية.

### ب.1 — المحاور

```ts
effectiveAxes(product: Product): VariantAxis[]
axisById(product: Product, id: VariantAxisId): VariantAxis | null
isAxisActive(product: Product, id: VariantAxisId): boolean
missingAxes(product: Product, selection: VariantSelection): VariantAxis[]
selectionInCatalog(axis: VariantAxis, value: string | null | undefined): boolean
```

`missingAxes`: كل محور فعّال بلا قيمة، أو قيمته ليست عنصراً من `axis.values` (بعد adapter المحور إن وُجد).

### ب.2 — السؤال (قالب واحد)

```ts
buildAskVariantMessage(language: 'arabic' | 'english', axis: VariantAxis): string
isOurVariantAskTemplate(replyText: string, axis: VariantAxis): boolean
```

القالب الوحيد (المعنى، لا النص النهائي حرفياً قبل التنفيذ):

- عربي: `أي {labels.ar} بتحب؟` + قائمة مرقّمة من `axis.values` كما هي.  
- إنجليزي: `Which {labels.en} would you like?` + نفس القائمة.

`isOurVariantAskTemplate` يطابق **بصمة هذا القالب** (التسمية + «بتحب» / `would you like` + أن القيم الصادرة ظهرت). لا يبحث عن كلمة «لون» في رد حر من النموذج.

`buildAskColorMessage` غلاف: `buildAskVariantMessage(lang, colorAxis)`.  
`buildAskSizeMessage` غير موجود؛ المقاس من نفس القالب.

### ب.3 — pending

```ts
detectPendingAxis(replyText: string, product: Product): VariantAxisId | null
bindPendingVariantQuestion(replyText: string, state, product): PendingVariantQuestion
resolveIncomingPending(stored, lastBotReply, product): PendingVariantQuestion
```

`detectPendingAxis`: يمر على `effectiveAxes(product)` ويُعيد أول محور قالبه صادر في `replyText`. محور واحد معلّق في كل دور.

تخزين: `pending_bot_question = axisId`، `pending_bot_question_product_id = product.id`. منتج OOS: لا ربط (نفس `bindPendingBotQuestion` اليوم).

### ب.4 — استخراج إجابة (موحّد، كتالوج فقط)

```ts
extractBareVariantAnswer(message: string, axis: VariantAxis): string | null
```

عقد صارم (أضيق من `extractBareColorAnswer` الحالي حتى لا يتكرر P1-2):

1. لا قوائم نية. القاموس = `axis.values` فقط (+ adapter المحور: للون فقط، مرادفات الخيار الموجودة في `color-options.ts`).  
2. بعد إزالة حشو اختيار معروف مسبقاً في المقاس (`بدي` / please / شكرا / كلمة تسمية المحور الصادرة في **القالب** `{labels.ar|en}`) إن بقي أكثر من **3** رموز → `null`.  
3. الرسالة المتبقية يجب أن تكون **خياراً واحداً** من `axis.values` أو رقم ترتيب `1 … values.length` (نفس `extractNumericColorChoice` لكن على `axis.values`).  
4. **ممنوع** «القيمة وردت كسلسلة فرعية في جملة» (`الأسود غالي؟` → `null` على كل المحاور).  
5. نزاع ادّعاء سابق (`isPastBotClaimDispute`) وطلب صورة/توفر: `null` (بوابات موجودة، ليست قوائم أنواع جديدة).

`extractBareColorAnswer` غلاف على `extractBareCatalogAnswer` (عقد §ب.4). «الأسود غالي؟» → `null`.

### ب.5 — نفي / تغيير

```ts
type VariantChangeResolution =
  | { kind: 'apply'; axisId: VariantAxisId; value: string; lineId: string }
  | { kind: 'unchanged'; axisId: VariantAxisId; value: string; lineId: string }
  | { kind: 'unavailable'; axisId: VariantAxisId; rejected: string }
  | { kind: 'ask_which_line'; axisId: VariantAxisId; value: string }
  | { kind: 'ask_which_axis'; value: string; axisIds: VariantAxisId[] }
  | { kind: 'none' };

resolveVariantChange(input: {
  messageText: string;
  product: Product;
  cartLines: CartItem[];
  pending: PendingVariantQuestion;
  selection: VariantSelection;
}): VariantChangeResolution
```

- النفي: نفس فحص «محلي قبل القيمة» الموجود في `isCatalogColorNegated`، **مُعمَّم على سلسلة الخيار** من `axis.values` — بلا توسيع قائمة النفي، وبلا `VARIANT_OPTION_PATTERN` (قائمة ألوان/مقاسات مكتوبة). الإشارة الوحيدة أن الجملة تمس محوراً = ظهور قيمة كتالوج ذلك المحور.  
- القيمة المطلوبة = آخر ذكر إيجابي (غير منفي) ينتمي لمحور حسَمه §د.  
- `resolveVariantChange.ts` غلاف لون على `resolveVariantAxisChange`؛ تصحيح «غيّر للـ…» يبقى على adapter اللون (`isInterimVariantCorrectionIntent`).

### ب.6 — بوابة التأكيد

```ts
gateConfirmWhenVariantsInvalid(input: {
  nextAction: string;
  product: Product;
  selection: VariantSelection;
  language: Language;
  replyText: string;
}): { nextAction: string; replyText: string; missingAxis: VariantAxis | null }
```

إذا `nextAction === confirm_order` و`missingAxes` غير فارغ → لا تأكيد؛ اسأل **أول** محور ناقص بالقالب العام.  
يستبدل تدريجياً `gateConfirmWhenColorInvalid` + فراغ المقاس الصامت في الاكتمال.

### ب.7 — حسم الغموض (لون+مقاس أو أي محورين)

ترتيب إلزامي، لا تخمين:

1. **`pending.axisId` يفوز** إن وُجد وكان المحور فعّالاً. الرقم `2` يُفسَّر على قائمة ذلك المحور فقط.  
2. وإلا: لكل رمز بعد التنظيف، احسب المحاور التي القيمة ∈ `values` (أو adapter).  
   - رمز يطابق محوراً واحداً → يُخصَّص له.  
   - عدة رموز، كلٌّ حصري لمحور ناقص مختلف → تُطبَّق كلها في نفس الدور.  
3. **رمز يطابق محورين أو أكثر** → `{ kind: 'ask_which_axis' }` — سؤال توضيح واحد: «تقصد المقاس L ولا خيار اللون L؟» (التسميات من `labels` + القيمة الحرفية). لا اختيار افتراضي.  
4. لا رمز يطابق أي قيمة كتالوج → `none` (المسار يكمل لغير المتغير).

لا تُستخدم كلمة «لون»/«مقاس» في رسالة العميل كحكم؛ الحكم = انتماء القيمة للكتالوج + pending.

---

## ترتيب الحقن في `processWithSalesGPT`

بعد حلّ التركيز، **قبل** تأكيد fast-path، نفس موضع سكك اللون/pending الحالية:

1. `effectiveAxes(focus)`  
2. `resolveVariantChange` (إن ليس `none`) → رجوع مبكر  
3. `resolvePendingVariantAnswer` إن `pending`  
4. بقية السلة / التأكيد / الوكيل  
5. قبل الخروج: إن الدور order-ish و`mayReplaceWithOrderTemplate` → سؤال لون من القالب العام إن ناقص؛ وإلا سؤال مقاس إن ناقص.

`agent.ts` يبقى يصف المحاور الفعّالة في الـ prompt من `effectiveAxes` (أسماء+قيم) بدل `hasColors`/`hasSizes` المنفصلين — في مرحلة متأخرة (V4+) حتى لا يتغيّر نص الـ prompt قبلها.

---

## (ج) خطة الترحيل

كل مرحلة: اختبار وحدة خاص + `test-all` أخضر. `test-live --gate` فقط إذا لمس المسار الحي أو القوالب الصادرة.

| مرحلة | ماذا | سلوك اللون | اختبار يكفي |
| --- | --- | --- | --- |
| **V0** | هذه الوثيقة + بند السجل | كما هو | — |
| **V1** | **تم** — `effectiveAxes` من `colors`/`sizes` + `variant_axes` في الذاكرة (لا عمود SQL بعد). لا ربط من `index.ts` | مطابق | `npm run test-variant-engine` |
| **V2** | **تم** — `pending_bot_question` نوعه `string`؛ الكتابة من الـ pipeline ما زالت color/size عبر `detectPendingBotQuestion` | مطابق | `test-pending-bot-question` + typecheck |
| **V3** | **تم** — قالب عام + `extractBareVariantAnswer` (جملة طويلة → null) + تغيير/بوابة/حسم غموض — وحدة فقط | مطابق | ذهبية في `test_variant_engine.ts` |
| **V4** | **تم** — المقاس على المحرك في `processWithSalesGPT`: فرض سؤال إن `size` ناقص (بعد اكتمال اللون أو بلا ألوان) + بوابة تأكيد مقاس فقط + `extractBareVariantAnswer` + `setLineVariant`. اللون ما زال `orderColorPolicy` | مطابق على real3 (بلا مقاس) | `npm run test-v4-size-pipeline`؛ **test-live ten قد يتغيّر** (فستان/حذاء/عطر) |
| **V5** | **تم** — نقل **اللون** فوق المحرك: `buildAskColorMessage` و`extractBareColorAnswer` و`resolveOrderColor` (فرع الرسالة الحالية) و`gateConfirmWhenColorInvalid` و`resolveVariantChange` أغلفة. عقد الاستخراج §ب.4 يسري على اللون | **يتغيّر عن قصد** على الجمل الطويلة (P1-2) | ذهبية في `test_variant_engine`؛ `أسود` / `الأسود` / `بدي الأسود` / `2` تبقى؛ `الأسود غالي؟` لم تعد اختياراً |
| **V6** | (اختياري لاحق) عمود `variant_axes` + نوع ثالث في اختبار؛ تحديث `INTERPRETER_CONTRACT` إلى `select_variant` | لا إن بقي اللون غلافاً | كتالوج اختباري بمحور `style` |

ما يُنفَّذ **ليس** في نفس PR: دمج خوارزمية `COLOR_CANONICAL` في المقاس؛ توسيع `VARIANT_OPTION_PATTERN`؛ فرض سؤال مقاس قبل V4.

---

## (د) ما الذي قد يكسر الاختبار أولاً؟

| خطوة | test-all | test-live الحالية |
| --- | --- | --- |
| V0–V3 | لا، إذا لم يُستبدل استيراد اللون | لا |
| **V4 — أول كسر حيّ محتمل** | منخفض على `REAL_TEST_*` (`sizes: []`)؛ متوسط إن سوت يستخدم قميص `test_commerce_engine` (`sizes: ['M','L']`) وانتظر `present_product` بدل سؤال مقاس | **نعم على catalog `ten`**: S20 حذاء + مقاسات؛ فستان/عطر إن مُرّوا. I1 قد يرى قالب مقاس جديداً — مسموح فقط على دور order-ish |
| **V5 — أول كسر لسلوك اللون** | إن اختباراً يتوقع أن جملة فيها اسم لون = اختيار (`الأسود غالي؟` في harness سابق) | S07 «الأسود» آمن؛ جملة لون+سؤال سعر ليست سيناريو §6 اليوم — راقب soft class |

**لا تبدأ بـ V4 أو V5 في نفس الدفع.** V4 أولاً على مقاس فقط بعد ذهبية V3. V5 بعدها ومع قائمة عبارات لون يجب أن تبقى ناجحة.

تكلفة `test-live --gate` إن لزم بعد V4/V5: نفس البوابة الحالية (~\$0.10/تشغيل كامل حسب السجل).

---

## خارج النطاق (V0)

- فهم «العميل يريد تغيير متغير» بقائمة أفعال جديدة.  
- `product_options` كمصدر قرار.  
- محاور تغيّر السعر/المخزون لكل تركيب (SKU Shopify كامل) — المحرك يختار **تسمية خيار** على سطر السلة، لا يحل `variant.id` في V1–V5.  
- إصلاح بوابات التأكيد I4 (اي / كل شي / عنوان) — مسار منفصل عن هذا المحرك.

---

## الملفات المتوقعة عند التنفيذ (لا تُنشأ في V0)

```
backend/src/services/salesgpt/variantEngine/
  types.ts
  axes.ts
  ask.ts
  extract.ts
  pending.ts
  change.ts
  gate.ts
  index.ts
backend/src/services/salesgpt/test_variant_engine.ts
```

الاستبدال في `index.ts` / `pendingBotQuestion.ts` / `resolveVariantChange.ts` / `orderColorPolicy.ts` يتم مرحلةً مرحلة حسب الجدول أعلاه، مع إبقاء الأسماء القديمة كأغلفة حتى ينتقل آخر مستدعٍ.

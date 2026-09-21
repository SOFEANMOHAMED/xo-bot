# BASELINE_BREAKDOWN — PHASE 1C (valid scoring)

- **مصدر:** `docs/BASELINE.md` + `docs/BASELINE_REPORT.json`
- **التاريخ UTC:** 2026-09-21T22:14:26Z
- **الكود المقاس:** `9ad0d99` (+ إصلاحات harness 1C في نفس الـ commit اللاحق)
- **الإجمالي:** **128/130 (98.5%)** · 272 دوراً · 42 سجل إخفاق (**2 صلب** + **40 soft أثر**)
- **أسباب الجذر:** keyword_classifier 40 · template_override 2 · state_focus_drift 0 · llm_fact_violation 0
- **v1 باطل:** `docs/BASELINE_v1_INVALID.md` (أرقام/ألوان URL، class بـ next_action، I3 على اللون)

---

## (a) حسب نوع الدور (TURN TYPE)

| TURN TYPE | Fail records | Pass rate (سيناريوهات/أدوار ذات صلة) | صلب؟ |
| --- | ---: | --- | --- |
| **browse-all** | ~12 soft | سيناريوهات browse ~100% hard؛ soft: listing يُصنَّف `qa` عبر `present_product` | لا |
| **product details/price** | ~3 soft | ~100% hard؛ S17 أحياناً `qa→order` soft | لا |
| **availability/OOS** | 0 | 100% | — |
| **color/size selection** | 0 soft صلب على اللون الصحيح | 100% بعد إصلاح الأثر | — |
| **variant change** | 0 | S14 **100%** (I3 أصلِح) | — |
| **add / remove / cancel** | 0 | 100% | — |
| **confirm / collect identity** | 1 soft | S10 **100%** hard؛ soft نادر: عنوان→سؤال لون | لا |
| **photo request** | 0 | S05 **100%** | — |
| **photo refusal** | **6 soft** | S08/playground hard 100%؛ الأثر المتوقع `order` والرد يعد بالصورة | **سلوك حقيقي** |
| **order-intent / quantity** | **~10 soft** | X_invented hard 100%؛ لا تثبيت كمية | **سلوك حقيقي** |
| **identity hijack** | **3 soft** | X_false_black hard 100%؛ «أسود»→`collect_info` اسم | **سلوك حقيقي** |
| **shoes focus / size** | **2 صلب + soft على t0** | S20 **33.3%** | **صلب حقيقي** |
| gift/budget/injection | 0 | غير مغطى | — |

---

## (ب) السيناريوهات التي كانت 0% في v1 — بعد 1C

| Id | v1 | 1C | الخلاصة |
| --- | --- | --- | --- |
| S05 | 0% | **100%** | كان باطل قياس (URL في IMAGE) |
| S10 | 0% | **100%** | كان باطل قياس (هاتف في الملخص) |
| S14 | 0% | **100%** | كان باطل قياس (I3 على تغيّر اللون) |
| S20 | 0% | **33.3%** | **فشل حقيقي باقٍ** (تركيز) |

---

## (ج) الإخفاقات الحقيقية فقط

### 1) صلب — S20 «أبيض» → ألوان الساعة (مؤكَّد focus bug)

| | |
| --- | --- |
| **الأثر** | بعد «بدي الحذاء الرياضي» ثم «أبيض»: قالب «غير متوفر» + قائمة **أسود / أحمر** (ألوان الساعة) بدل أبيض/أسود للحذاء |
| **السبب** | `template_override` + I1؛ التركيز لم يثبت على `shoes-sar-350` |
| **الموقع** | `resolveFocus` — `resolveFocus.ts` (`resolveFocus`)؛ مسار لون غير المتاح / pending — `index.ts` (~905–920 `buildUnavailableColorMessage` / ألوان `pendingProduct`)؛ بوابة القالب — `deterministicReplyGate.ts` (`mayReplaceWithOrderTemplate`) |
| **هل mocked يمر؟** | لا سيناريو حذاء mocked؛ color-focus يمر على الساعة فقط |
| **تأكيد** | **نعم — bug تركيز حقيقي** (2/3 تشغيلات صلبة) |

### 2) حقيقي (soft أثر) — رفض الصورة

| | |
| --- | --- |
| **الصياغة** | «لا أنا ما بدي الصورة أنا بس أطلب الساعة السودا» |
| **الأثر** | الرد: «تمام، رح أرسلك صورة المنتج.» · expected `order` got `qa` · بلا `[IMAGE:]` لذا I5 لا يسقط |
| **السبب** | `keyword_classifier` (أثر) — الرفض لا يمنع وعد النموذج؛ `isExplicitPhotoRequest` يلتقط ذكر «صورة» |
| **الموقع** | `pendingBotQuestion.ts:156` `isExplicitPhotoRefusal`؛ `turnIntent.ts:27` `isExplicitPhotoRequest`؛ `index.ts` (~1494) `shouldAttachImage`؛ نص الوعد من `agent.ts` `generateJSON` |
| **تأكيد** | **نعم — حقيقي** (6× soft؛ السيناريو hard ينجح لأن لا I5) |

### 3) حقيقي (soft أثر) — «أنت قلت في أسود»

| | |
| --- | --- |
| **الأثر** | expected `qa` · got `order` · رد: «تمام، شو اسمك الكامل؟» |
| **السبب** | التقاط «أسود» كإجابة لون / دخول `collect_info` |
| **الموقع** | `pendingBotQuestion.ts:170` `extractBareColorAnswer`؛ قوالب الهوية — `collectInfoOrder.ts` / `orderConfirmationPolicy.ts` (`buildIdentityCollectMessage` / `resolveOrderNextAction`)؛ الفرض في `index.ts` عند `collect_info` |
| **تأكيد** | **نعم — حقيقي** (3/3 تشغيلات soft) |

### 4) حقيقي (soft أثر) — «ساعتين» / كمية

| | |
| --- | --- |
| **الأثر** | expected `order` · got `browse` أو `qa` · لا سطر كمية=2 |
| **السبب** | لا مُفسّر كمية؛ سقوط لاكتشاف/عرض |
| **الموقع** | لا matcher كمية مقصود؛ المسار العام `agent.ts` + `discover_needs`/`present_product`؛ لن يُحل بقائمة keywords (عقد المُفسّر) |
| **تأكيد** | **نعم — حقيقي** (soft؛ hard 100% لأن لا انتهاك I*/facts) |

### 5) ضوضاء soft متبقية (أثر التصنيف vs سلوك)

- **browse-all → `qa`:** رد قائمة منتجات مع `present_product`؛ `liveClassify.classifyDecision` يقدّم `present_product`→`qa` قبل اعتباره browse — ليس بالضرورة bug إنتاج.
- **S06 paraphrase «بدي الساعة»→browse/qa soft:** أحياناً بلا تثبيت سلة فوري.
- **S10 عنوان→سؤال لون (1× soft):** نادرة.
- **S17 تفاصيل قميص→order soft:** تصنيف أثر/`collect_info`.

---

## (د) `llm_fact_violation` بعد 1C

**صفر.** (كانت 13 في v1 — كلها تقريباً أرقام URL/هاتف/مقاس خارج allowlist.)

---

## أولوية الترحيل للمُفسّر (من هذا الـ breakdown)

1. **focus / order-intent للمنتج المذكّر** (S20 حذاء) — صلب P0-ish  
2. **photo refusal**  
3. **quantity / order-intent («ساعتين»)**  
4. **منع اختطاف اللون→هوية («أنت قلت في أسود»)**  
5. **color/size** (مستقر hard؛ ظل للـ soft)  
6. browse/details/availability (قوية)  

التفاصيل: `docs/INTERPRETER_CONTRACT.md` §6 (مُحدَّث 1C).

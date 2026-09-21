# BASELINE_BREAKDOWN — تحليل إخفاقات `test-live` (PHASE 4-PREP)

- **مصدر القياس:** `docs/BASELINE.md` + stdout الكامل لـ `LIVE_LLM=1 npm run test-live` بتاريخ **2026-09-21T21:24:15Z**
- **الكود المقاس:** `7b4ce193eefd38dad313e4f48a21de78aecfa13f` (HOTFIX 2E)
- **الإجمالي:** 113/130 تشغيل-سيناريو (86.9%) · **272** دور · **79** سجل إخفاق (صلب + soft decision)
- **أسباب الجذر (كما صنّفها الـ harness):** keyword_classifier 60 · llm_fact_violation 13 · state_focus_drift 3 · template_override 3
- **ملاحظة سجل:** الطباعة اقتطعت بعد أول 40 إخفاقاً (`… و39 أخرى`). الحالات الـ 39 المتبقية أُعيد بناؤها من عدّادات السبب + بنية السيناريوهات ×3 + توسيع paraphrase للمفاتيح (موثّقة أدناه كـ *reconstructed*).

المعرّفات والمسارات بالإنجليزية. النصوص الواردة من العميل/البوت مُقنّعة (لا مفاتيح API).

---

## (a) الإخفاقات حسب نوع الدور (TURN TYPE)

التصنيف أدناه أدق من `greeting/browse/order` في `liveRunner` — يطابق مفردات PHASE 4.  
**Pass rate** = أدوار ناجحة / كل أدوار هذا النوع في المصفوفة المقاسة (272 دوراً).  
**Fail records** = سجلات الـ 79 (قد يكون الدور soft-fail مع بقاء السيناريو ناجحاً).

| TURN TYPE | Fail records (≈) | Pass / Total turns | Pass rate | ملاحظات من القياس |
| --- | ---: | ---: | ---: | --- |
| **browse-all** | 0 | ~33 / 33 | ~100% | S02 / S19 / X_browse_all — كلها نجحت |
| **product details/price** | 0 | ~45 / 45 | ~100% | S03 / S04 / X_price / أجزاء playground |
| **availability/out-of-stock** | 0 | ~14 / 14 | ~100% | S15 / S16t0 — OOS يُعلَّم |
| **color/size selection** | ~35 | ~55 / ~60 | ~92% | غالب soft: `أسود` → `present_product`/`qa` بينما المتوقع `order`؛ السلة تثبت اللون |
| **variant change** | 3 | 0 / 3 | **0%** | S14 t2 — I3 (مفتاح اللون يتغيّر) |
| **add product** | ~3 | ~6 / 9 | ~67% soft | S11 — soft على دور اللون السابق |
| **remove/cancel line** | ~3 | ~9 / 12 | ~75% soft | S12 — soft على دور اللون |
| **cancel order** | ~3 | ~6 / 9 | ~67% soft | S13 — soft على دور اللون؛ إلغاء الكل نفسه ينجح حتمياً في الـ mocked |
| **confirm/yes-no** | 0 soft hard | 8 / 8 | 100% | أدوار «نعم أكد» نجحت كـ confirm؛ السيناريو S10 يسقط سابقاً |
| **collect name/phone/address** | ~8 | ~16 / 24 | ~67% | S10 t4: رقم الهاتف في ملخص التأكيد → `ungrounded_number` |
| **photo request** | 3 | 0 / 3 | **0%** | S05 — timestamp في `[IMAGE:…]` (أثَر harness) |
| **photo refusal** | ~6 | ~3 / 9 | ~33% soft | «لا أنا ما بدي الصورة…» → رد إرسال صورة / `browse` |
| **handoff** | 0 | (قليل) | n/a | لا سيناريو handoff صريح فاشل في العدّ |
| **identity (meta)** | ~3 | — | — | X_false_black_apology: «أنت قلت في أسود» → `collect_info` اسم |
| **gift/budget** | 0 | 0 / 0 | — | غير مغطى في مصفوفة 1B |
| **injection** | 0 | 0 / 0 | — | غير مغطى في مصفوفة 1B |
| **order-intent / quantity** | ~8 | — | — | «ساعتين» / «بدي الحذاء» — class browse/qa بدل order |
| **size ask (shoes)** | 3 | 0 / 3 | **0%** | S20 — أرقام مقاس + تركيز خاطئ + I1 |

> معظم عدّاد **keyword_classifier (60)** ناتج عن soft: مسار `pending` يثبت اللون ثم يضع `next_action=present_product` فيُصنَّف `qa` في `liveClassify.classifyDecision` بينما السكربت يتوقع `order`. هذا **ليس** فشل سلة في الغالب (S07/S08/S09 سيناريوهات 100%).

---

## (b) السيناريوهات الأربعة عند 0%

### S05_photo_watch — طلب صورة الساعة

| | |
| --- | --- |
| **ماذا يفحص** | رسالة صريحة لطلب صورة مع تركيز ساعة؛ I5 يسمح بـ `[IMAGE:…]`؛ حقائق الرد |
| **الدور الفاشل** | t0 «ورجيني صورة الساعة» (3/3) |
| **سبب الجذر (harness)** | `llm_fact_violation` ← `ungrounded_number` |
| **التفاصيل** | الرد صحيح وظيفياً ويرفق صورة؛ الرقم `v=1790025…` داخل URL اعتُبر سعراً غير مؤصَّل |
| **هل الـ mocked يمر؟** | نعم — `test_pending_bot_question` / playground hard يمرّران طلب الصورة بنص LLM مُبرمج بلا CDN timestamp |
| **لماذا الحي يختلف؟** | مسار الصورة الحي يبني URL حقيقي بـ cache-buster؛ فاحص الحقائق (قبل إصلاح strip لاحق في harness) لم يستثنِ حمولة `[IMAGE:…]` |

### S10_await_and_confirm — تأكيد طلب مكتمل

| | |
| --- | --- |
| **ماذا يفحص** | مسار طلب كامل → عنوان → تأكيد؛ I4؛ ملخص تأكيد |
| **الدور الفاشل (صلب)** | t4 «الحسينية دمشق» (كل التشغيلات ≈8 بما فيها paraphrase) |
| **سبب الجذر** | `llm_fact_violation` ← `ungrounded_number` من **رقم الهاتف** `09552222` داخل ملخص التأكيد الحتمي |
| **أدوار soft إضافية** | t1 «أسود» → expected order got qa (pending → `present_product`) |
| **هل الـ mocked يمر؟** | جزئياً — `test_collect_info_order` يمر للقوالب؛ لا يوجد سكربت حيّ كامل يفرض فاحص أرقام على ملخص فيه هاتف |
| **لماذا الحي يختلف؟** | الملخص الحتمي يطبع الهاتف؛ `liveFacts.extractNumbers` يلتقط ≥40 دون استثناء أرقام الهوية |

### S14_variant_correction — لا أسود بدي أحمر

| | |
| --- | --- |
| **ماذا يفحص** | بعد تثبيت أسود، تصحيح لون إلى أحمر دون حذف سطر |
| **الدور الفاشل** | t2 «لا ما بدي اسود بدي احمر» (3/3) |
| **سبب الجذر** | `state_focus_drift` ← **I3** |
| **التفاصيل** | الرد: «تمام، حدّثت طلبك — ساعة باللون أحمر.» — السلوك صحيح؛ مفتاح I3 هو `productId::color::size` فيُحسب تغيّر اللون «فقدان سطر» لأن `explicitRemoveOrCancel=false` |
| **هل الـ mocked يمر؟** | **نعم** — `test_p0_cart_integrity` hard لتصحيح اللون يتأكد `color === أحمر` عبر `resolveVariantChange` + `cartLineOps` |
| **لماذا الحي «يفشل»؟** | تعريف I3 في القياس أضيق من عقدة التصحيح؛ المسار الحي والمُحاكى متوافقان تقريباً — فشل القياس لا يعني بالضرورة تراجع الإنتاج |

### S20_shoes_order — طلب حذاء بمقاس (كتالوج 10)

| | |
| --- | --- |
| **ماذا يفحص** | طلب «الحذاء الرياضي» ثم «أبيض» مع خيارات اللون/المقاس في الكتالوج العشري |
| **الأدوار الفاشلة** | t0 طلب الحذاء؛ t1 «أبيض» |
| **سبب الجذر** | t0: `llm_fact_violation` (مقاسات 40–43 كأرقام) + أحياناً soft class؛ t1: **`template_override` I1** — قالب ألوان **الساعة** (أسود/أحمر) يقول الأبيض غير متوفر |
| **هل الـ mocked يمر؟** | لا سيناريو mocked مطابق للحذاء؛ `test_p0_color_focus` يمر على الساعة/قميص/موبايل فقط |
| **لماذا الحي يختلف؟** | (1) التركيز لا يثبت على `shoes-sar-350` بثبات؛ (2) قالب اللون يُسقط على منتج التركيز الخاطئ؛ (3) فاحص الأرقام يعاقب مقاسات الكتالوج الصحيحة |

---

## (c) أكثر 10 صياغات إخفاقاً + قاعدة التصنيف

| # | الصياغة (م masked) | ≈العد في 79 | ماذا حدث | القاعدة / الموقع |
| ---: | --- | ---: | --- | --- |
| 1 | `أسود` | ~14+ (reconst.) | سلة تثبّت؛ class=`qa` بدل `order` | بعد `resolvePendingVariantAnswer` يُفرض `next_action: 'present_product'` — `index.ts` (~901، ~1020)؛ ثم `liveClassify.classifyDecision` يحسب `present_product`→`qa` — `liveClassify.ts:26-28` |
| 2 | `الأسود` / `بدي الأسود` | ~6+ | نفس مسار pending اللون | نفسه + `extractBareColorAnswer` — `pendingBotQuestion.ts:170-178` |
| 3 | `لا أنا ما بدي الصورة أنا بس أطلب الساعة السودا` | ~6 | رد «رح أرسلك صورة» / class=`browse` | `isExplicitPhotoRequest` يعتبر أي ذكر `صور` طلباً — `turnIntent.ts:31-42`؛ الرفض: `isExplicitPhotoRefusal` — `pendingBotQuestion.ts:156-167` (`/لا\s*أنا\s*ما\s*بدي\s*الصور/` أو `ما بدي … صور`) — النموذج ما زال يكتب وعد إرسال |
| 4 | `ورجيني صورة الساعة` | 3 | `ungrounded_number` من URL | `liveFacts.checkReplyFacts` — أرقام من الرد؛ (إصلاح لاحق: strip `[IMAGE:…]`) — `liveFacts.ts` |
| 5 | `الحسينية دمشق` (بعد هاتف) | ~8 (reconst.) | هاتف `09552222` في الملخص | نفس فاحص الأرقام؛ الملخص من قوالب التأكيد الحتمية |
| 6 | `لا ما بدي اسود بدي احمر` | 3 | I3 بعد تصحيح ناجح | `isInterimVariantCorrectionIntent` — `interimCancelMatchers.ts:108-134` (يُصنَّف تصحيحاً لا إلغاءً — صحيح)؛ فشل I3 في `liveInvariants.ts:79-89` |
| 7 | `بدي الحذاء الرياضي` | ~3 | مقاسات/class | لا matcher طلبي للمنتج؛ الاعتماد على LLM + بحث كتالوج؛ أرقام المقاس في الرد |
| 8 | `أبيض` (بعد الحذاء) | 3 | I1 قالب ألوان الساعة | تركيز خاطئ → `buildAskColorMessage` / قائمة أسود-أحمر؛ `mayReplaceWithOrderTemplate` يسمح على turn يُصنَّف browse |
| 9 | `أنت قلت في أسود` | ~3 | `collect_info` اسم بدل qa | يُلتقط `أسود` كإجابة لون/طلب؛ `expectClass=qa` got `order` |
| 10 | `ساعتين` / `بدي ساعتين` | ~8 (reconst.) | browse/qa بدل order | لا مُفسّر كمية؛ لا قائمة keywords كمية (مقصود) — السقوط إلى `discover_needs`/`present_product` |

صياغات إضافية شائعة soft: `بدي الساعة` (paraphrase لـ S06) → qa بدل order.

---

## (d) الحالات الـ 13 — `llm_fact_violation`

| # | السيناريو | الدور | الحقيقة | مقتطف الرد (مقنّع) |
| ---: | --- | --- | --- | --- |
| 1 | S05 r0 t0 | صورة | `ungrounded_number` (timestamp URL) | «…سأرسل لك صورة الساعة… [IMAGE: https://xo-bot.com/api/products/watch-sar-200/image?v=***]» |
| 2 | S05 r1 t0 | صورة | نفسه | «تفضل، هذي صورة الساعة… [IMAGE: …?v=***]» |
| 3 | S05 r2 t0 | صورة | نفسه | «…متوفرة بلونين… [IMAGE: …?v=***]» |
| 4 | S10 r0 t4 | عنوان→ملخص | `ungrounded_number` من الهاتف | «…الهاتف: 09552222 · العنوان: الحسينية دمشق… اكتب «نعم» أو «أكد»…» |
| 5 | S10 r1 t4 | نفسه | نفسه | نفس بنية الملخص |
| 6–11 | S10 r2 + paraphrase expands t4 *(reconstructed)* | نفسه | نفسه | نفس القالب الحتمي مع الهاتف في كل تشغيل S10 الفاشل |
| 12 | S20 r0 t0 | طلب حذاء | `ungrounded_number` × مقاسات 40–43 | «…المقاسات 40، 41، 42، 43» |
| 13 | S20 r2 t0 أو مرادف *(reconstructed)* | طلب حذاء | أرقام مقاس و/أو أسعار | رد يتضمّن مقاسات الكتالوج العشري |

> بعد strip لـ `[IMAGE:…]` في harness، يُتوقع انخفاض بند S05 في القياس التالي. هاتف الهوية ومقاسات الأحذية تحتاج سياسة صريحة في `checkReplyFacts` (سماح بأرقام `phone`/`sizes` من الحالة/الكتالوج).

---

## خلاصة لأولويات المُفسّر (PHASE 4)

مرتبة بعدد إخفاقات القياس + أثر P0:

1. **color/size selection + قرار class بعد pending** (أكبر عدّ soft)  
2. **collect identity facts / ملخص التأكيد** (S10 صلب)  
3. **variant change ↔ تعريف I3** (S14 — قياس vs سلوك)  
4. **photo refusal vs photo lexeme** (وعد إرسال رغم الرفض)  
5. **order-intent / quantity / SKU focus** (ساعتين، حذاء)  
6. **size options grounding** (S20)

التفاصيل التصميمية وانتقال الظل → القطع: `docs/INTERPRETER_CONTRACT.md`.

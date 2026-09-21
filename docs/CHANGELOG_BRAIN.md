# سجل تغييرات عقل البوت

الأحدث أولاً. المعرّفات والمسارات بالإنجليزية.

---

## 2026-09-21 12:40 UTC — PHASE 2C ITEM 1 / pending_bot_question + image policy — فرع `main`

- **الهاش:** يُطابق `git log -1 --format=%H` بعد هذا الـ commit.
- **ماذا تغيّر والسبب الجذري:** رد «الأسود» بعد سؤال اللون كان يُفسَّر كطلب صورة من تاريخ العرض (`preferSendImage` / `variantAfterPhotoOffer` / عروض الصورة السابقة). أُضيفت حالة `pending_bot_question` مربوطة بـ `product_id` من قوالب السؤال الحتمية فقط، ومسار أولوية يُسجّل اللون على سطر ذلك المنتج بلا صورة؛ الرفض الصريح يكبت الصورة؛ الإرفاق فقط عند `isExplicitPhotoRequest` للرسالة الحالية.
- **الملفات / الدوال:**
  - `pendingBotQuestion.ts` — `detectPendingBotQuestion` / `bindPendingBotQuestion` / `resolvePendingVariantAnswer` / `isExplicitPhotoRefusal` / …
  - `index.ts` — سكة pending أولاً؛ `shouldAttachImage = isExplicitPhotoRequest && !isExplicitPhotoRefusal`؛ ربط القالب عند الخروج
  - `agent.ts` — حذف heuristics: `preferSendImage` · `variantAfterPhotoOffer` · `lastAssistantOfferedPhoto` · `previousUserAskedForPhoto` · `lastAssistantAskedColorChoice` · `isCatalogOrShortColorReply`
  - `turnIntent.ts` — تجاهل `variantAfterPhotoOffer`؛ الصورة من الرسالة الحالية
  - `orderConfirmationPolicy.ts` — `preferSendImage` deprecated/unused
  - `types.ts` — حقول `pending_bot_question*`
  - اختبارات: `test_pending_bot_question.ts` (يغادر KNOWN_PENDING) · playground صورة hard · golden بدون إجبار send_image
  - `testSkip.ts` / `BOT_BRAIN_MAP.md` / `CHANGELOG_BRAIN.md`
- **اختبارات:** typecheck PASS. `test-pending-bot-question` PASS (يغادر القائمة). playground: لا IMAGE على «الأسود» ولا على الرفض.
- **أثر السلوك:** اختيار لون/مقاس بعد سؤال القالب يُثبَّت على السطر الصحيح بدون صورة؛ صورة فقط بطلب صريح؛ رفض «ما بدي الصورة» يكبتها.
- **حدود معروفة:** `resolveVariantChange` / SetVariant وتصحيح «لا ما بدي اسود بدي احمر» ما زالا معلّقين (ITEM 2).

---

## 2026-09-21 11:00 UTC — PHASE 2B ITEM 2 / partial cancel + collect-info-order — فرع `main`

- **الهاش:** يُطابق `git log -1 --format=%H` بعد هذا الـ commit.
- **ماذا تغيّر والسبب الجذري:** «الغي القميص» كان يُعامل كإلغاء كلي أو يُتجاهل. أُضيف مصنّف INTERIM للأفعال + مطابقة أسماء سطور السلة + حذف عبر `cartLineOps`؛ سيناريو `collect-info-order` كـ KNOWN_PENDING لتسلسل الحقول.
- **الملفات / الدوال:**
  - `interimCancelMatchers.ts` — `classifyInterimCancelIntent` / `isInterimWholeOrderCancel` / `isInterimPartialRemoveVerb` + قائمة اختبار
  - `cartLineRemoval.ts` — `matchCartLinesForRemoval`
  - `index.ts` — مسار سريع: إلغاء كلي / حذف سطر / «مو موجود بطلبك» / سلة فارغة بصياغة طبيعية
  - `orderConfirmationPolicy.ts` — `customerCancelsOrder` يحترم المصنّف (لا يلغي عند تصحيح لون)
  - `test_interim_cancel_matchers.ts` / `test_collect_info_order.ts` / تحديث `test_p0_cart_integrity.ts`
  - `package.json` / `testSkip.ts` / `BOT_BRAIN_MAP.md` / `CHANGELOG_BRAIN.md`
- **اختبارات:** typecheck PASS. `test-all`: **15 passed، 0 failed، 6 known_pending من 21**.
- **أثر السلوك:** حذف سطر بالاسم من السلة؛ إلغاء كلي صريح؛ هدف غائب لا يمس السلة.
- **حدود معروفة:** INTERIM حتى مفسّر LLM؛ SetVariant/صور/تسلسل collect_info ما زالت معلّقة.

---

## 2026-09-21 10:52 UTC — PHASE 2B ITEM 1 / priced cartSummary — فرع `main`

- **الهاش:** يُطابق `git log -1 --format=%H` بعد هذا الـ commit.
- **ماذا تغيّر والسبب الجذري:** ملخص السلة كان «اسم × 1» بلا أسعار/عملات فيُسهّل اختراع مجموع عبر العملات. أُضيفت وحدة نقية مسعّرة ووُصلت لكل رسائل السلة وملخص ما قبل التأكيد.
- **الملفات / الدوال:**
  - `moneyFormat.ts` — `formatGroupedInteger` / `formatCatalogMoney`
  - `cartSummary.ts` — `formatCartLine` / `formatCartSummary` / `computeCartTotalsByCurrency` / `formatCartSubtotalLine`
  - `conversationCart.ts` — إعادة تصدير + `buildAddedToCartMessage` / `buildCartSyncedMessage` ب صياغة محايدة
  - `index.ts` — حقن `buildAwaitConfirmationMessage` مع ملخص مسعّر عند `await_confirmation`
  - `test_p0_cart_integrity.ts` — تأكيدات الأسعار/العملات أصبحت hard
  - `docs/BOT_BRAIN_MAP.md` / `CHANGELOG_BRAIN.md`
- **اختبارات:** typecheck PASS. P0: 23 hard-pass؛ الباقي known_pending (commerce/إلغاء/صورة).
- **أثر السلوك:** رسائل السلة والتأكيد تعرض أسعاراً ومجموعات لكل عملة؛ سطر بلا سعر يُعلَن ناقصاً.
- **حدود معروفة:** إلغاء جزئي وcommerceEngine ما زالا معلّقين (ITEM 2).

---

## 2026-09-21 10:45 UTC — PHASE 2A FIX 2 / cart merge never deletes lines — فرع `main`

- **الهاش:** يُطابق `git log -1 --format=%H` بعد هذا الـ commit.
- **ماذا تغيّر والسبب الجذري:** `replaceCartItems` كان يستبدل السلة بالمذكور فقط فيمسح الساعة عند «بدي ضيف القميص كمان». أصبح دمجاً عبر وحدة سطور نقية.
- **الملفات / الدوال:**
  - `cartLineOps.ts` — `addCartLine` / `mergeCartLines` / `updateCartLineById` / `removeCartLineById` / `ensureLineId`
  - `conversationCart.ts` — `replaceCartItems` يستدعي `mergeCartLines`؛ الكميات لا تُصفَّر
  - `index.ts` — تعليق المسار: merge لا rebuild
  - `test_conversation_cart.ts` — دمج قميص فوق ساعة يُبقي سطرين + كمية
  - `docs/BOT_BRAIN_MAP.md` — عقد الدمج
- **اختبارات:** typecheck PASS. `test-all`: **14 passed، 0 failed، 5 known_pending من 19** (لا انحدار).
- **أثر السلوك:** مزامنة متعددة المنتجات تضيف/تحدّث ولا تحذف سطور قائمة.
- **حدود معروفة:** إزالة سطر صريحة ما زالت عبر commerceEngine (معلّق)؛ ملخص الأسعار/الصور معلّقان.

---

## 2026-09-21 10:41 UTC — PHASE 2A FIX 1 / cart line color+currency — فرع `main`

- **الهاش:** يُطابق `git log -1 --format=%H` بعد هذا الـ commit.
- **ماذا تغيّر والسبب الجذري:** اللون كان يُنسَخ من المسودة إلى أي منتج (حتى بلا `colors`)، و`normalizeCart` يفرض `USD`. الإصلاح: اللون ملك السطر؛ مسح المسودة عند تغيّر التركيز؛ العملة من المنتج ثم المتجر.
- **الملفات / الدوال:**
  - `conversationCart.ts` — `canonicalizeLineColor` → `null` بلا ألوان؛ `clearDraftOnFocusChange`؛ `resolveLineCurrency`؛ `fillCartVariantsFromDraft` يرقّي مسودة مكتملة؛ `normalizeCart` بلا `USD` ثابت
  - `index.ts` — `resolveProductOrderColor` لا يورّث لوناً لمنتج بلا ألوان؛ مسح التركيز + `product_id` من المنتج المركّز
  - `types.ts` — `CartItem.lineId?` (تحضير لـ FIX 2)
  - `test_p0_cart_integrity.ts` / `test_conversation_cart.ts` — بوابات صلبة vs `KNOWN_PENDING`
  - `docs/BOT_BRAIN_MAP.md` — عقد اللون/العملة
- **اختبارات:** typecheck PASS. `test-conversation-cart` PASS. `test-p0-cart-integrity`: hard-pass للون/عملات/سطرين؛ الباقي `KNOWN_PENDING` (commerce/صور/ملخص مسعّر).
- **أثر السلوك:** قميص بلا ألوان بعد ساعة سوداء لا يرث «أسود» ولا يُسأل عن لون؛ عملات السطور تُحفظ من المنتج.
- **حدود معروفة:** `replaceCartItems` ما زال يستبدل (FIX 2)؛ سياسة الصورة وملخص الأسعار المسعّر ما زالا معلّقين.

---

## 2026-09-21 10:30 UTC — PHASE 1A / regression spec + baseline — فرع `main`

- **الهاش:** يُطابق `git log -1 --format=%H` بعد هذا الـ commit.
- **ماذا تغيّر والسبب الجذري:** مواصفات انحدار مستعادة من `dist.bak-20260920T212631Z` كـ TypeScript فقط؛ السلوك الإنتاجي الحالي لا يمرّها. بوابة صريحة عبر `KNOWN_PENDING_SUITES` + سطر `KNOWN_PENDING:`.
- **الملفات / الدوال:**
  - `backend/src/services/salesgpt/realTestCatalog.ts` — كتالوج الاختبار الثابت
  - `test_pipeline_harness_state.ts` / `test_pipeline_hooks.ts` — stub كتالوج + `generateJSON` عبر `module.register`
  - `test_p0_cart_integrity.ts` (يشمل `playground-2026-09-21`) / `test_p0_color_focus.ts` / `test_commerce_engine.ts` / `test_pending_bot_question.ts`
  - `test_verification_matrix_pending.ts` — M24–M35
  - `package.json` — سكربتات الاختبار الجديدة
  - `testSkip.ts` — `KNOWN_PENDING_SUITES`
  - `docs/CHANGELOG_BRAIN.md` — هذا السجل
- **اختبارات (`npm run typecheck` + `npm run test-all`):** typecheck PASS. **14 passed، 0 failed، 0 skipped، 5 known_pending من 19.**
  - خط الأساس (تجميع سبب الفشل):
    1. **وحدات غائبة عن main:** `commerceEngine` / `pendingBotQuestion` (وواجهاتهما) — commerce + pending + أجزاء P0.
    2. **حالة السلة/اللون في المسار الحي:** playground T5–T11 — لا يُسجَّل أسود على الساعة؛ صورة تُرفَق رغم الرفض؛ بعد «بدي ضيف القميص كمان» سطر واحد بدل اثنين؛ ملخص بلا عملات منفصلة.
    3. **تركيز اللون / grounding:** P0 color-focus — ادّعاءات ألوان/موبايل غير مقيَّدة.
    4. **M24–M35:** قدرات مستعادة ناقصة (سعر grounding، handoff، memory، نبرة منطوقة، إلخ).
- **أثر السلوك:** لا تغيير إنتاجي. لا deploy/pm2.
- **حدود معروفة / تشخيص قراءة فقط (بلا إصلاح):**
  - (a) إزالة الساعة عند إضافة القميص: انظر `processWithSalesGPT` → `shouldSyncMultiProductCart` + `replaceCartItems` (`index.ts` ~560–582، `conversationCart.ts:shouldSyncMultiProductCart:737`، `replaceCartItems:427`) — إعادة بناء السلة من المنتجات المذكورة فقط تمسح ما لم يُذكر.
  - (b) لون «اسود» على القميص: `canonicalizeLineColor` (`conversationCart.ts:132`) يعيد اللون الخام إن لم يكن للمنتج ألوان؛ `buildCartItemFromDraft` / `fillCartVariantsFromDraft` / `lockDraftIntoCart` تنسخ مسودة اللون.
  - (c) صورة مرتين + فشل التحميل: `agent.ts` يفضّل `send_image` بعد عرض صورة عند رد لون (~399–447)؛ `index.ts` يرفق `[IMAGE:]` عند `next_action===send_image` (~899–937). الرابط يُبنى مطلقاً عبر `BACKEND_URL||BASE_URL||https://xo-bot.com` + `/api/products/:id/image` (`index.ts:convertImageUrlForBot:183`، `resolve-product-image.ts:buildBotImageUrl:83`) فيُتجاهل `imageUrl` الخارجي — المتصفح يفشل إن لم يخدم الـ API الصورة.
  - (d) تكرار «ممكن أطلب عنوانك»: مسار playground يمرّ `conversationIngressQueue.enqueue` ثم `handleIncomingMessage` ثم `appendMessage` مرة لكل دفعة (`ai.controller.ts` ~163–280). الـ dedup يعتمد `externalMessageId`؛ الـ playground يولّد id فريداً كل طلب فلا يمنع النقر المزدوج. التكرار الأرجح دورَا LLM منفصلان (`collect_info`) لا دمج طابور.
  - `getRecentMessages` ASC/DESC — ما زال كما في STEP D.

---

## 2026-09-21 10:02 UTC — STEP D final touch / PHASE 0 — فرع `main`

- **الهاش:** يُطابق `git log -1 --format=%H` بعد هذا الـ commit.
- **ماذا تغيّر والسبب الجذري:** عميل pm2 المولود أثناء القفل قد يرث FD 9 ويبقي `/tmp/xobot-deploy.lock`؛ `newest_backup` قد يستعيد نسخة pinned في `dist.keep`؛ `docs/BOT_BRAIN_MAP.md` كان غير متتبَّع فيمنع `refuse_dirty_git` / DRY_RUN.
- **الملفات / الدوال:**
  - `scripts/deploy-lib.sh` — `pm2_unlocked` (`pm2 … 9>&-`)
  - `scripts/deploy.sh` / `scripts/rollback.sh` — كل استدعاءات pm2 عبر `pm2_unlocked`
  - `scripts/rollback.sh` — `newest_backup` يتخطّى `dist.keep` ويرفض إن بقيت pinned فقط
  - `scripts/test_deploy_lock_fd.sh` / `scripts/test_newest_backup_skip_pin.sh` — stubs إثبات
  - `backend/dist.keep` — تعليق: لا prune ولا auto-restore
  - `docs/BOT_BRAIN_MAP.md` — أُضيف للفهرس لتنظيف الشجرة
  - `docs/CHANGELOG_BRAIN.md` — هذا السجل
- **اختبارات:** `bash -n` + `shellcheck -x` على السكربتات المعدّلة؛ stub القفل وstub newest_backup نجحا. لم يُنفَّذ deploy/rollback/pm2.
- **أثر السلوك:** لا تغيير لعقد عقل البوت.
- **حدود معروفة:** استعادة النسخة المثبتة تتطلب تدخلاً يدوياً صريحاً (ليست عبر `rollback.sh`).

---

## 2026-09-21 09:55 UTC — STEP D re-review / PHASE 0 — فرع `main`

- **الهاش:** يُطابق `git log -1 --format=%H` بعد هذا الـ commit.
- **ماذا تغيّر والسبب الجذري:** trap داخل `swap_live_dist` لا يرث للاحقين بلا `set -E`؛ لا DRY_RUN ولا قفل؛ `sitemap.xml` متتبَّع رغم إعادة توليده؛ `prune` قد يحذف `dist.bak-20260920T212631Z`.
- **الملفات / الدوال:**
  - `scripts/deploy-lib.sh` — `acquire_deploy_lock`, `assert_live_db_connections`, `print_live_commit`, `backup_is_kept`, `wait_for_health`
  - `scripts/deploy.sh` — `set -E` + trap على المستوى الأعلى قبل المبادلة؛ `DRY_RUN=1`؛ `prune_dist_backups` يحترم `dist.keep`
  - `scripts/rollback.sh` — قفل + `assert_live_db_connections` + `print_live_commit`
  - `scripts/test_deploy_err_trap.sh` — إثبات stub للـ ERR trap
  - `backend/dist.keep` — يثبت `dist.bak-20260920T212631Z`
  - `.gitignore` + `git rm --cached public/sitemap.xml`
  - `docs/CHANGELOG_BRAIN.md` — هذا السجل + known issues
- **اختبارات:** `bash -n` OK؛ `shellcheck -x` OK (0.9.0 من apt)؛ `test_deploy_err_trap.sh` طبع التلميح وخرج ≠0؛ `npm run generate:sitemap` أعاد كتابة `public/sitemap.xml`. لم يُنفَّذ deploy/rollback/pm2.
- **أثر السلوك:** لا تغيير لعقد عقل البوت. لم تُمسّ `xobot_db` كتابةً.
- **حدود معروفة / known issues:**
  - `getRecentMessages` — `backend/src/controllers/conversation.controller.ts:getRecentMessages:1269` (تعليق ASC، SQL `ORDER BY created_at DESC` بلا `.reverse()`؛ المسار الحي للقنوات لا يستدعيه حالياً).
  - `DRY_RUN=1` ما زال يشغّل بوابة الاختبار و`pg_dump` (قراءة فقط على DB).

---

## 2026-09-21 09:49 UTC — STEP D fix / PHASE 0 — فرع `main`

- **الهاش:** يُطابق `git log -1 --format=%H` بعد هذا الـ commit.
- **ماذا تغيّر والسبب الجذري:** مراجعة STEP D: كلمة السر ظهرت في argv عبر `docker exec -e PGPASSWORD`؛ typecheck داخل `if` قد يُتخطى بسبب تعطيل errexit؛ لا نسخ احتياطي إلزامي قبل المبادلة؛ rollback كان ينقل النسخة الاحتياطية فيستهلكها. إصلاحات سكربت فقط (لم تُنفَّذ).
- **الملفات / الدوال:**
  - `scripts/deploy-lib.sh` — `dotenv_get`, `resolve_health_port`, `wait_for_health` (مشترك)
  - `scripts/deploy.sh` — `refuse_unreachable_test_db` (psql كـ postgres بلا سر)، `run_test_gate` (`typecheck && test-all`)، `build_dist_new` (rm قبل البناء)، `refuse_missing_live_extras`, `dump_production_db`, ERR trap بعد بدء المبادلة، `assert_live_db_connections`
  - `scripts/rollback.sh` — `mv dist dist.failed-*` (آخر 2)، استعادة بـ `cp -a`، حذف `dist.commit` إن غاب `.deploy-commit`، `wait_for_health`
  - `.gitignore` / `backend/.gitignore` — `dist.failed-*`
  - `docs/CHANGELOG_BRAIN.md` — هذا السجل
- **اختبارات:** لم يُعاد تشغيل `test-all` (تغيير سكربتات فقط؛ لا كود اختبار/إنتاج). `bash -n` على السكربتات الثلاثة = OK. لم يُنفَّذ deploy/rollback/build/pm2.
- **أثر السلوك:** لا تغيير لعقد عقل البوت. `getRecentMessages` ما زال DESC بلا reverse — مسار القنوات الحية لا يستدعيه (انظر التقرير).
- **حدود معروفة:** `refuse_dirty_git` ما زال يرفض شجرة متسخة؛ `public/sitemap.xml` قد يوسّخ الشجرة (يُولَّد بـ `npm run generate:sitemap` / `build`). لم يُمسّ الملف.

---

## 2026-09-21 09:44 UTC — STEP D / PHASE 0 — فرع `main`

- **الهاش:** يُطابق `git log -1 --format=%H` بعد هذا الـ commit.
- **ماذا تغيّر والسبب الجذري:**
  - **D0a:** بعد نجاح المنطق علّقت السويتات على `pool.end()` حتى مهلة 60s. السبب الجذري: استيراد `conversation.controller` يسحب `sendMerchantReply` → `whatsappWeb/inbound` → `cacheService` الذي يبدأ `setInterval` على مستوى الوحدة (بلا `unref`)، فيبقى الـ event loop حياً بعد التنظيف ولا يخرج العملية (نجاح يُحسب FAIL). في `test-conversation-state` كان هناك أيضاً عميل `pool.connect()` محتجَز بينما المساعدات تستعير من نفس الـ pool فيؤخر `end()`. الإصلاح (بنية اختبار فقط): `pool.query` بدل عميل محتجَز، و`endPoolAndExit` (سباق مهلة 2s ثم `process.exit`). `test-hybrid` كان يفترض ترتيباً ASC بينما SQL هو `ORDER BY created_at DESC`.
  - **D0b:** `test-catalog-tool` كان يخرج 0 عند «no products» فيُحسب PASS زائف. صار ينشئ تاجراً ومنتجات رميّة في `xobot_test` ويفشل إن تعذّر الـ fixture. التخطي عبر `skipSuite` فقط (`SKIPPED:`) ولا يُحسب PASS.
  - **D1:** `scripts/deploy.sh` و`scripts/rollback.sh` مكتوبان ولم يُنفَّذا.
- **الملفات / الدوال:**
  - `backend/src/database/testDbFixtures.ts` — `insertThrowawayCatalogProducts`, `endPoolAndExit`, `deleteThrowawayMerchant` (يحذف `products`)
  - `backend/src/database/test_conversation_state.ts` — بدون `pool.connect`؛ `endPoolAndExit`
  - `backend/src/database/test_hybrid_orchestrator_helpers.ts` — ترتيب DESC؛ `endPoolAndExit`
  - `backend/src/services/tools/test_catalog_tool.ts` — `runTest` مع fixture + إثباتات حقيقية
  - `scripts/deploy.sh` — `refuse_dirty_git`, `refuse_unreachable_test_db`, `run_test_gate`, `build_dist_new`, `swap_live_dist`, `restart_pm2`, `wait_for_health`
  - `scripts/rollback.sh` — `newest_backup`, `restore_newest_dist`
  - `.gitignore` / `backend/.gitignore` — `dist.new`, `dist.bak-*`, `dist.commit`
  - `docs/CHANGELOG_BRAIN.md` — هذا السجل
- **اختبارات (`npm run test-all` مرة بعد الإصلاح):** typecheck PASS. **14 passed، 0 failed، 0 skipped، 0 known_pending من 14.** `test-conversation-state` و`test-hybrid-orchestrator-helpers` يخرجان 0 خلال ثوانٍ. `test-catalog-tool` يمر على منتجات رميّة.
- **أثر السلوك:** لا تغيير لعقد عقل البوت الحي. لم يُنفَّذ build/deploy/pm2. لم يُكتب في `xobot_db`.
- **حدود معروفة:** `getRecentMessages` ما زال SQL DESC بينما تعليقه يقول ASC — الاختبار يطابق SQL. H01–H06 داخل `test-verification-matrix` يدوية داخل سويت ناجحة وليست `SKIPPED`. سكربتات النشر لم تُشغَّل.

---

## 2026-09-21 09:21 UTC — STEP C / PHASE 0 — فرع `main`

- **الهاش:** يُطابق `git log -1 --format=%H` بعد هذا الـ commit.
- **ماذا تغيّر والسبب الجذري:** لا بوابة `typecheck`/`test-all`، واللوجر كان يكتب `logs/` حتى تحت `NODE_ENV=test` فيهدد `backend/logs` الحي. أُضيفت البوابات وعُزل اللوج إلى `logs-test` مع إثبات على sandbox.
- **الملفات / الدوال:**
  - `backend/package.json` — سكربتات `typecheck`, `test-all`, `test-logger-isolation`
  - `backend/src/database/runAllTestSuites.ts` — `runNpm`, `classifySuite` (typecheck أولاً؛ FAIL يخرج 1؛ `KNOWN_PENDING_SUITES` فارغ؛ مهلة 60s لكل سويت)
  - `backend/src/database/testSkip.ts` — `skipSuite`, `markKnownPending`, `countSkippedLines`, `KNOWN_PENDING_SUITES`
  - `backend/src/utils/logger.ts` — `resolveLoggerDir`, `productionLogDir`, `pruneOldLogs` (لا تلمس مجلد الإنتاج)
  - `backend/src/database/test_logger_isolation.ts` — 11 إثبات على جذر مؤقت
  - `backend/.gitignore` / `.gitignore` — `logs-test`
  - `docs/CHANGELOG_BRAIN.md` — هذا السجل
- **اختبارات (تشغيل واحد لـ `npm run test-all`):** typecheck PASS (0 أخطاء). الحارس سابقاً 11/11. عزل اللوج 11/11. الإجمالي: 12 passed، 2 failed، 0 skipped، 0 known_pending من 14. الفاشلان: `test-conversation-state` و`test-hybrid-orchestrator-helpers` (المنطق نجح ثم `pool.end()` تجاوز 60s). لم تُصلَح السويتات الفاشلة.
- **أثر السلوك:** الإنتاج ما زال يكتب `logs/`. تحت test فقط `logs-test`. لا تغيير لعقد عقل البوت.
- **حدود معروفة:** `KNOWN_PENDING_SUITES` فارغ. `test-catalog-tool` يخرج 0 بلا منتجات في `xobot_test` فيُحسب PASS. مهلة السويت قد تقتل عملية علّقت على `pool.end()`.

---

## 2026-09-21 09:04 UTC — STEP B fix — فرع `main`

- **الهاش:** `cb2939d48ae9ea436c64b5bf36d8c0065af3e4fc`
- **ماذا تغيّر والسبب الجذري:** `psql -c` / `-v test_password=` لا يستبدل `:'var'` (يُرسل النص كما هو للخادم) فظهر `ERROR: syntax error at or near ":"` وتوقف السكربت قبل أي نسخ. الإصلاح: `\set` عبر stdin ثم `SELECT format(... %I/%L ...) \gexec`؛ كلمة السر ليست في argv/`ps` ولا `PGPASSWORD`.
- **الملفات / الدوال:**
  - `scripts/setup-test-db.sh` — `psql_single_quote`, أنبوب `\set test_password` / `\set test_user` + `\gexec`؛ فحص الصلاحيات عبر `SET SESSION AUTHORIZATION` (بلا كلمة سر في argv)
  - `docs/CHANGELOG_BRAIN.md` — هذا السجل
- **اختبارات:** حاوية scratch `postgres:16-alpine` بلا منفذ منشور (ليست `xobot-postgres`): تشغيلان exit 0؛ `xobot_test.merchants` = 0 صفوف؛ المصدر بقي 3 صفوف؛ SELECT كدور الاختبار على المصدر exit 1؛ كلمة السر غائبة عن اللوج وعن `ps`. الحاوية حُذفت بعد ذلك.
- **أثر السلوك:** لا تغيير على البوت الحي. لم يُكتب في `xobot_db` الإنتاج ولم يُشغَّل السكربت ضد `xobot-postgres`.
- **حدود معروفة:** إن منح PUBLIC صلاحية SELECT على جداول الإنتاج ففحص النهاية FAIL دون REVOKE.

---

## 2026-09-21 08:55 UTC — STEP B / PHASE 0 — فرع `main`

- **الهاش:** `daa71220ba6590f6ea1b74c595e17eea04aa4137`
- **ماذا تغيّر والسبب الجذري:** اختبارات DB كانت تقرأ تاجراً حقيقياً (`SELECT id FROM merchants LIMIT 1` أو UUID ثابت) وتتصل عبر `connection.ts` بلا تمييز لـ `NODE_ENV=test`، فأي تشغيل يهدد `xobot_db`. العزل قبل أي اختبار: قاعدة `xobot_test` بنسخ schema فقط، دور بلا صلاحيات على الإنتاج، حارس اتصال، preflight، وتاجر رميّ لكل سويت.
- **الملفات / الدوال:**
  - `scripts/setup-test-db.sh` — `docker exec xobot-postgres`؛ `pg_dump --schema-only`؛ إنشاء دور؛ كتابة `backend/.env.test` (chmod 600، بلا طباعة كلمة السر)؛ فحص PASS/FAIL لـ SELECT على `xobot_db` (بدون REVOKE/GRANT/ALTER على الإنتاج أو PUBLIC)
  - `backend/src/database/testDatabasePolicy.ts` — `isAllowedTestDatabaseName`, `assertTestDatabaseAllowed`, `preflightFatalMessage`, `UnsafeTestDatabaseError`
  - `backend/src/database/connection.ts` — `loadEnv`, `buildPoolConfig`, `createLazyTestPool` (يحمّل `.env.test` فقط تحت test ويرفض أي اسم لا ينتهي بـ `_test`)
  - `backend/src/database/testPreflight.ts` — خروج فوري إن `NODE_ENV!=test` أو `DB_NAME==xobot_db`
  - `backend/src/database/testDbFixtures.ts` — `insertThrowawayMerchant`, `deleteThrowawayMerchant`, `assertIsolatedTestDb`
  - `backend/src/database/test_connection_guard.ts` — إثبات الحارس (بدون preflight عمداً)
  - `backend/src/database/test_conversation_state.ts` / `test_hybrid_orchestrator_helpers.ts` — تاجر رميّ يُنشأ ويُحذف
  - `backend/package.json` — `NODE_ENV=test` + `--import testPreflight.ts` على كل `test-*` ما عدا `test-connection-guard`
  - `backend/.gitignore` — `.env.test`
  - `docs/CHANGELOG_BRAIN.md` — هذا السجل
- **اختبارات:** لم تُشغَّل (شرط STEP B). `setup-test-db.sh` لم يُنفَّذ. `test-connection-guard` يضم 11 `assert` تقريباً عند تشغيله لاحقاً.
- **أثر السلوك:** لا تغيير على مسار البوت الحي. تحت `NODE_ENV=test` لن يُفتح `xobot_db`. الإنتاج ما زال `dotenv.config()` + pool فوري.
- **حدود معروفة:** `test-connection-guard` بلا preflight وإلا خرج قبل إثبات الحارس. سكربت الإعداد لا يلغي صلاحيات PUBLIC على الإنتاج إن وُجدت؛ عندها الفحص النهائي FAIL والحارس يبقى الحماية. `test-catalog-tool` ما زال يختار تاجراً من DB — خارج نطاق هذه الخطوة.

---

## 2026-09-21 08:31 UTC — STEP 0 — فرع `recovered-fixes` (لم يُدمج)

- **الهاش:** `691e6e17e63bb053c4e622de0d20d707fe9bf639`
- **ماذا:** حفظ JS المترجَم من `dist.bak-20260920T212631Z` كمرجع فقط.

# سجل تغييرات عقل البوت

الأحدث أولاً. المعرّفات والمسارات بالإنجليزية.

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

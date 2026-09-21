# سجل تغييرات عقل البوت

الأحدث أولاً. المعرّفات والمسارات بالإنجليزية.

---

## 2026-09-21 09:04 UTC — STEP B fix — فرع `main`

- **الهاش:** يُطابق `git log -1 --format=%H` بعد هذا الـ commit.
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

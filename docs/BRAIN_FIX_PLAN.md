# BRAIN_FIX_PLAN — SalesGPT brain remediation

Living plan for cart / focus / reply regressions. Identifiers in English.

---

## Status (2026-09-22 / 5/6-SHORT)

| Phase | Status | Notes |
| --- | --- | --- |
| **0 / harness & gates** | Done | `test-all`, KNOWN_PENDING, logs-test |
| **1A–1C measurement** | Done | valid scoring; v1 archived |
| **2B–2F brain rails** | Done | cancel/remove, pending, variant, focus, collect, 2E, 2F |
| **5/6-SHORT polish** | **Done** | multi-run 130/130; S10 await; deploy `--gate`; merchant design pending approval |
| **4-PREP analysis** | Done (docs) | interpreter contract |
| **Phase 4 interpreter** | **Next** | Offline → shadow → flip; remaining soft class noise |

**Deploy rule:** `scripts/deploy.sh` → typecheck + test-all + `LIVE_LLM=1 npm run test-live -- --gate` (~\$0.10 LLM/deploy).

**Baseline:** `docs/BASELINE.md` — 130/130 (100%), I1–I5 100%, 0 hard; soft ≈34 label-only.

---

## §6 — Live measurement scenarios (PHASE 1B)

Twenty core scripts used by `npm run test-live` (`LIVE_LLM=1`). Catalog fixtures:
`REAL_TEST_CATALOG` (watch/shirt/mobile) and `LIVE_TEN_PRODUCT_CATALOG` (10 SKUs).

| Id | Title | Catalog | Script (customer turns) |
| --- | --- | --- | --- |
| S01 | تحية باردة | real3 | السلام عليكم |
| S02 | تصفح كتالوج | real3 | مرحبا → شو في عندكم؟ |
| S03 | سؤال سعر الساعة | real3 | كم سعر ساعة؟ (focus watch) |
| S04 | تفاصيل الساعة | real3 | شو تفاصيل الساعة |
| S05 | طلب صورة الساعة | real3 | ورجيني صورة الساعة |
| S06 | طلب ساعة بلا لون | real3 | بدي اطلب الساعة |
| S07 | اختيار لون أسود | real3 | بدي اطلب الساعة → الأسود |
| S08 | رفض الصورة بعد اللون | real3 | طلب → أسود → رفض صورة |
| S09 | جمع الاسم ثم الهاتف | real3 | طلب → لون → اسم → هاتف |
| S10 | تأكيد طلب مكتمل | real3 | … → عنوان → نعم أكد |
| S11 | إضافة قميص | real3 | ساعة+لون → ضيف القميص |
| S12 | إلغاء سطر القميص | real3 | … → الغي القميص |
| S13 | إلغاء الطلب كله | real3 | … → ألغي الطلب كله |
| S14 | تصحيح لون | real3 | أسود → لا ما بدي اسود بدي احمر |
| S15 | موبايل نافد | real3 | عندكم موبايلات؟ |
| S16 | تركيز موبايل→ساعة | real3 | موبايل → تفاصيل الساعة → الأسود |
| S17 | قميص بلا ألوان | real3 | تفاصيل القميص → بدي القميص |
| S18 | عملات منفصلة | real3 | ساعة+قميص (لا مجموع مختلط) |
| S19 | تصفح 10 منتجات | ten | شو المنتجات عندكم؟ |
| S20 | طلب حذاء بمقاس | ten | بدي الحذاء الرياضي → أبيض |

### Extras (beyond §6)

| Id | Notes |
| --- | --- |
| X_playground_2026_09_21 | Live playground transcript regression |
| X_price_greeting_regression | HOTFIX 2E price/greeting with focus |
| X_browse_all_phrasing | «حابب اعرف المنتجات الموجودة عنكن» |
| X_invented_counts | «ساعتين» quantity phrasing |
| X_false_black_apology | No false «الأسود غير متوفر» |

### Invariants (every turn)

- **I1** — template questions (color / identity / confirm summary) only on order/finalize-ish turns
- **I2** — no mixed-currency sum in reply
- **I3** — cart never loses a line without explicit remove/cancel
- **I4** — no order without explicit confirmation
- **I5** — `[IMAGE:…]` only when the current message asks for a photo

### Paraphrases

Key turns expand across Syrian / Gulf / Egyptian dialects (8 variants each). Default matrix: each scenario ×3 runs (paraphrase index = run). `--full-paraphrases` sweeps all 8 (budget-heavy).

### Gate

`LIVE_LLM=1 npm run test-live -- --gate` exits non-zero if any category drops below `backend/test-live.thresholds.json`. A deploy requires a passing gate (see `docs/CHANGELOG_BRAIN.md`).

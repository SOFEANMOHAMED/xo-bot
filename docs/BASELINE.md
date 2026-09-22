# BASELINE — live model measurement (PHASE 2F after targeted fixes)

Supersedes `docs/BASELINE_v1_INVALID.md`. Prior valid 1C was 128/130; **2F → 130/130**.

- **date (UTC):** 2026-09-22T07:56:22.102Z
- **commit:** `56f0c13cf2c049e3db61cedf982818a8bbb7994a` (2F-4; measurement includes 2F-1…4)
- **runs per scenario:** 3
- **overall:** 130/130 (100.0%)
- **LLM budget:** calls=230 promptTok=525049 completionTok=39378 estUsd≈0.102384

## Per scenario

| Scenario | Pass | Total | Rate | Title |
| --- | ---: | ---: | ---: | --- |
| S01_greeting | 8 | 8 | 100.0% | تحية باردة |
| S02_browse_catalog | 8 | 8 | 100.0% | تصفح كتالوج |
| S03_watch_price | 8 | 8 | 100.0% | سؤال سعر الساعة |
| S04_watch_details | 3 | 3 | 100.0% | تفاصيل الساعة |
| S05_photo_watch | 3 | 3 | 100.0% | طلب صورة الساعة |
| S06_order_ask_color | 8 | 8 | 100.0% | طلب ساعة بلا لون → سؤال لون |
| S07_select_color | 8 | 8 | 100.0% | اختيار لون أسود بعد سؤال |
| S08_refuse_photo | 3 | 3 | 100.0% | رفض الصورة بعد اللون |
| S09_collect_identity | 3 | 3 | 100.0% | جمع الاسم ثم الهاتف |
| S10_await_and_confirm | 8 | 8 | 100.0% | تأكيد طلب مكتمل |
| S11_add_shirt | 3 | 3 | 100.0% | إضافة قميص لطلب الساعة |
| S12_partial_cancel | 3 | 3 | 100.0% | إلغاء سطر القميص |
| S13_whole_cancel | 3 | 3 | 100.0% | إلغاء الطلب كله |
| S14_variant_correction | 3 | 3 | 100.0% | تصحيح لون: لا أسود بدي أحمر |
| S15_oos_mobile | 8 | 8 | 100.0% | موبايل نافد |
| S16_focus_mobile_to_watch | 3 | 3 | 100.0% | تركيز: موبايل ثم ساعة ثم أسود |
| S17_shirt_no_color | 3 | 3 | 100.0% | قميص بلا ألوان |
| S18_mixed_currency | 3 | 3 | 100.0% | ساعة+قميص — عملات منفصلة |
| S19_ten_catalog_browse | 8 | 8 | 100.0% | تصفح كتالوج 10 منتجات |
| S20_shoes_order | 3 | 3 | 100.0% | طلب حذاء بمقاس |
| X_playground_2026_09_21 | 3 | 3 | 100.0% | playground-2026-09-21 |
| X_price_greeting_regression | 8 | 8 | 100.0% | 2E: سعر/تحية مع تركيز ساعة |
| X_browse_all_phrasing | 8 | 8 | 100.0% | browse-all حابب اعرف المنتجات |
| X_invented_counts | 8 | 8 | 100.0% | ساعتين — كمية |
| X_false_black_apology | 3 | 3 | 100.0% | لا اعتذار زائف عن الأسود |

## Per turn type

| Turn type | Pass | Total | Rate |
| --- | ---: | ---: | ---: |
| greeting | 24 | 24 | 100.0% |
| browse | 33 | 33 | 100.0% |
| price | 22 | 22 | 100.0% |
| order | 131 | 131 | 100.0% |
| color | 17 | 17 | 100.0% |
| other | 8 | 8 | 100.0% |
| confirm | 8 | 8 | 100.0% |
| cancel | 6 | 6 | 100.0% |
| qa | 23 | 23 | 100.0% |

## Per invariant

| Invariant | Pass | Total | Rate |
| --- | ---: | ---: | ---: |
| I1 | 272 | 272 | 100.0% |
| I2 | 272 | 272 | 100.0% |
| I3 | 272 | 272 | 100.0% |
| I4 | 272 | 272 | 100.0% |
| I5 | 272 | 272 | 100.0% |

## Failures by root cause

- **keyword_classifier:** 49 (soft effect-class only; **0 hard**)
- **state_focus_drift:** 0
- **llm_fact_violation:** 0
- **template_override:** 0

## Notes

- Measurement only: catalog DB stubbed; real LLM via production client shape.
- **2F fixed:** S20 shoe focus; photo-refusal promises; «ساعتين» qty; «أنت قلت في أسود» identity hijack.
- Soft mismatches remain (e.g. ask-color turn classed browse before cart mutates; dispute replies classed order when prose nudges checkout) — not hard I*/fact fails.
- Keys never printed. **Deploy requires** `LIVE_LLM=1 npm run test-live -- --gate` pass.

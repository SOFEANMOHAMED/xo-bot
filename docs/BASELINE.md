# BASELINE — live model measurement (PHASE 1C, valid scoring)

Supersedes `docs/BASELINE_v1_INVALID.md` (contaminated harness scoring).

- **date (UTC):** 2026-09-23T08:58:41.224Z
- **commit:** `f487f275d48dcae32d66300b67191961f8d67c31`
- **runs per scenario:** 3
- **overall:** 133/133 (100.0%)
- **LLM budget:** calls=201 promptTok=459279 completionTok=34117 estUsd≈0.089362

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
| X_i4_soft_affirm_catalog | 3 | 3 | 100.0% | I4: طيب في تلفزيونات لا يؤكد طلب قميص بانتظار التأكيد |

## Per turn type

| Turn type | Pass | Total | Rate |
| --- | ---: | ---: | ---: |
| greeting | 24 | 24 | 100.0% |
| browse | 33 | 33 | 100.0% |
| price | 25 | 25 | 100.0% |
| order | 128 | 128 | 100.0% |
| color | 17 | 17 | 100.0% |
| other | 8 | 8 | 100.0% |
| confirm | 8 | 8 | 100.0% |
| cancel | 6 | 6 | 100.0% |
| qa | 26 | 26 | 100.0% |

## Per invariant

| Invariant | Pass | Total | Rate |
| --- | ---: | ---: | ---: |
| I1 | 275 | 275 | 100.0% |
| I2 | 275 | 275 | 100.0% |
| I3 | 275 | 275 | 100.0% |
| I4 | 275 | 275 | 100.0% |
| I5 | 275 | 275 | 100.0% |

## Failures by root cause

- **keyword_classifier:** 30
- **state_focus_drift:** 0
- **llm_fact_violation:** 0
- **template_override:** 0

## Notes

- Measurement only: catalog DB stubbed; real LLM via production client shape.
- Keys never printed. Deploy requires `npm run test-live -- --gate` pass.
- Paraphrase: key turns use dialect variants (×8 available); default matrix is scenario ×3 runs.

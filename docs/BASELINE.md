# BASELINE — live model measurement (PHASE 1C, valid scoring)

Supersedes `docs/BASELINE_v1_INVALID.md` (contaminated harness scoring).

- **date (UTC):** 2026-09-24T12:31:45.540Z
- **commit:** `4060367e4937f6b53f3fbfbb504425f42354375a`
- **runs per scenario:** 3
- **overall:** 67/70 (95.7%)
- **LLM budget:** calls=250 promptTok=357592 completionTok=30333 estUsd≈0.071839 ABORTED: LLM call cap reached (250)

## Per scenario

| Scenario | Pass | Total | Rate | Title |
| --- | ---: | ---: | ---: | --- |
| S01_greeting | 3 | 3 | 100.0% | تحية باردة |
| S02_browse_catalog | 3 | 3 | 100.0% | تصفح كتالوج |
| S03_watch_price | 3 | 3 | 100.0% | سؤال سعر الساعة |
| S04_watch_details | 3 | 3 | 100.0% | تفاصيل الساعة |
| S05_photo_watch | 3 | 3 | 100.0% | طلب صورة الساعة |
| S06_order_ask_color | 3 | 3 | 100.0% | طلب ساعة بلا لون → سؤال لون |
| S07_select_color | 3 | 3 | 100.0% | اختيار لون أسود بعد سؤال |
| S08_refuse_photo | 3 | 3 | 100.0% | رفض الصورة بعد اللون |
| S09_collect_identity | 3 | 3 | 100.0% | جمع الاسم ثم الهاتف |
| S10_await_and_confirm | 3 | 3 | 100.0% | تأكيد طلب مكتمل |
| S11_add_shirt | 3 | 3 | 100.0% | إضافة قميص لطلب الساعة |
| S12_partial_cancel | 3 | 3 | 100.0% | إلغاء سطر القميص |
| S13_whole_cancel | 3 | 3 | 100.0% | إلغاء الطلب كله |
| S14_variant_correction | 3 | 3 | 100.0% | تصحيح لون: لا أسود بدي أحمر |
| S15_oos_mobile | 3 | 3 | 100.0% | موبايل نافد |
| S16_focus_mobile_to_watch | 0 | 3 | 0.0% | تركيز: موبايل ثم ساعة ثم أسود |
| S17_shirt_no_color | 3 | 3 | 100.0% | قميص بلا ألوان |
| S18_mixed_currency | 3 | 3 | 100.0% | ساعة+قميص — عملات منفصلة |
| S19_ten_catalog_browse | 2 | 2 | 100.0% | تصفح كتالوج 10 منتجات |
| S20_shoes_order | 2 | 2 | 100.0% | طلب حذاء بمقاس |
| X_playground_2026_09_21 | 2 | 2 | 100.0% | playground-2026-09-21 |
| X_price_greeting_regression | 2 | 2 | 100.0% | 2E: سعر/تحية مع تركيز ساعة |
| X_browse_all_phrasing | 2 | 2 | 100.0% | browse-all حابب اعرف المنتجات |
| X_invented_counts | 2 | 2 | 100.0% | ساعتين — كمية |
| X_false_black_apology | 2 | 2 | 100.0% | لا اعتذار زائف عن الأسود |
| X_i4_soft_affirm_catalog | 2 | 2 | 100.0% | I4: طيب في تلفزيونات لا يؤكد طلب قميص بانتظار التأكيد |

## Per turn type

| Turn type | Pass | Total | Rate |
| --- | ---: | ---: | ---: |
| greeting | 8 | 8 | 100.0% |
| browse | 14 | 14 | 100.0% |
| price | 11 | 14 | 78.6% |
| order | 88 | 88 | 100.0% |
| color | 11 | 11 | 100.0% |
| other | 3 | 3 | 100.0% |
| confirm | 3 | 3 | 100.0% |
| cancel | 6 | 6 | 100.0% |
| qa | 17 | 17 | 100.0% |

## Per invariant

| Invariant | Pass | Total | Rate |
| --- | ---: | ---: | ---: |
| I1 | 164 | 164 | 100.0% |
| I2 | 164 | 164 | 100.0% |
| I3 | 164 | 164 | 100.0% |
| I4 | 164 | 164 | 100.0% |
| I5 | 164 | 164 | 100.0% |

## Failures by root cause

- **keyword_classifier:** 20
- **state_focus_drift:** 0
- **llm_fact_violation:** 3
- **template_override:** 0

## Notes

- Measurement only: catalog DB stubbed; real LLM via production client shape.
- Keys never printed. Deploy requires `npm run test-live -- --gate` pass.
- Paraphrase: key turns use dialect variants (×8 available); default matrix is scenario ×3 runs.

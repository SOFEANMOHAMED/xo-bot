# BASELINE — live model measurement (PHASE 1C, valid scoring)

Supersedes `docs/BASELINE_v1_INVALID.md` (contaminated harness scoring).

- **date (UTC):** 2026-09-21T22:14:26.133Z
- **commit:** `9ad0d99ebd1c3ef7e18d3a1df80656af3ec2db21`
- **runs per scenario:** 3
- **overall:** 128/130 (98.5%)
- **LLM budget:** calls=216 promptTok=491063 completionTok=36878 estUsd≈0.095786

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
| S20_shoes_order | 1 | 3 | 33.3% | طلب حذاء بمقاس |
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
| order | 129 | 131 | 98.5% |
| color | 17 | 17 | 100.0% |
| other | 8 | 8 | 100.0% |
| confirm | 8 | 8 | 100.0% |
| cancel | 6 | 6 | 100.0% |
| qa | 23 | 23 | 100.0% |

## Per invariant

| Invariant | Pass | Total | Rate |
| --- | ---: | ---: | ---: |
| I1 | 270 | 272 | 99.3% |
| I2 | 272 | 272 | 100.0% |
| I3 | 272 | 272 | 100.0% |
| I4 | 272 | 272 | 100.0% |
| I5 | 272 | 272 | 100.0% |

## Failures by root cause

- **keyword_classifier:** 40
- **state_focus_drift:** 0
- **llm_fact_violation:** 0
- **template_override:** 2

## Notes

- Measurement only: catalog DB stubbed; real LLM via production client shape.
- Valid **1C** scoring: number allowlist, decision-by-effect (`photo`/`order`/`qa`/`browse`), I3 by productId.
- Prior invalid run archived at `docs/BASELINE_v1_INVALID.md`.
- Keys never printed. **Deploy requires** `LIVE_LLM=1 npm run test-live -- --gate` pass.
- Paraphrase: key turns ×8 dialects; matrix = scenario ×3 + paraphrase expand under call cap.
- Real residual: S20 focus (33%); soft but real: photo-refusal, «ساعتين», «أنت قلت في أسود» — see `BASELINE_BREAKDOWN.md`.

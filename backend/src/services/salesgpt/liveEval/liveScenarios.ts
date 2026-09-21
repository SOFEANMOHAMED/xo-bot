/**
 * Live measurement scenarios — BRAIN_FIX_PLAN §6 (20) + hotfix/extras.
 */
import type { Product } from '../../../core/types.js';
import { REAL_TEST_CATALOG, REAL_TEST_MOBILE, REAL_TEST_WATCH } from '../realTestCatalog.js';
import { LIVE_TEN_PRODUCT_CATALOG } from './liveCatalog.js';
import type { DecisionClass } from './liveClassify.js';

export type LiveTurnScript = {
  /** Stable id for paraphrase lookup; optional. */
  paraphraseKey?: string;
  /** Canonical customer text (used when paraphrase missing). */
  text: string;
  /** Expected decision class (soft — recorded, not always hard-fail). */
  expectClass?: DecisionClass;
  /** When set, reply must include this product's catalog price. */
  expectPriceProductId?: string;
  /** When set, reply must mark this OOS product unavailable. */
  expectOosProductId?: string;
  /** Turn is an explicit order confirmation. */
  explicitConfirm?: boolean;
  /** Turn is an explicit remove/cancel. */
  explicitRemoveOrCancel?: boolean;
};

export type LiveScenario = {
  id: string;
  title: string;
  catalog: 'real3' | 'ten';
  /** Seed focus before turn 0 (optional). */
  seedFocusProductId?: string;
  turns: LiveTurnScript[];
  /** Key turns eligible for paraphrase expansion. */
  keyParaphraseTurns?: number[];
};

function catalogFor(kind: 'real3' | 'ten'): readonly Product[] {
  return kind === 'ten' ? LIVE_TEN_PRODUCT_CATALOG : REAL_TEST_CATALOG;
}

export function resolveScenarioCatalog(scenario: LiveScenario): readonly Product[] {
  return catalogFor(scenario.catalog);
}

/** BRAIN_FIX_PLAN §6 — twenty core measurement scripts. */
export const PLAN_SECTION6_SCENARIOS: readonly LiveScenario[] = Object.freeze([
  {
    id: 'S01_greeting',
    title: 'تحية باردة',
    catalog: 'real3',
    turns: [{ paraphraseKey: 'greeting', text: 'السلام عليكم', expectClass: 'browse' }],
    keyParaphraseTurns: [0],
  },
  {
    id: 'S02_browse_catalog',
    title: 'تصفح كتالوج',
    catalog: 'real3',
    turns: [
      { paraphraseKey: 'greeting', text: 'مرحبا', expectClass: 'browse' },
      { paraphraseKey: 'browse_all', text: 'شو في عندكم؟', expectClass: 'browse' },
    ],
    keyParaphraseTurns: [1],
  },
  {
    id: 'S03_watch_price',
    title: 'سؤال سعر الساعة',
    catalog: 'real3',
    seedFocusProductId: REAL_TEST_WATCH.id,
    turns: [
      {
        paraphraseKey: 'price_watch',
        text: 'كم سعر ساعة؟',
        expectClass: 'qa',
        expectPriceProductId: REAL_TEST_WATCH.id,
      },
    ],
    keyParaphraseTurns: [0],
  },
  {
    id: 'S04_watch_details',
    title: 'تفاصيل الساعة',
    catalog: 'real3',
    turns: [{ text: 'شو تفاصيل الساعة', expectClass: 'qa', expectPriceProductId: REAL_TEST_WATCH.id }],
  },
  {
    id: 'S05_photo_watch',
    title: 'طلب صورة الساعة',
    catalog: 'real3',
    seedFocusProductId: REAL_TEST_WATCH.id,
    turns: [{ text: 'ورجيني صورة الساعة', expectClass: 'browse' }],
  },
  {
    id: 'S06_order_ask_color',
    title: 'طلب ساعة بلا لون → سؤال لون',
    catalog: 'real3',
    turns: [{ paraphraseKey: 'order_watch', text: 'بدي اطلب الساعة', expectClass: 'order' }],
    keyParaphraseTurns: [0],
  },
  {
    id: 'S07_select_color',
    title: 'اختيار لون أسود بعد سؤال',
    catalog: 'real3',
    turns: [
      { paraphraseKey: 'order_watch', text: 'بدي اطلب الساعة', expectClass: 'order' },
      { paraphraseKey: 'color_black', text: 'الأسود', expectClass: 'order' },
    ],
    keyParaphraseTurns: [1],
  },
  {
    id: 'S08_refuse_photo',
    title: 'رفض الصورة بعد اللون',
    catalog: 'real3',
    turns: [
      { text: 'بدي اطلب الساعة', expectClass: 'order' },
      { text: 'الأسود', expectClass: 'order' },
      { text: 'لا أنا ما بدي الصورة أنا بس أطلب الساعة السودا', expectClass: 'order' },
    ],
  },
  {
    id: 'S09_collect_identity',
    title: 'جمع الاسم ثم الهاتف',
    catalog: 'real3',
    turns: [
      { text: 'بدي اطلب الساعة', expectClass: 'order' },
      { text: 'أسود', expectClass: 'order' },
      { text: 'سفيان محمد', expectClass: 'order' },
      { text: '09552222', expectClass: 'order' },
    ],
  },
  {
    id: 'S10_await_and_confirm',
    title: 'تأكيد طلب مكتمل',
    catalog: 'real3',
    turns: [
      { text: 'بدي اطلب الساعة', expectClass: 'order' },
      { text: 'أسود', expectClass: 'order' },
      { text: 'سفيان محمد', expectClass: 'order' },
      { text: '09552222', expectClass: 'order' },
      { text: 'الحسينية دمشق', expectClass: 'finalize' },
      {
        paraphraseKey: 'confirm_yes',
        text: 'نعم أكد',
        expectClass: 'finalize',
        explicitConfirm: true,
      },
    ],
    keyParaphraseTurns: [5],
  },
  {
    id: 'S11_add_shirt',
    title: 'إضافة قميص لطلب الساعة',
    catalog: 'real3',
    turns: [
      { text: 'بدي اطلب الساعة', expectClass: 'order' },
      { text: 'أسود', expectClass: 'order' },
      { text: 'بدي ضيف القميص كمان', expectClass: 'order' },
    ],
  },
  {
    id: 'S12_partial_cancel',
    title: 'إلغاء سطر القميص',
    catalog: 'real3',
    turns: [
      { text: 'بدي اطلب الساعة', expectClass: 'order' },
      { text: 'أسود', expectClass: 'order' },
      { text: 'بدي ضيف القميص كمان', expectClass: 'order' },
      { text: 'خلص بدي الغي القميص', expectClass: 'order', explicitRemoveOrCancel: true },
    ],
  },
  {
    id: 'S13_whole_cancel',
    title: 'إلغاء الطلب كله',
    catalog: 'real3',
    turns: [
      { text: 'بدي اطلب الساعة', expectClass: 'order' },
      { text: 'أسود', expectClass: 'order' },
      { text: 'ألغي الطلب كله', expectClass: 'handoff', explicitRemoveOrCancel: true },
    ],
  },
  {
    id: 'S14_variant_correction',
    title: 'تصحيح لون: لا أسود بدي أحمر',
    catalog: 'real3',
    turns: [
      { text: 'بدي اطلب الساعة', expectClass: 'order' },
      { text: 'أسود', expectClass: 'order' },
      { text: 'لا ما بدي اسود بدي احمر', expectClass: 'order' },
    ],
  },
  {
    id: 'S15_oos_mobile',
    title: 'موبايل نافد',
    catalog: 'real3',
    turns: [
      {
        paraphraseKey: 'mobile_ask',
        text: 'عندكم موبايلات؟',
        expectClass: 'qa',
        expectOosProductId: REAL_TEST_MOBILE.id,
      },
    ],
    keyParaphraseTurns: [0],
  },
  {
    id: 'S16_focus_mobile_to_watch',
    title: 'تركيز: موبايل ثم ساعة ثم أسود',
    catalog: 'real3',
    turns: [
      { text: 'في موبايلات', expectClass: 'qa', expectOosProductId: REAL_TEST_MOBILE.id },
      { text: 'شو تفاصيل الساعة', expectClass: 'qa', expectPriceProductId: REAL_TEST_WATCH.id },
      { text: 'الأسود', expectClass: 'order' },
    ],
  },
  {
    id: 'S17_shirt_no_color',
    title: 'قميص بلا ألوان',
    catalog: 'real3',
    turns: [
      { text: 'شو تفاصيل القميص', expectClass: 'qa' },
      { text: 'بدي القميص', expectClass: 'order' },
    ],
  },
  {
    id: 'S18_mixed_currency',
    title: 'ساعة+قميص — عملات منفصلة',
    catalog: 'real3',
    turns: [
      { text: 'بدي اطلب الساعة', expectClass: 'order' },
      { text: 'أسود', expectClass: 'order' },
      { text: 'بدي ضيف القميص كمان', expectClass: 'order' },
    ],
  },
  {
    id: 'S19_ten_catalog_browse',
    title: 'تصفح كتالوج 10 منتجات',
    catalog: 'ten',
    turns: [{ paraphraseKey: 'browse_all', text: 'شو المنتجات عندكم؟', expectClass: 'browse' }],
    keyParaphraseTurns: [0],
  },
  {
    id: 'S20_shoes_order',
    title: 'طلب حذاء بمقاس',
    catalog: 'ten',
    turns: [
      { text: 'بدي الحذاء الرياضي', expectClass: 'order' },
      { text: 'أبيض', expectClass: 'order' },
    ],
  },
]);

/** Extra regressions beyond §6. */
export const EXTRA_SCENARIOS: readonly LiveScenario[] = Object.freeze([
  {
    id: 'X_playground_2026_09_21',
    title: 'playground-2026-09-21',
    catalog: 'real3',
    turns: [
      { text: 'السلام عليكم', expectClass: 'browse' },
      { text: 'ممكن أعرف شو في عنكن منتجات', expectClass: 'browse' },
      { text: 'شو تفاصيل الساعة والقميص', expectClass: 'qa' },
      { text: 'بدي اطلب الساعة', expectClass: 'order' },
      { text: 'الأسود', expectClass: 'order' },
      { text: 'لا أنا ما بدي الصورة أنا بس أطلب الساعة السودا', expectClass: 'order' },
    ],
  },
  {
    id: 'X_price_greeting_regression',
    title: '2E: سعر/تحية مع تركيز ساعة',
    catalog: 'real3',
    seedFocusProductId: REAL_TEST_WATCH.id,
    turns: [
      { paraphraseKey: 'greeting', text: 'السلام عليكم', expectClass: 'browse' },
      {
        paraphraseKey: 'price_watch',
        text: 'كم سعر ساعة؟',
        expectClass: 'qa',
        expectPriceProductId: REAL_TEST_WATCH.id,
      },
    ],
    keyParaphraseTurns: [0, 1],
  },
  {
    id: 'X_browse_all_phrasing',
    title: 'browse-all حابب اعرف المنتجات',
    catalog: 'ten',
    turns: [
      {
        paraphraseKey: 'browse_all',
        text: 'حابب اعرف المنتجات الموجودة عنكن',
        expectClass: 'browse',
      },
    ],
    keyParaphraseTurns: [0],
  },
  {
    id: 'X_invented_counts',
    title: 'ساعتين — كمية',
    catalog: 'real3',
    turns: [
      { paraphraseKey: 'two_watches', text: 'ساعتين', expectClass: 'order' },
    ],
    keyParaphraseTurns: [0],
  },
  {
    id: 'X_false_black_apology',
    title: 'لا اعتذار زائف عن الأسود',
    catalog: 'real3',
    turns: [
      { text: 'شو تفاصيل الساعة', expectClass: 'qa' },
      { text: 'أنت قلت في أسود', expectClass: 'qa' },
    ],
  },
]);

export const ALL_LIVE_SCENARIOS: readonly LiveScenario[] = Object.freeze([
  ...PLAN_SECTION6_SCENARIOS,
  ...EXTRA_SCENARIOS,
]);

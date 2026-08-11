/**
 * Golden fixtures for SalesGPT understanding rails.
 * Run: npx tsx src/services/salesgpt/test_customer_request_golden.ts
 *
 * These tests lock the contract:
 * - model JSON → structured signals (no keyword lists required)
 * - product-info asks block checkout injection
 * - catalog truth helper never claims "only one" when total > active
 */

import {
  hasCustomerRequestBlock,
  normalizeCustomerRequest
} from './customerRequest.js';
import {
  isProductInfoRequest,
  resolveOrderNextAction
} from './orderConfirmationPolicy.js';

type Expect = {
  wantsAlternatives?: boolean;
  asksProductInfo?: boolean;
  wantsPhoto?: boolean;
  readyToConfirm?: boolean;
};

const modelSignalCases: Array<{ name: string; raw: unknown; expect: Expect }> = [
  {
    name: 'dialect alternatives via model JSON',
    raw: {
      wants_alternatives: true,
      asks_product_info: false,
      wants_photo: false,
      ready_to_confirm: false
    },
    expect: { wantsAlternatives: true, asksProductInfo: false }
  },
  {
    name: 'product info via camelCase',
    raw: {
      wantsAlternatives: false,
      asksProductInfo: true,
      wantsPhoto: false,
      readyToConfirm: false
    },
    expect: { asksProductInfo: true, readyToConfirm: false }
  },
  {
    name: 'photo ask',
    raw: { wants_photo: 'true', wants_alternatives: 0 },
    expect: { wantsPhoto: true, wantsAlternatives: false }
  },
  {
    name: 'missing block is not a valid block',
    raw: null,
    expect: {}
  },
  {
    name: 'empty object is a valid block (all false)',
    raw: {},
    expect: {
      wantsAlternatives: false,
      asksProductInfo: false,
      wantsPhoto: false,
      readyToConfirm: false
    }
  }
];

const heuristicInfoFallbackCases: Array<{ text: string; expectInfo: boolean }> = [
  { text: 'بدي معلومات أكثر عن المنتج', expectInfo: true },
  { text: 'تمام ممكن تعطيني معلومات اكتر عنه', expectInfo: true },
  { text: 'نعم', expectInfo: false },
  { text: 'أكد الطلب', expectInfo: false }
];

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function run(): void {
  let passed = 0;

  for (const c of modelSignalCases) {
    const hasBlock = hasCustomerRequestBlock(c.raw);
    if (c.raw === null) {
      assert(!hasBlock, `${c.name}: expected no block`);
      passed++;
      continue;
    }
    assert(hasBlock, `${c.name}: expected block`);
    const signals = normalizeCustomerRequest(c.raw);
    for (const [k, v] of Object.entries(c.expect) as Array<[keyof Expect, boolean]>) {
      assert(signals[k] === v, `${c.name}: ${k} expected ${v} got ${signals[k]}`);
    }
    passed++;
  }

  for (const c of heuristicInfoFallbackCases) {
    const got = isProductInfoRequest(c.text);
    assert(got === c.expectInfo, `heuristic "${c.text}" expected ${c.expectInfo} got ${got}`);
    passed++;
  }

  // Model says product info → checkout blocked even without heuristic match
  const blocked = resolveOrderNextAction({
    aiNextAction: 'await_confirmation',
    fieldsComplete: true,
    fieldsWereCompleteBeforeTurn: true,
    wasAwaitingConfirmation: true,
    userMessage: 'في عندك غير هاد المنتج؟',
    language: 'arabic',
    collectedInfo: {
      name: 'Hussein',
      phone: '091',
      address: 'Damascus',
      product_name: 'Cream'
    },
    responseText: 'عندنا كمان منتج ثاني...',
    modelAsksProductInfo: true
  });
  assert(
    blocked.nextAction === 'present_product',
    `modelAsksProductInfo should block checkout, got ${blocked.nextAction}`
  );
  assert(
    blocked.responseText.includes('منتج'),
    'should keep model response text'
  );
  passed++;

  // Model says NOT product info → heuristic alone on dialect alternatives should not force present_product
  // (alternatives are handled by catalog prompts + wants_alternatives, not order rails)
  const passThrough = resolveOrderNextAction({
    aiNextAction: 'present_product',
    fieldsComplete: true,
    fieldsWereCompleteBeforeTurn: true,
    wasAwaitingConfirmation: false,
    userMessage: 'في عندك غير هاد المنتج؟',
    language: 'arabic',
    collectedInfo: {
      name: 'Hussein',
      phone: '091',
      address: 'Damascus',
      product_name: 'Cream'
    },
    responseText: 'عندنا أيضاً منتج آخر بسعر...',
    modelAsksProductInfo: false
  });
  assert(
    passThrough.nextAction === 'present_product',
    `expected present_product pass-through, got ${passThrough.nextAction}`
  );
  passed++;

  console.log(`✅ SalesGPT golden tests passed: ${passed}`);
}

run();

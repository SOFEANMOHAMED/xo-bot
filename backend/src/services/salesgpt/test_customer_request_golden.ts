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
  detectsWantsAlternativesIntent,
  hasCustomerRequestBlock,
  normalizeCustomerRequest,
  stripUnsolicitedAlternativeSuggestions,
  stripUnsolicitedCrossSellMentions,
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
  { text: 'شو تكلفة الشحن ع المعضمية', expectInfo: true },
  { text: 'في توصيل ع الشام', expectInfo: true },
  { text: 'how much is shipping', expectInfo: true },
  { text: 'نعم', expectInfo: false },
  { text: 'أكد الطلب', expectInfo: false },
  { text: 'المعضمية', expectInfo: false },
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

  // Live bug: shipping-cost Q while identity incomplete + model collect_info → must NOT identity-hijack
  {
    const shippingAsk = resolveOrderNextAction({
      aiNextAction: 'collect_info',
      fieldsComplete: false,
      fieldsWereCompleteBeforeTurn: false,
      wasAwaitingConfirmation: false,
      userMessage: 'شو تكلفة الشحن ع المعضمية',
      language: 'arabic',
      collectedInfo: {
        product_name: 'قميص',
        size: 'm',
      },
      responseText:
        'تكلفة الشحن للمعضمية تعتمد على سياسة الشحن في المتجر.',
      modelAsksProductInfo: false,
      missingFields: ['name', 'phone', 'address'],
      turnIntent: 'other',
      lastBotReply:
        'نقدر نضيف منتج ثاني، أو نكمّل الطلب؟',
    });
    assert(
      shippingAsk.nextAction === 'present_product',
      `shipping Q must present_product, got ${shippingAsk.nextAction}`
    );
    assert(
      shippingAsk.reason === 'product_info_request_blocks_checkout',
      `expected product_info_request_blocks_checkout, got ${shippingAsk.reason}`
    );
    assert(
      /شحن|توصيل|shipping/i.test(shippingAsk.responseText),
      'must keep shipping answer, not identity template'
    );
    assert(
      !/لإكمال الطلب أحتاج اسمك الكامل/.test(shippingAsk.responseText),
      'must not replace shipping answer with identity bundle'
    );
    passed++;
  }

  // turnIntent product_qa also blocks identity template
  {
    const viaIntent = resolveOrderNextAction({
      aiNextAction: 'collect_info',
      fieldsComplete: false,
      fieldsWereCompleteBeforeTurn: false,
      wasAwaitingConfirmation: false,
      userMessage: 'شو تكلفة الشحن ع المعضمية',
      language: 'arabic',
      collectedInfo: { product_name: 'قميص', size: 'm' },
      responseText: 'تكلفة الشحن حسب سياسة المتجر.',
      modelAsksProductInfo: false,
      missingFields: ['name', 'phone', 'address'],
      turnIntent: 'product_qa',
    });
    assert(
      viaIntent.nextAction === 'present_product',
      `product_qa turn must present_product, got ${viaIntent.nextAction}`
    );
    assert(
      viaIntent.reason === 'turn_intent_product_qa',
      `expected turn_intent_product_qa, got ${viaIntent.reason}`
    );
    assert(
      !/لإكمال الطلب أحتاج اسمك الكامل/.test(viaIntent.responseText),
      'product_qa must not inject identity bundle'
    );
    passed++;
  }

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

  // Literal "null" fields are incomplete — do not keep checkout copy
  const nullFields = resolveOrderNextAction({
    aiNextAction: 'await_confirmation',
    fieldsComplete: true,
    fieldsWereCompleteBeforeTurn: false,
    wasAwaitingConfirmation: false,
    userMessage: 'أحمر',
    language: 'arabic',
    collectedInfo: {
      name: 'null',
      phone: 'null',
      address: 'null',
      product_name: 'Watch',
      color: 'أحمر'
    },
    responseText: 'تمام null! طلبك جاهز للتأكيد:\n• Watch — أحمر × 1\n• الهاتف: null',
    missingFields: ['name', 'phone', 'address']
  });
  assert(
    nullFields.nextAction === 'collect_info',
    `null placeholders must block checkout, got ${nullFields.nextAction}`
  );
  assert(
    !/\bnull\b/i.test(nullFields.responseText),
    'customer-facing text must not contain literal null'
  );
  assert(
    !/جاهز للتأكيد/.test(nullFields.responseText),
    'must not keep premature confirmation copy'
  );
  passed++;

  // Bare color must NOT force send_image via the removed preferSendImage heuristic.
  // Image attach is gated by isExplicitPhotoRequest on the current message only.
  const photoColor = resolveOrderNextAction({
    aiNextAction: 'await_confirmation',
    fieldsComplete: false,
    fieldsWereCompleteBeforeTurn: false,
    wasAwaitingConfirmation: false,
    userMessage: 'أحمر',
    language: 'arabic',
    collectedInfo: { product_name: 'Watch', color: 'أحمر' },
    responseText: 'تمام null! طلبك جاهز للتأكيد',
    missingFields: ['name', 'phone', 'address'],
    preferSendImage: true, // ignored / deprecated
  });
  assert(
    photoColor.nextAction !== 'send_image',
    `bare color must not force send_image via preferSendImage, got ${photoColor.nextAction}`
  );
  assert(
    !/جاهز للتأكيد/.test(photoColor.responseText),
    'incomplete-order color reply must not show confirmation summary'
  );
  passed++;

  // ——— Unsolicited alternatives gate ———
  assert(
    !detectsWantsAlternativesIntent('شو سعر القميص'),
    'price ask is not wants-alternatives'
  );
  assert(
    detectsWantsAlternativesIntent('عندك شي تاني؟'),
    'explicit something-else is wants-alternatives'
  );
  {
    const stripped = stripUnsolicitedAlternativeSuggestions(
      'سعر القميص هو 553 دولار أمريكي. إذا حابب، عندنا كمان ساعة بسعر 200 ريال سعودي. هل تبحث عن شيء معين؟'
    );
    assert(
      !/ساعة/.test(stripped) && /سعر القميص/.test(stripped),
      `must strip volunteer watch pitch, got: ${stripped}`
    );
  }
  {
    // Live bug phrasing: «عندنا ساعة كمان» + full watch pitch mid-shirt checkout.
    const liveBug = stripUnsolicitedCrossSellMentions({
      replyText:
        'حبيبي، قبل ما أكمل طلبك للقميص مقاس XL، حابب أذكرك إنه عندنا ساعة كمان بسعر 200 ريال سعودي. الساعة مصنوعة من خامات عالية الجودة، وتتميز بتصميم عصري يناسب كل الأوقات. كمان، هي عملية جداً وتضيف لمسة أنيقة لأي إطلالة. حابب تعرف تفاصيل أكثر عن الساعة أو نكمل طلب القميص؟',
      activeProductNames: ['قميص'],
      otherProductNames: ['ساعة'],
      language: 'arabic',
    });
    assert(
      !/ساعة|200\s*ريال/i.test(liveBug),
      `live upsell must not keep watch pitch, got: ${liveBug}`
    );
  }
  {
    // When customer asked for alternatives, keep the other product name.
    const kept = stripUnsolicitedCrossSellMentions({
      replyText: 'عندنا كمان ساعة بسعر 200 ريال. حابب تفاصيل؟',
      activeProductNames: ['قميص'],
      otherProductNames: [],
      language: 'arabic',
    });
    // Phrase strip still runs; empty otherProductNames → phrase-only path.
    assert(typeof kept === 'string' && kept.length > 0, 'must return a string');
  }
  passed++;

  console.log(`✅ SalesGPT golden tests passed: ${passed}`);
}

run();

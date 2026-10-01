/**
 * Scenario `collect-info-order` — identity field sequencing + partial multi-field.
 *
 * Contract:
 * - after name only → ask phone AND address together
 * - after phone (name already stored) → ask address
 * - name+phone+address in ONE message → ask nothing (await/confirm path)
 * - PARTIAL combos in one message: record given fields; ask ALL remaining missing ones
 *   (never re-ask a field provided in the same message)
 */
import type { ConversationState, MerchantConfig } from '../../core/types.js';
import { processWithSalesGPT } from './index.js';
import {
  REAL_TEST_CATALOG,
  REAL_TEST_WATCH,
} from './realTestCatalog.js';
import {
  resetHarness,
  setCatalog,
  setLlmReply,
} from './test_pipeline_harness_state.js';
import {
  ingestIdentityAnswerFromBotAsk,
  isBotIdentityBundleAsk,
  mayAcceptLlmIdentityField,
  missingIdentityFields,
  resolveIdentityCollectReply,
  IDENTITY_BUNDLE_ASK_AR,
} from './collectInfoOrder.js';
import { buildCollectMissingFieldsMessage } from './orderConfirmationPolicy.js';

let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string): void {
  if (!condition) {
    failed += 1;
    failures.push(message);
  }
}

function merchantConfig(): MerchantConfig {
  return {
    merchantId: '00000000-0000-4000-8000-000000000301',
    storeName: 'متجر تجريبي',
    storeCurrency: 'SAR',
    persona: 'friendly',
    botLanguage: 'arabic',
  };
}

function baseState(): ConversationState {
  return {
    message_count: 5,
    salesgpt_stage_id: '7',
    current_stage: 'close',
    last_recommended_products: [REAL_TEST_WATCH.id],
    extracted_entities: {
      product_id: REAL_TEST_WATCH.id,
      product_query: REAL_TEST_WATCH.name,
      color: 'أسود',
    },
    cart: {
      items: [
        {
          productId: REAL_TEST_WATCH.id,
          productName: REAL_TEST_WATCH.name,
          quantity: 1,
          unitPrice: 200,
          currency: 'SAR',
          color: 'أسود',
          addedAt: '2026-09-21T00:00:00.000Z',
        },
      ],
      status: 'building',
    },
  };
}

async function turn(
  message: string,
  state: ConversationState,
  llmText: string,
  extractedInfo: Record<string, unknown>,
  recentBotAsk?: string
) {
  resetHarness();
  setCatalog(REAL_TEST_CATALOG);
  setLlmReply({
    response_text: llmText,
    next_action: 'collect_info',
    customer_request: {
      wants_alternatives: false,
      asks_product_info: false,
      wants_photo: false,
      ready_to_confirm: false,
      wants_add_another: false,
    },
    extracted_info: extractedInfo,
  });
  return processWithSalesGPT({
    merchantId: merchantConfig().merchantId,
    messageText: message,
    recentMessages: recentBotAsk
      ? [{ role: 'assistant', content: recentBotAsk }]
      : [],
    conversationState: state,
    merchantConfig: merchantConfig(),
    platform: 'playground',
  });
}

/** Ask-templates only — not confirmation copy («• العنوان: …»). */
const ASK_NAME = /شو اسمك|what is your full name/i;
const ASK_PHONE = /رقم هاتفك|what is your phone number/i;
const ASK_ADDRESS = /عنوان التوصيل|the delivery address/i;
const ASK_BUNDLE =
  /لإكمال الطلب أحتاج اسمك الكامل ورقم هاتفك وعنوان التوصيل|to complete the order I need your full name/i;
const ASK_PARTIAL = /أحتاج كمان|I still need/i;

// ——— Unit: missingIdentityFields + resolveIdentityCollectReply ———
{
  assert(
    missingIdentityFields({ name: 'سفيان محمد' }).join(',') === 'phone,address',
    'name only → missing phone,address'
  );
  assert(
    missingIdentityFields({ name: 'سفيان', phone: '09552222' }).join(',') ===
      'address',
    'name+phone → missing address only'
  );
  assert(
    missingIdentityFields({ name: 'سفيان', address: 'دمشق' }).join(',') ===
      'phone',
    'name+address → missing phone only'
  );
  assert(
    missingIdentityFields({ phone: '09552222', address: 'دمشق' }).join(',') ===
      'name',
    'phone+address → missing name only'
  );
  assert(
    missingIdentityFields({
      name: 'سفيان',
      phone: '09552222',
      address: 'دمشق',
    }).length === 0,
    'all three → missing none'
  );

  const emptyReply = resolveIdentityCollectReply({
    language: 'arabic',
    collected: {},
    responseText: 'شو اسمك؟',
  });
  assert(
    ASK_BUNDLE.test(emptyReply.replyText),
    `empty collected must ask bundle, got: ${emptyReply.replyText}`
  );
  assert(
    emptyReply.replyText === IDENTITY_BUNDLE_ASK_AR,
    'bundle text matches constant'
  );

  const nameOnlyReply = resolveIdentityCollectReply({
    language: 'arabic',
    collected: { name: 'سفيان محمد' },
    responseText: 'شو عنوانك؟',
  });
  assert(
    ASK_PHONE.test(nameOnlyReply.replyText) && ASK_ADDRESS.test(nameOnlyReply.replyText),
    `name only must ask phone and address, got: ${nameOnlyReply.replyText}`
  );
  assert(
    !ASK_BUNDLE.test(nameOnlyReply.replyText) && ASK_PARTIAL.test(nameOnlyReply.replyText),
    'name only must ask remaining pair, not the full three-field bundle'
  );

  const namePhoneReply = resolveIdentityCollectReply({
    language: 'arabic',
    collected: { name: 'سفيان', phone: '09552222' },
    responseText: 'شو اسمك؟',
  });
  assert(
    ASK_ADDRESS.test(namePhoneReply.replyText) &&
      !ASK_NAME.test(namePhoneReply.replyText) &&
      !ASK_PHONE.test(namePhoneReply.replyText),
    `name+phone must ask address only, got: ${namePhoneReply.replyText}`
  );

  const allThreeAsk = buildCollectMissingFieldsMessage('arabic', [
    'name',
    'phone',
    'address',
  ]);
  assert(ASK_BUNDLE.test(allThreeAsk), `all three missing → bundle: ${allThreeAsk}`);

  const nameAddrAsk = buildCollectMissingFieldsMessage('arabic', ['phone']);
  assert(
    ASK_PHONE.test(nameAddrAsk) && !ASK_NAME.test(nameAddrAsk) && !ASK_ADDRESS.test(nameAddrAsk),
    `buildCollectMissingFieldsMessage phone only: ${nameAddrAsk}`
  );
}

// ——— Sequential (existing) ———
{
  const afterName = await turn(
    'سفيان محمد',
    baseState(),
    'تمام، شو عنوانك؟',
    { name: 'سفيان محمد' }
  );
  assert(
    ASK_PHONE.test(afterName.replyText) && ASK_ADDRESS.test(afterName.replyText),
    `collect-info-order after name asks phone+address, got: ${afterName.replyText}`
  );
}

{
  const withName: ConversationState = {
    ...baseState(),
    extracted_entities: {
      ...(baseState().extracted_entities || {}),
      name: 'سفيان محمد',
    },
  };
  const afterPhone = await turn('09552222', withName, 'تمام، شو عنوان التوصيل؟', {
    phone: '09552222',
  });
  assert(
    ASK_ADDRESS.test(afterPhone.replyText),
    `collect-info-order after phone asks address, got: ${afterPhone.replyText}`
  );
}

{
  const allInOne = await turn(
    'سفيان محمد 09552222 الحسينية دمشق',
    baseState(),
    'تمام، هذا ملخص طلبك',
    {
      name: 'سفيان محمد',
      phone: '09552222',
      address: 'الحسينية دمشق',
    }
  );
  assert(
    !ASK_PHONE.test(allInOne.replyText) && !ASK_ADDRESS.test(allInOne.replyText),
    `collect-info-order all-in-one asks nothing, got: ${allInOne.replyText}`
  );
}

// ——— PARTIAL combos via pipeline (LLM extracts what was in the message) ———
type PartialCase = {
  id: string;
  message: string;
  extracted: Record<string, string>;
  expectEntities: { name?: string; phone?: string; address?: string };
  expectAsk: 'name' | 'phone' | 'address' | 'phone_address' | 'none';
  order?: 'scrambled';
};

const PARTIAL_CASES: PartialCase[] = [
  {
    id: 'name_only',
    message: 'سفيان محمد',
    extracted: { name: 'سفيان محمد' },
    expectEntities: { name: 'سفيان محمد' },
    expectAsk: 'phone_address',
  },
  {
    id: 'name_phone',
    message: 'سفيان محمد 09552222',
    extracted: { name: 'سفيان محمد', phone: '09552222' },
    expectEntities: { name: 'سفيان محمد', phone: '09552222' },
    expectAsk: 'address',
  },
  {
    id: 'name_address',
    message: 'سفيان محمد الحسينية دمشق',
    extracted: { name: 'سفيان محمد', address: 'الحسينية دمشق' },
    expectEntities: { name: 'سفيان محمد', address: 'الحسينية دمشق' },
    expectAsk: 'phone',
  },
  {
    id: 'phone_address',
    message: '09552222 الحسينية دمشق',
    extracted: { phone: '09552222', address: 'الحسينية دمشق' },
    expectEntities: { phone: '09552222', address: 'الحسينية دمشق' },
    expectAsk: 'name',
  },
  {
    id: 'all_three',
    message: 'سفيان محمد 09552222 الحسينية دمشق',
    extracted: {
      name: 'سفيان محمد',
      phone: '09552222',
      address: 'الحسينية دمشق',
    },
    expectEntities: {
      name: 'سفيان محمد',
      phone: '09552222',
      address: 'الحسينية دمشق',
    },
    expectAsk: 'none',
  },
  {
    id: 'all_three_scrambled',
    message: '09552222 سفيان محمد الحسينية دمشق',
    extracted: {
      phone: '09552222',
      name: 'سفيان محمد',
      address: 'الحسينية دمشق',
    },
    expectEntities: {
      name: 'سفيان محمد',
      phone: '09552222',
      address: 'الحسينية دمشق',
    },
    expectAsk: 'none',
    order: 'scrambled',
  },
];

for (const c of PARTIAL_CASES) {
  const result = await turn(
    c.message,
    baseState(),
    // Deliberately wrong LLM copy that re-asks everything — code must override.
    'تمام، شو اسمك الكامل؟ ورقم هاتفك وعنوانك؟',
    c.extracted,
    IDENTITY_BUNDLE_ASK_AR
  );
  const e = result.updatedState.extracted_entities || {};
  if (c.expectEntities.name) {
    assert(
      e.name === c.expectEntities.name,
      `${c.id}: name recorded, got ${e.name}`
    );
  }
  if (c.expectEntities.phone) {
    assert(
      e.phone === c.expectEntities.phone,
      `${c.id}: phone recorded, got ${e.phone}`
    );
  }
  if (c.expectEntities.address) {
    assert(
      String(e.address || '').includes(c.expectEntities.address!),
      `${c.id}: address recorded, got ${e.address}`
    );
  }

  if (c.expectAsk === 'none') {
    assert(
      !ASK_NAME.test(result.replyText) &&
        !ASK_PHONE.test(result.replyText) &&
        !/شو عنوان التوصيل|what is the delivery address/i.test(result.replyText),
      `${c.id}: must not re-ask identity, got: ${result.replyText}`
    );
  } else if (c.expectAsk === 'phone_address') {
    assert(
      ASK_PHONE.test(result.replyText) && ASK_ADDRESS.test(result.replyText),
      `${c.id}: must ask phone+address, got: ${result.replyText}`
    );
    assert(
      !ASK_NAME.test(result.replyText) && ASK_PARTIAL.test(result.replyText),
      `${c.id}: must NOT re-ask name or full bundle, got: ${result.replyText}`
    );
  } else if (c.expectAsk === 'phone') {
    assert(
      ASK_PHONE.test(result.replyText),
      `${c.id}: must ask phone, got: ${result.replyText}`
    );
    assert(
      !ASK_NAME.test(result.replyText) && !ASK_ADDRESS.test(result.replyText),
      `${c.id}: must NOT re-ask name/address, got: ${result.replyText}`
    );
  } else if (c.expectAsk === 'address') {
    assert(
      ASK_ADDRESS.test(result.replyText),
      `${c.id}: must ask address, got: ${result.replyText}`
    );
    assert(
      !ASK_NAME.test(result.replyText) && !ASK_PHONE.test(result.replyText),
      `${c.id}: must NOT re-ask name/phone, got: ${result.replyText}`
    );
  } else if (c.expectAsk === 'name') {
    assert(
      ASK_NAME.test(result.replyText),
      `${c.id}: must ask name, got: ${result.replyText}`
    );
    assert(
      !ASK_PHONE.test(result.replyText) && !ASK_ADDRESS.test(result.replyText),
      `${c.id}: must NOT re-ask phone/address, got: ${result.replyText}`
    );
  }
}

{
  const ingested = ingestIdentityAnswerFromBotAsk({
    lastBotReply: IDENTITY_BUNDLE_ASK_AR,
    userMessage: 'سفيان محمد 09552222 الحسينية دمشق',
    collected: {},
  });
  assert(
    ingested.name === 'سفيان محمد' &&
      ingested.phone === '09552222' &&
      String(ingested.address || '').includes('الحسينية'),
    `ingest after bundle multi: got ${JSON.stringify(ingested)}`
  );
}

{
  const ingested = ingestIdentityAnswerFromBotAsk({
    lastBotReply: IDENTITY_BUNDLE_ASK_AR,
    userMessage: 'سفيان محمد',
    collected: {},
  });
  assert(
    ingested.name === 'سفيان محمد' && !ingested.phone && !ingested.address,
    `ingest after bundle name-only: got ${JSON.stringify(ingested)}`
  );
  const ask = resolveIdentityCollectReply({
    language: 'arabic',
    collected: ingested,
    responseText: 'x',
  });
  assert(
    ASK_PHONE.test(ask.replyText) &&
      ASK_ADDRESS.test(ask.replyText) &&
      !ASK_BUNDLE.test(ask.replyText),
    `after bundle name-only chase phone+address, got: ${ask.replyText}`
  );
}

// ——— Ingest path: multi-field in one reply when bot asked for name only ———
// WHY: LLM often puts the whole blob in name; code must split phone/address out.
{
  const ingested = ingestIdentityAnswerFromBotAsk({
    lastBotReply: 'تمام، شو اسمك الكامل؟',
    userMessage: 'سفيان محمد 09552222 الحسينية دمشق',
    collected: {},
  });
  assert(
    ingested.name === 'سفيان محمد',
    `ingest multi: name cleaned, got ${ingested.name}`
  );
  assert(
    ingested.phone === '09552222',
    `ingest multi: phone extracted, got ${ingested.phone}`
  );
  assert(
    String(ingested.address || '').includes('الحسينية'),
    `ingest multi: address extracted, got ${ingested.address}`
  );
}

{
  const ingested = ingestIdentityAnswerFromBotAsk({
    lastBotReply: 'تمام، شو اسمك الكامل؟',
    userMessage: 'سفيان محمد 09552222',
    collected: {},
  });
  assert(
    ingested.name === 'سفيان محمد' && ingested.phone === '09552222' && !ingested.address,
    `ingest name+phone: got name=${ingested.name} phone=${ingested.phone} addr=${ingested.address}`
  );
  const ask = resolveIdentityCollectReply({
    language: 'arabic',
    collected: ingested,
    responseText: 'شو اسمك؟',
  });
  assert(
    ASK_ADDRESS.test(ask.replyText) && !ASK_NAME.test(ask.replyText),
    `after ingest name+phone ask address only: ${ask.replyText}`
  );
}

// ——— LLM identity gate: shipping / product questions must never become a name ———
{
  const shippingQ = 'في توصيل ع الشام';
  assert(
    !mayAcceptLlmIdentityField({
      field: 'name',
      proposed: shippingQ,
      userMessage: shippingQ,
      lastBotReply: 'تمام، اخترت اللون الأسود! هل حابب أكمل الطلب الآن؟',
      collected: {},
    }),
    'LLM must not accept a shipping question as customer name'
  );
  assert(
    !mayAcceptLlmIdentityField({
      field: 'name',
      proposed: 'قبل اكمال الطلب بدي أعرف في توصيل ع الشام',
      userMessage: 'قبل اكمال الطلب بدي أعرف في توصيل ع الشام',
      lastBotReply: IDENTITY_BUNDLE_ASK_AR,
      collected: {},
    }),
    'LLM must not accept a long shipping question even during identity collect'
  );
  assert(
    mayAcceptLlmIdentityField({
      field: 'name',
      proposed: 'سفيان محمد',
      userMessage: 'سفيان محمد',
      lastBotReply: 'تمام، شو اسمك الكامل؟',
      collected: {},
    }),
    'LLM may accept a short name when bot asked for name'
  );
  assert(
    mayAcceptLlmIdentityField({
      field: 'phone',
      proposed: '09552222',
      userMessage: 'سفيان محمد 09552222 الحسينية دمشق',
      lastBotReply: IDENTITY_BUNDLE_ASK_AR,
      collected: {},
    }),
    'LLM may accept phone grounded in a multi-field identity blob'
  );
  assert(
    !mayAcceptLlmIdentityField({
      field: 'name',
      proposed: 'أحمد',
      userMessage: 'بدي الساعة السوداء',
      lastBotReply: 'أي لون بتحب؟',
      collected: {},
    }),
    'LLM must not invent a name that is not in the user message'
  );
}

{
  const freeFormAsk =
    'بالنسبة للتوصيل إلى الشام، نقدر نوصل لك الطلب. بس قبل ما نثبت الطلب، ممكن تشاركني باسمك ورقم هاتفك وعنوانك؟';
  assert(
    isBotIdentityBundleAsk(freeFormAsk),
    'free-form LLM multi-field ask must count as identity bundle'
  );
  const ingested = ingestIdentityAnswerFromBotAsk({
    lastBotReply: freeFormAsk,
    userMessage: 'سفيان محمد',
    collected: {},
  });
  assert(
    ingested.name === 'سفيان محمد' && !ingested.phone && !ingested.address,
    `free-form ask + short name → name only, got ${JSON.stringify(ingested)}`
  );
  const ask = resolveIdentityCollectReply({
    language: 'arabic',
    collected: ingested,
    responseText: 'تمام، شو اسمك الكامل؟',
  });
  assert(
    ASK_PHONE.test(ask.replyText) &&
      ASK_ADDRESS.test(ask.replyText) &&
      !ASK_NAME.test(ask.replyText),
    `after free-form name ingest ask phone+address, got: ${ask.replyText}`
  );
}

console.log(
  `collect-info-order: ${failures.length === 0 ? 'passed' : `${failed} failed`}`,
);
if (failures.length > 0) {
  for (const item of failures) console.error(`FAIL: ${item}`);
  process.exit(1);
}
process.exit(0);

/**
 * Scenario `collect-info-order` — identity field sequencing.
 * KNOWN_PENDING until collect_info asks one missing field at a time from code,
 * not free-form LLM order.
 *
 * Contract:
 * - after name only → ask phone (not address)
 * - after phone → ask address
 * - name+phone+address in ONE message → ask nothing (await/confirm path)
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
  extractedInfo: Record<string, unknown>
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
    recentMessages: [],
    conversationState: state,
    merchantConfig: merchantConfig(),
    platform: 'playground',
  });
}

{
  const afterName = await turn(
    'سفيان محمد',
    baseState(),
    'تمام، شو عنوانك؟',
    { name: 'سفيان محمد' }
  );
  assert(
    /هاتف|رقم|phone/i.test(afterName.replyText),
    `collect-info-order after name asks phone, got: ${afterName.replyText}`,
  );
  assert(
    !/عنوان|address/i.test(afterName.replyText),
    `collect-info-order after name must not ask address, got: ${afterName.replyText}`,
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
    /عنوان|address/i.test(afterPhone.replyText),
    `collect-info-order after phone asks address, got: ${afterPhone.replyText}`,
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
    !/شو رقم|شو عنوان|هاتفك|عنوان التوصيل/i.test(allInOne.replyText),
    `collect-info-order all-in-one asks nothing, got: ${allInOne.replyText}`,
  );
}

console.log(`collect-info-order: ${failures.length === 0 ? 'would pass' : `${failed} failed`}`);
for (const item of failures) console.error(`FAIL: ${item}`);
console.error(
  'KNOWN_PENDING: collect-info-order requires deterministic one-field collect_info sequencing (LLM still free to ask address after name)',
);
process.exit(1);

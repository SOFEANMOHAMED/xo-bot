/**
 * CRITICAL HOTFIX — soft affirm («طيب») must not finalize an awaiting order
 * when the customer asks about catalog availability («في تلفزيونات»).
 *
 * Covers: processWithSalesGPT → next_action gate → appendOrderDataIfConfirmed
 * → persistOrderIfPresent against xobot_test (real order path, never xobot_db).
 *
 * Run: npm run test-i4-soft-affirm-catalog
 */
import pool from '../../database/connection.js';
import {
  assertIsolatedTestDb,
  insertThrowawayMerchant,
} from '../../database/testDbFixtures.js';
import { appendOrderDataIfConfirmed } from '../buildMerchantBotConfig.js';
import {
  extractOrderData,
  isCompleteOrderPayload,
  persistOrderIfPresent,
} from '../channels/botTurn.js';
import type { ConversationState } from '../../core/types.js';
import { processWithSalesGPT } from './index.js';
import {
  customerAffirmsOrder,
  isProductInfoRequest,
  resolveOrderNextAction,
  AWAIT_CONFIRMATION_ACTION,
} from './orderConfirmationPolicy.js';
import { isCheckoutReady, isDraftLineComplete } from './conversationCart.js';
import {
  REAL_TEST_CATALOG,
  REAL_TEST_SHIRT,
  REAL_TEST_WATCH,
} from './realTestCatalog.js';
import {
  resetHarness,
  setCatalog,
  setLlmReply,
} from './test_pipeline_harness_state.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const CONFIRM_CLAIM =
  /تم\s*(استلام|تأكيد)\s*طلبك|طلبك\s*بنجاح|رقم\s*الطلب|#ORD-/i;

function awaitingShirtState(): ConversationState {
  return {
    message_count: 8,
    salesgpt_stage_id: '8',
    awaiting_order_confirmation: true,
    last_recommended_products: [REAL_TEST_SHIRT.id],
    extracted_entities: {
      product_id: REAL_TEST_SHIRT.id,
      product_query: REAL_TEST_SHIRT.name,
      quantity: 1,
      name: 'سفيان محمد',
      phone: '09552222',
      address: 'الحسينية دمشق',
    },
    cart: {
      items: [
        {
          productId: REAL_TEST_SHIRT.id,
          productName: REAL_TEST_SHIRT.name,
          quantity: 1,
          unitPrice: REAL_TEST_SHIRT.price,
          currency: REAL_TEST_SHIRT.currency || 'USD',
          addedAt: new Date().toISOString(),
        },
      ],
      status: 'building',
      updatedAt: new Date().toISOString(),
    },
  };
}

const AWAIT_BOT =
  'تمام يا سفيان محمد! طلبك جاهز للتأكيد:\n' +
  '• قميص — 553 دولار أمريكي\n' +
  '• الهاتف: 09552222\n' +
  '• العنوان: الحسينية دمشق\n\n' +
  'اكتب «نعم» أو «أكد» لتثبيت الطلب الآن.';

async function main(): Promise<void> {
  assertIsolatedTestDb();

  // ——— Unit: soft affirm + catalog ask must not affirm ———
  assert(
    isProductInfoRequest('طيب في تلفزيونات'),
    'في تلفزيونات is a catalog-availability / product ask'
  );
  assert(customerAffirmsOrder('طيب'), 'bare طيب still affirms');
  assert(customerAffirmsOrder('نعم'), 'نعم affirms');
  assert(customerAffirmsOrder('نعم أكد'), 'نعم أكد affirms');
  assert(
    !customerAffirmsOrder('طيب في تلفزيونات'),
    'طيب في تلفزيونات must NOT affirm (soft طيب + catalog ask)'
  );

  const policy = resolveOrderNextAction({
    aiNextAction: 'confirm_order',
    fieldsComplete: true,
    fieldsWereCompleteBeforeTurn: true,
    wasAwaitingConfirmation: true,
    userMessage: 'طيب في تلفزيونات',
    language: 'arabic',
    collectedInfo: {
      name: 'سفيان محمد',
      phone: '09552222',
      address: 'الحسينية دمشق',
      product_name: 'قميص',
    },
    responseText:
      'للأسف ما في تلفزيونات حالياً. تم استلام طلبك بنجاح! رقم الطلب: #ORD-8009',
    lastBotReply: AWAIT_BOT,
    turnIntent: 'other',
  });
  assert(
    policy.nextAction !== 'confirm_order',
    `policy must not confirm_order, got ${policy.nextAction}`
  );
  assert(
    !CONFIRM_CLAIM.test(policy.responseText),
    `policy reply must not claim order placed: ${policy.responseText}`
  );

  // ——— Shirt: no colors → draft/checkout ready without color ———
  const shirtDraft = isDraftLineComplete(
    {
      product_id: REAL_TEST_SHIRT.id,
      product_query: REAL_TEST_SHIRT.name,
      quantity: 1,
    },
    REAL_TEST_SHIRT
  );
  assert(shirtDraft.complete, `shirt draft must be complete without color, missing=${shirtDraft.missing}`);
  assert(!shirtDraft.missing.includes('color'), 'shirt must not require color');

  const watchDraft = isDraftLineComplete(
    {
      product_id: REAL_TEST_WATCH.id,
      product_query: REAL_TEST_WATCH.name,
      quantity: 1,
    },
    REAL_TEST_WATCH
  );
  assert(
    !watchDraft.complete && watchDraft.missing.includes('color'),
    'watch with colors must block checkout without color'
  );

  const shirtReady = isCheckoutReady(awaitingShirtState(), REAL_TEST_SHIRT);
  assert(shirtReady.complete, `shirt checkout ready without color, missing=${shirtReady.missing}`);

  // ——— Pipeline + ORDER_DATA gate + real persist path on xobot_test ———
  resetHarness();
  setCatalog(REAL_TEST_CATALOG);
  setLlmReply({
    response_text:
      'للأسف ما في تلفزيونات حالياً بالمتجر. إذا حابب نكمّل طلب القميص، اكتب نعم أو أكد.',
    next_action: 'present_product',
    customer_request: {
      wants_alternatives: false,
      asks_product_info: false,
      wants_photo: false,
      ready_to_confirm: false,
      wants_add_another: false,
    },
    extracted_info: {},
  });

  const stateBefore = awaitingShirtState();
  const result = await processWithSalesGPT({
    merchantId: '00000000-0000-4000-8000-000000000801',
    messageText: 'طيب في تلفزيونات',
    recentMessages: [{ role: 'assistant', content: AWAIT_BOT }],
    conversationState: stateBefore,
    merchantConfig: {
      merchantId: '00000000-0000-4000-8000-000000000801',
      storeName: 'متجر اختبار',
      storeCurrency: 'USD',
      persona: 'friendly',
      botLanguage: 'arabic',
    },
    platform: 'playground',
  });

  assert(
    result.next_action !== 'confirm_order',
    `pipeline next_action must not be confirm_order, got ${result.next_action}`
  );
  assert(
    !CONFIRM_CLAIM.test(result.replyText),
    `pipeline reply must not claim order placed: ${result.replyText}`
  );

  const withTag = appendOrderDataIfConfirmed({
    responseText: result.replyText,
    nextAction: result.next_action,
    entities: result.updatedState.extracted_entities || {},
    productIds: result.updatedState.last_recommended_products || [REAL_TEST_SHIRT.id],
    storeCurrency: 'USD',
    cartItems: result.updatedState.cart?.items,
  });
  const extracted = extractOrderData(withTag);
  assert(!extracted.orderData, 'appendOrderDataIfConfirmed must not emit ORDER_DATA');
  assert(
    !isCompleteOrderPayload(extracted.orderData),
    'no complete order payload after catalog ask'
  );

  // Real DB path: even if someone forced a payload, persist must only run on complete ORDER_DATA.
  // Here we assert persistOrderIfPresent returns false (no order row) for null payload.
  const client = await pool.connect();
  let merchantId = '';
  let conversationId = '';
  try {
    await client.query('BEGIN');
    merchantId = await insertThrowawayMerchant(client, 'i4_soft_affirm');
    const conv = await client.query<{ id: string }>(
      `INSERT INTO conversations (merchant_id, platform, user_id, user_name, stage)
       VALUES ($1, 'playground', $2, 'I4 Test', 'close')
       RETURNING id`,
      [merchantId, `i4_${Date.now()}`]
    );
    conversationId = conv.rows[0]?.id || '';
    assert(!!conversationId, 'conversation created');

    const ordersBefore = await client.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM orders WHERE merchant_id = $1`,
      [merchantId]
    );
    const beforeCount = Number(ordersBefore.rows[0]?.c || 0);

    const persisted = await persistOrderIfPresent({
      pool: client as unknown as typeof pool,
      merchantId,
      conversationId,
      orderData: extracted.orderData,
      settings: { store_currency: 'USD' },
      labels: {
        defaultBaseNotes: 'Order created via I4 soft-affirm catalog test',
        customerTags: ['bot-order', 'test'],
        interactionTitle: 'Order Created via I4 Test',
        interactionDescription: (orderId: string) => `Order #${orderId} created via I4 test`,
        interactionPlatform: 'playground',
        logPrefix: 'test_i4_soft_affirm_catalog',
      },
      updatedState: result.updatedState,
    });
    assert(!persisted, 'persistOrderIfPresent must refuse without ORDER_DATA');

    const ordersAfter = await client.query<{ c: string }>(
      `SELECT count(*)::text AS c FROM orders WHERE merchant_id = $1`,
      [merchantId]
    );
    assert(
      Number(ordersAfter.rows[0]?.c || 0) === beforeCount,
      'no new order row on xobot_test'
    );

    await client.query('ROLLBACK');
  } finally {
    client.release();
  }

  console.log('I4 soft-affirm catalog assertions ok — closing');
}

main()
  .then(() => {
    console.log('I4 soft-affirm catalog: PASS');
    process.exit(0);
  })
  .catch((err) => {
    console.error('I4 soft-affirm catalog: FAIL', err);
    process.exit(1);
  });

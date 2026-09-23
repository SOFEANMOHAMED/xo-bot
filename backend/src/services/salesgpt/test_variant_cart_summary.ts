/**
 * PHASE 2H-2 — variant/color cart mutation must include priced cart summary.
 * Failing until buildVariantUpdatedMessage appends formatCartSummary.
 * Run: npm run test-variant-cart-summary
 */
import type { ConversationState, MerchantConfig } from '../../core/types.js';
import { getCartItems } from './conversationCart.js';
import { processWithSalesGPT } from './index.js';
import {
  REAL_TEST_CATALOG,
  REAL_TEST_WATCH,
} from './realTestCatalog.js';
import { buildVariantUpdatedMessage } from './resolveVariantChange.js';
import {
  resetHarness,
  setCatalog,
  setLlmReply,
} from './test_pipeline_harness_state.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const watchLine = {
  productId: REAL_TEST_WATCH.id,
  productName: REAL_TEST_WATCH.name,
  quantity: 1,
  unitPrice: REAL_TEST_WATCH.price,
  currency: 'SAR' as const,
  color: 'أسود',
  lineId: 'w1',
  addedAt: '2026-09-21T00:00:00.000Z',
};

{
  const unit = buildVariantUpdatedMessage('arabic', 'أحمر', REAL_TEST_WATCH.name, [
    { ...watchLine, color: 'أحمر' },
  ]);
  assert(/حدّثت طلبك/.test(unit), `lead claim: ${unit}`);
  assert(
    /ساعة/.test(unit) && /أحمر/.test(unit) && /200/.test(unit),
    `summary line with new color + price: ${unit}`
  );
  assert(/مجموع المنتجات/.test(unit), `subtotal present: ${unit}`);
}

async function main(): Promise<void> {
  resetHarness();
  setCatalog(REAL_TEST_CATALOG);
  setLlmReply({
    response_text: 'تم التحديث',
    next_action: 'collect_info',
    customer_request: {
      wants_alternatives: false,
      asks_product_info: false,
      wants_photo: false,
      ready_to_confirm: false,
      wants_add_another: false,
    },
    extracted_info: {},
  });

  const state: ConversationState = {
    message_count: 6,
    salesgpt_stage_id: '7',
    last_recommended_products: [REAL_TEST_WATCH.id],
    extracted_entities: {
      product_id: REAL_TEST_WATCH.id,
      product_query: REAL_TEST_WATCH.name,
      color: 'أسود',
    },
    cart: { items: [watchLine], status: 'building' },
  };

  const merchantConfig: MerchantConfig = {
    merchantId: '00000000-0000-4000-8000-000000000302',
    storeName: 'متجر',
    storeCurrency: 'SAR',
    persona: 'friendly',
    botLanguage: 'arabic',
  };

  const result = await processWithSalesGPT({
    merchantId: merchantConfig.merchantId,
    messageText: 'لا ما بدي اسود بدي احمر',
    recentMessages: [{ role: 'assistant', content: 'أي لون بتحب؟ أسود أو أحمر' }],
    conversationState: state,
    merchantConfig,
    platform: 'playground',
  });

  const line = getCartItems(result.updatedState).find(
    (i) => i.productId === REAL_TEST_WATCH.id
  );
  assert(line?.color === 'أحمر', `cart color أحمر, got ${line?.color}`);
  assert(/حدّثت طلبك/.test(result.replyText), `update claim: ${result.replyText}`);
  assert(
    /ساعة/.test(result.replyText) &&
      /أحمر/.test(result.replyText) &&
      /200/.test(result.replyText),
    `priced summary with new color: ${result.replyText}`
  );
  assert(
    /مجموع المنتجات/.test(result.replyText),
    `subtotal in reply: ${result.replyText}`
  );

  console.log('variant-cart-summary: PASS');
}

main().catch((err) => {
  console.error('variant-cart-summary: FAIL', err);
  process.exit(1);
});

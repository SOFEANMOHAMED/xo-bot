/**
 * Offline labeled cases for interpreter §6 rows 1–4 (no LLM).
 * Run: npm run test-interpreter-offline
 */
import type { Product } from '../../core/types.js';
import { isPastBotClaimDispute } from './pastBotClaimDispute.js';
import { isExplicitPhotoRefusal, isExplicitPhotoRequest } from './turnIntent.js';
import { resolveQuantityFromMessage } from './arabicQuantityWords.js';
import {
  matchWhitelist,
  nextActionFromInterpreterFacts,
  validateInterpreterResult,
} from './interpreter/index.js';
import { applyInterpreterResult } from './interpreter/apply.js';
import type { InterpreterInput } from './interpreter/types.js';
import type { ConversationState } from '../../core/types.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const watch: Product = {
  id: 'watch-1',
  name: 'ساعة',
  price: 200,
  currency: 'SAR',
  stock: 5,
  colors: ['أسود', 'أحمر'],
  sizes: [],
};

const shoe = { id: 'shoe-1', name: 'حذاء' };

function input(message: string, extras: Partial<InterpreterInput> = {}): InterpreterInput {
  return {
    message,
    recentMessages: [],
    stateSummary: {
      focusProductId: watch.id,
      pendingBotQuestion: null,
      pendingProductId: null,
      awaitingOrderConfirmation: false,
      cartStatus: 'building',
    },
    allowedProductIds: [watch.id, shoe.id],
    cartLines: [],
    ...extras,
  };
}

// 1) focus — mentioned SKU must stay in allowed list (shoe, not only watch)
{
  const in_ = input('بدي الحذاء');
  assert(in_.allowedProductIds.includes(shoe.id), 'shoe is an allowed candidate');
  const v = validateInterpreterResult(
    {
      rawModelConfidence: 0.95,
      actions: [
        {
          type: 'set_focus_product',
          productId: shoe.id,
          confidence: 0.95,
          evidence: 'الحذاء',
          ambiguous: false,
        },
      ],
    },
    in_
  );
  assert(v.result.actions[0]?.productId === shoe.id, 'focus stays on named shoe');
}

// 2) photo refusal
{
  const msg = 'لا أنا ما بدي الصورة';
  assert(isExplicitPhotoRefusal(msg), 'refusal detected');
  assert(!isExplicitPhotoRequest(msg), 'refusal is not a request');
  const next = nextActionFromInterpreterFacts({
    applied: ['refuse_photo'],
    handoffHuman: false,
    wantsPhoto: false,
    refusesPhoto: true,
    affirmsOrder: false,
    deniesOrder: false,
    browseCatalog: false,
    infoKind: null,
    clarification: false,
    checkoutReady: false,
  });
  assert(next === 'present_product', 'refusal does not send_image');
}

// 3) quantity
{
  const qty = resolveQuantityFromMessage('ساعتين', 'ساعة');
  assert(qty === 2, `ساعتين → 2, got ${qty}`);
  const v = validateInterpreterResult(
    {
      rawModelConfidence: 0.9,
      actions: [
        {
          type: 'set_quantity',
          quantity: 2,
          confidence: 0.9,
          evidence: 'ساعتين',
          ambiguous: false,
        },
      ],
    },
    input('ساعتين')
  );
  assert(v.result.actions[0]?.type === 'set_quantity', 'quantity action valid');
}

// 4) color mention in a dispute is not identity / not a color pick
{
  const msg = 'أنت قلت في أسود';
  assert(isPastBotClaimDispute(msg), 'dispute classified');
  const v = validateInterpreterResult(
    {
      rawModelConfidence: 0.9,
      actions: [
        {
          type: 'ask_product_info',
          infoKind: 'details',
          confidence: 0.9,
          evidence: 'أسود',
          ambiguous: false,
        },
      ],
    },
    input(msg)
  );
  assert(v.result.actions[0]?.type === 'ask_product_info', 'dispute → product info');
  const next = nextActionFromInterpreterFacts({
    applied: ['ask_product_info'],
    handoffHuman: false,
    wantsPhoto: false,
    refusesPhoto: false,
    affirmsOrder: false,
    deniesOrder: false,
    browseCatalog: false,
    infoKind: 'details',
    clarification: false,
    checkoutReady: false,
  });
  assert(next === 'present_product', 'dispute does not collect_info');
}

{
  const hit = matchWhitelist(
    input('نعم', {
      stateSummary: {
        focusProductId: watch.id,
        pendingBotQuestion: null,
        pendingProductId: null,
        awaitingOrderConfirmation: true,
        cartStatus: 'checking_out',
      },
    })
  );
  assert(hit?.actions[0]?.type === 'affirm_order', 'offline awaiting نعم');
}

// 5) pending bare color → select_color
{
  const hit = matchWhitelist(
    input('أسود', {
      stateSummary: {
        focusProductId: watch.id,
        pendingBotQuestion: 'color',
        pendingProductId: watch.id,
        awaitingOrderConfirmation: false,
        cartStatus: 'building',
      },
      cartLines: [
        {
          lineId: 'L1',
          productId: watch.id,
          productName: watch.name,
          color: null,
          size: null,
          quantity: 1,
          currency: 'SAR',
          allowedColors: watch.colors || [],
          allowedSizes: [],
        },
      ],
    })
  );
  assert(hit?.actions[0]?.type === 'select_color', 'pending أسود → select_color');
  assert(hit?.actions[0]?.color === 'أسود', 'pending color value');
}

// 6) whole cancel → cancel_order
{
  const hit = matchWhitelist(input('ألغي الطلب كله'));
  assert(hit?.actions[0]?.type === 'cancel_order', 'ألغي الطلب كله → cancel_order');
}

{
  const hit = matchWhitelist(
    input('أحمد', {
      recentMessages: [
        { role: 'assistant', content: 'شو اسمك الكامل من فضلك؟' },
      ],
    })
  );
  assert(hit?.actions[0]?.type === 'provide_identity_field', 'identity whitelist');
  assert(hit?.actions[0]?.identityField === 'name', 'identity field name');
  assert(hit?.actions[0]?.identityValue === 'أحمد', 'identity value');
}

{
  const next = nextActionFromInterpreterFacts({
    applied: ['select_color'],
    handoffHuman: false,
    wantsPhoto: false,
    refusesPhoto: false,
    affirmsOrder: false,
    deniesOrder: false,
    browseCatalog: false,
    infoKind: null,
    clarification: false,
    checkoutReady: false,
    missingVariantAxes: true,
  });
  assert(next === 'collect_info', 'select_color → collect_info');
}

// 7) correct_variant must write size onto the cart line (not color-only)
{
  const shirt: Product = {
    id: 'shirt-1',
    name: 'قميص',
    price: 100,
    currency: 'USD',
    stock: 5,
    colors: [],
    sizes: ['s', 'm', 'l'],
  };
  const before: ConversationState = {
    message_count: 1,
    extracted_entities: { product_id: shirt.id, size: 'm' },
    cart: {
      items: [
        {
          lineId: 'line-1',
          productId: shirt.id,
          productName: shirt.name,
          quantity: 1,
          unitPrice: 100,
          currency: 'USD',
          size: 'm',
          addedAt: '2026-09-24T00:00:00.000Z',
        },
      ],
      status: 'building',
    },
  };
  const applied = applyInterpreterResult({
    result: {
      rawModelConfidence: 0.95,
      actions: [
        {
          type: 'correct_variant',
          productId: shirt.id,
          lineId: 'line-1',
          size: 's',
          confidence: 0.95,
          evidence: 'عدل المقاس',
          ambiguous: false,
        },
      ],
    },
    state: before,
    productsById: new Map([[shirt.id, shirt]]),
  });
  assert(applied.applied.includes('correct_variant'), 'correct_variant applied');
  assert(applied.state.cart?.items[0]?.size === 's', 'cart size → s');
  assert(applied.state.extracted_entities?.size === 's', 'entities size → s');
}

// 8) pending color with phantom lineId / empty cart must create a real cart line
{
  const phantomLineId = 'phantom-not-in-cart';
  const before: ConversationState = {
    message_count: 1,
    extracted_entities: { product_id: watch.id, product_query: watch.name },
    cart: { items: [], status: 'building' },
  };
  const applied = applyInterpreterResult({
    result: {
      rawModelConfidence: 0.95,
      actions: [
        {
          type: 'select_color',
          productId: watch.id,
          lineId: phantomLineId,
          color: 'أسود',
          confidence: 0.95,
          evidence: 'أسود',
          ambiguous: false,
        },
      ],
    },
    state: before,
    productsById: new Map([[watch.id, watch]]),
    storeCurrency: 'SAR',
  });
  assert(applied.applied.includes('select_color'), 'select_color applied with empty cart');
  assert(
    (applied.state.cart?.items?.length || 0) === 1,
    'select_color on empty cart creates one real line'
  );
  assert(applied.state.cart?.items[0]?.productId === watch.id, 'cart line productId');
  assert(applied.state.cart?.items[0]?.color === 'أسود', 'cart line color أسود');
  assert(applied.state.extracted_entities?.color === 'أسود', 'entities color أسود');
  assert(
    applied.state.cart?.items[0]?.lineId !== phantomLineId,
    'real lineId must not keep phantom candidate id'
  );
}

console.log('test_interpreter_offline: PASS');

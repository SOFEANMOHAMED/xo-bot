/**
 * Interpreter whitelist + validate + apply + next_action — no LLM.
 * Run: npm run test-interpreter-validate
 */
import type { ConversationState, Product } from '../../core/types.js';
import {
  applyInterpreterResult,
  matchWhitelist,
  nextActionFromInterpreterFacts,
  validateInterpreterResult,
} from './interpreter/index.js';
import type { InterpreterInput, InterpreterResult } from './interpreter/types.js';

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

const baseInput = (message: string, extra: Partial<InterpreterInput> = {}): InterpreterInput => ({
  message,
  recentMessages: [],
  stateSummary: {
    focusProductId: watch.id,
    pendingBotQuestion: null,
    pendingProductId: null,
    awaitingOrderConfirmation: false,
    cartStatus: 'building',
  },
  allowedProductIds: [watch.id],
  cartLines: [
    {
      lineId: 'line-1',
      productId: watch.id,
      productName: watch.name,
      color: 'أسود',
      size: null,
      quantity: 1,
      currency: 'SAR',
      allowedColors: ['أسود', 'أحمر'],
      allowedSizes: [],
    },
  ],
  ...extra,
});

const emptyState = (): ConversationState => ({
  message_count: 1,
  extracted_entities: { product_id: watch.id, color: 'أسود' },
  cart: {
    status: 'building',
    items: [
      {
        lineId: 'line-1',
        productId: watch.id,
        productName: watch.name,
        quantity: 1,
        unitPrice: 200,
        currency: 'SAR',
        color: 'أسود',
        addedAt: 't',
      },
    ],
  },
});

{
  const hit = matchWhitelist(
    baseInput('نعم', {
      stateSummary: {
        focusProductId: watch.id,
        pendingBotQuestion: null,
        pendingProductId: null,
        awaitingOrderConfirmation: true,
        cartStatus: 'checking_out',
      },
    })
  );
  assert(hit?.actions[0]?.type === 'affirm_order', 'awaiting + نعم → affirm_order');
}

{
  const hit = matchWhitelist(
    baseInput('لا', {
      stateSummary: {
        focusProductId: watch.id,
        pendingBotQuestion: null,
        pendingProductId: null,
        awaitingOrderConfirmation: true,
        cartStatus: 'checking_out',
      },
    })
  );
  assert(hit?.actions[0]?.type === 'deny_order', 'awaiting + لا → deny_order');
}

{
  const miss = matchWhitelist(baseInput('نعم'));
  assert(miss === null, 'bare نعم without awaiting is not whitelist');
}

{
  const human = matchWhitelist(baseInput('بدي أحكي مع موظف'));
  assert(human?.actions[0]?.type === 'handoff_human', 'human request whitelisted');
}

{
  const bot = matchWhitelist(baseInput('انت بوت؟'));
  assert(bot?.actions[0]?.type === 'ask_product_info', 'asks-if-bot whitelisted');
}

{
  const raw: InterpreterResult = {
    rawModelConfidence: 0.9,
    actions: [
      {
        type: 'select_color',
        color: 'أحمر',
        lineId: 'line-1',
        productId: watch.id,
        confidence: 0.92,
        evidence: 'أحمر',
        ambiguous: false,
      },
    ],
  };
  const v = validateInterpreterResult(raw, baseInput('بدي أحمر'));
  assert(v.ok && v.result.actions[0]?.type === 'select_color', 'valid color kept');
}

{
  const raw: InterpreterResult = {
    rawModelConfidence: 0.9,
    actions: [
      {
        type: 'select_color',
        color: 'أزرق',
        lineId: 'line-1',
        productId: watch.id,
        confidence: 0.92,
        evidence: 'أزرق',
        ambiguous: false,
      },
    ],
  };
  const v = validateInterpreterResult(raw, baseInput('بدي أزرق'));
  assert(v.result.actions.length === 0, 'color outside catalog dropped');
}

{
  const raw: InterpreterResult = {
    rawModelConfidence: 0.9,
    actions: [
      {
        type: 'set_focus_product',
        productId: 'other',
        confidence: 0.95,
        evidence: 'ساعة',
        ambiguous: false,
      },
    ],
  };
  const v = validateInterpreterResult(raw, baseInput('بدي الساعة'));
  assert(v.result.actions.length === 0, 'productId not in allowed list dropped');
}

{
  const raw: InterpreterResult = {
    rawModelConfidence: 0.9,
    actions: [
      {
        type: 'set_quantity',
        quantity: 2,
        confidence: 0.9,
        evidence: 'اختراع',
        ambiguous: false,
      },
    ],
  };
  const v = validateInterpreterResult(raw, baseInput('ساعتين'));
  assert(v.result.actions.length === 0, 'evidence not in message dropped');
}

{
  const raw: InterpreterResult = {
    rawModelConfidence: 0.95,
    actions: [
      {
        type: 'cancel_order',
        confidence: 0.95,
        evidence: 'نعم',
        ambiguous: false,
      },
      {
        type: 'affirm_order',
        confidence: 0.95,
        evidence: 'نعم',
        ambiguous: false,
      },
    ],
  };
  const v = validateInterpreterResult(raw, baseInput('نعم'));
  assert(!v.ok && v.result.actions.length === 0, 'cancel×affirm rejected');
}

{
  const raw: InterpreterResult = {
    rawModelConfidence: 0.7,
    actions: [
      {
        type: 'cancel_order',
        confidence: 0.7,
        evidence: 'الغي',
        ambiguous: false,
      },
    ],
  };
  const v = validateInterpreterResult(raw, baseInput('الغي'));
  assert(v.result.actions[0]?.type === 'ask_clarification', 'weak cancel → clarify');
}

{
  const raw: InterpreterResult = {
    rawModelConfidence: 0.95,
    actions: [
      {
        type: 'ask_clarification',
        confidence: 0.9,
        evidence: 'ال',
        ambiguous: true,
      },
      {
        type: 'ask_clarification',
        confidence: 0.9,
        evidence: 'ساعة',
        ambiguous: true,
      },
    ],
  };
  const v = validateInterpreterResult(raw, baseInput('بدي الساعة'));
  assert(v.result.actions.length === 1, 'only one clarification kept');
}

{
  const applied = applyInterpreterResult({
    result: {
      rawModelConfidence: 1,
      actions: [
        {
          type: 'set_quantity',
          quantity: 2,
          lineId: 'line-1',
          confidence: 0.95,
          evidence: 'ساعتين',
          ambiguous: false,
        },
      ],
    },
    state: emptyState(),
    productsById: new Map([[watch.id, watch]]),
  });
  assert(applied.applied.includes('set_quantity'), 'quantity applied');
  assert(applied.state.extracted_entities?.quantity === 2, 'entity qty=2');
  assert(applied.state.cart?.items[0]?.quantity === 2, 'line qty=2');
}

{
  const applied = applyInterpreterResult({
    result: {
      rawModelConfidence: 1,
      actions: [
        {
          type: 'affirm_order',
          confidence: 0.95,
          evidence: 'نعم',
          ambiguous: false,
        },
      ],
    },
    state: emptyState(),
    productsById: new Map([[watch.id, watch]]),
  });
  assert(applied.affirmsOrder, 'affirm flag');
  const next = nextActionFromInterpreterFacts({
    applied: applied.applied,
    handoffHuman: false,
    wantsPhoto: false,
    refusesPhoto: false,
    affirmsOrder: true,
    deniesOrder: false,
    browseCatalog: false,
    infoKind: null,
    clarification: false,
    checkoutReady: true,
  });
  assert(next === 'await_confirmation', 'affirm does not emit confirm_order');
}

{
  const next = nextActionFromInterpreterFacts({
    applied: ['handoff_human'],
    handoffHuman: true,
    wantsPhoto: false,
    refusesPhoto: false,
    affirmsOrder: false,
    deniesOrder: false,
    browseCatalog: false,
    infoKind: null,
    clarification: false,
    checkoutReady: false,
  });
  assert(next === 'end_conversation', 'handoff → end');
}

{
  const next = nextActionFromInterpreterFacts({
    applied: ['request_photo'],
    handoffHuman: false,
    wantsPhoto: true,
    refusesPhoto: false,
    affirmsOrder: false,
    deniesOrder: false,
    browseCatalog: false,
    infoKind: null,
    clarification: false,
    checkoutReady: false,
  });
  assert(next === 'send_image', 'photo → send_image');
}

console.log('test_interpreter_validate: PASS');

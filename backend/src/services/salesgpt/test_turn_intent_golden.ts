/**
 * Golden tests: TurnIntent + order confirmation semantics.
 * Run: npm run test-turn-intent-golden
 */

import {
  resolveOrderNextAction,
  customerAffirmsOrder,
  customerDeclinesMoreItems,
  customerCancelsOrder,
  botReplyAsksForConfirmation,
  botReplyAsksToAddMore,
  AWAIT_CONFIRMATION_ACTION,
} from './orderConfirmationPolicy.js';
import {
  isExplicitPhotoRequest,
  resolveTurnIntent,
  nextActionForBrowseTurn,
} from './turnIntent.js';
import {
  applySalesGPTStage,
  applyFreshConversationStage,
  applyHandoffStage,
  conversationStageForDb,
  deriveStageFromSalesGPTStageId,
} from './conversationStateSync.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

let passed = 0;

function run(): void {
  // Explicit photo detection
  assert(
    isExplicitPhotoRequest('طيب ممكن تبعتلي صورة القميص'),
    'should detect Arabic photo request'
  );
  assert(
    isExplicitPhotoRequest('بدي صورة القميص'),
    'should detect بدي صورة'
  );
  assert(
    isExplicitPhotoRequest('صورة الساعة'),
    'should detect صورة الساعة'
  );
  assert(
    !isExplicitPhotoRequest('شو سعر الساعة'),
    'price question is not a photo request'
  );
  assert(
    !isExplicitPhotoRequest('اسمي أحمد'),
    'identity is not a photo request'
  );
  passed++;

  // TurnIntent: photo → browse_media even if model omitted wants_photo
  const photoIntent = resolveTurnIntent({
    userMessage: 'طيب ممكن تبعتلي صورة القميص',
    customerRequest: {
      wantsAlternatives: false,
      asksProductInfo: false,
      wantsPhoto: false,
      readyToConfirm: false,
      wantsAddAnother: false,
    },
  });
  assert(photoIntent === 'browse_media', `expected browse_media, got ${photoIntent}`);
  assert(
    nextActionForBrowseTurn(photoIntent, 'collect_info') === 'send_image',
    'browse_media must force send_image over collect_info'
  );
  passed++;

  // Order rails: AI jumps to await_confirmation on photo turn → still send_image
  const stolenCheckout = resolveOrderNextAction({
    aiNextAction: 'await_confirmation',
    fieldsComplete: false,
    fieldsWereCompleteBeforeTurn: false,
    wasAwaitingConfirmation: false,
    userMessage: 'طيب ممكن تبعتلي صورة القميص',
    language: 'arabic',
    collectedInfo: { product_name: 'قميص' },
    responseText: 'تمام! حتى نكمّل الطلب أحتاج اسمك 😊',
    missingFields: ['name', 'phone', 'address'],
    turnIntent: 'browse_media',
  });
  assert(
    stolenCheckout.nextAction === 'send_image',
    `photo turn must be send_image, got ${stolenCheckout.nextAction}`
  );
  assert(
    stolenCheckout.reason === 'turn_intent_browse_media',
    `expected turn_intent_browse_media, got ${stolenCheckout.reason}`
  );
  assert(
    !/أحتاج اسمك|احتاج اسمك/.test(stolenCheckout.responseText),
    'must not ask for name on photo turn'
  );
  assert(
    !/جاهز للتأكيد/.test(stolenCheckout.responseText),
    'must not show confirmation summary on photo turn'
  );
  passed++;

  // collect_info AI action on photo turn → still send_image
  const collectSteal = resolveOrderNextAction({
    aiNextAction: 'collect_info',
    fieldsComplete: false,
    fieldsWereCompleteBeforeTurn: false,
    wasAwaitingConfirmation: false,
    userMessage: 'بدي صورة القميص',
    language: 'arabic',
    collectedInfo: { product_name: 'قميص' },
    responseText: 'حاضر! رح أرسل لك صورة القميص. بس قبل هيك، ممكن تقولي اسمك؟',
    missingFields: ['name'],
    turnIntent: 'browse_media',
  });
  assert(collectSteal.nextAction === 'send_image', `got ${collectSteal.nextAction}`);
  assert(!/اسمك/.test(collectSteal.responseText), 'caption must not ask for name when checkout copy leaked');
  passed++;

  // Real checkout still works when turnIntent is other
  const realCheckout = resolveOrderNextAction({
    aiNextAction: 'await_confirmation',
    fieldsComplete: false,
    fieldsWereCompleteBeforeTurn: false,
    wasAwaitingConfirmation: false,
    userMessage: 'أحمد',
    language: 'arabic',
    collectedInfo: { product_name: 'قميص', name: 'أحمد' },
    responseText: 'طلبك جاهز للتأكيد',
    missingFields: ['phone', 'address'],
    turnIntent: 'other',
  });
  assert(
    realCheckout.nextAction === 'collect_info',
    `incomplete checkout should collect_info, got ${realCheckout.nextAction}`
  );
  passed++;

  // ── Phase 2: context-aware yes/no semantics ──

  assert(customerAffirmsOrder('نعم'), 'نعم affirms');
  assert(customerAffirmsOrder('اي اكد'), 'اي اكد affirms');
  assert(!customerAffirmsOrder('لا'), 'bare لا is not affirmation');
  assert(!customerAffirmsOrder('تمام، ممكن معلومات أكثر؟'), 'product info blocks affirm');
  passed++;

  assert(customerDeclinesMoreItems('لا'), 'bare لا declines more');
  assert(customerDeclinesMoreItems('لا شكراً'), 'لا شكراً declines more');
  assert(!customerDeclinesMoreItems('إلغاء الطلب'), 'cancel is not decline-more');
  passed++;

  assert(customerCancelsOrder('إلغاء الطلب'), 'إلغاء الطلب cancels');
  assert(customerCancelsOrder('الغي'), 'الغي cancels');
  assert(!customerCancelsOrder('لا'), 'bare لا is not cancel');
  passed++;

  assert(
    botReplyAsksForConfirmation('هل تريد تأكيد الطلب؟'),
    'detects confirmation ask'
  );
  assert(
    botReplyAsksToAddMore('تحب تضيف منتج ثاني؟'),
    'detects add-more ask'
  );
  passed++;

  const confirmAskBot =
    'تمام! طلبك جاهز للتأكيد:\n• قميص × 1\n• الهاتف: 091\n• العنوان: دمشق\n\nاكتب «نعم» لتثبيت الطلب.';

  const noAtConfirm = resolveOrderNextAction({
    aiNextAction: AWAIT_CONFIRMATION_ACTION,
    fieldsComplete: true,
    fieldsWereCompleteBeforeTurn: true,
    wasAwaitingConfirmation: true,
    userMessage: 'لا',
    language: 'arabic',
    collectedInfo: {
      name: 'Hussein',
      phone: '091',
      address: 'Damascus',
      product_name: 'Shirt',
    },
    responseText: confirmAskBot,
    lastBotReply: confirmAskBot,
    turnIntent: 'other',
  });
  assert(
    noAtConfirm.nextAction === 'await_confirmation',
    `«لا» at confirm must await clarification, got ${noAtConfirm.nextAction}`
  );
  assert(
    noAtConfirm.reason === 'ambiguous_no_at_confirmation',
    `reason ${noAtConfirm.reason}`
  );
  assert(
    noAtConfirm.nextAction !== 'confirm_order',
    'must not confirm on bare no at confirmation ask'
  );
  passed++;

  const addMoreBot = 'تحب تضيف منتج ثاني للطلب؟';
  const noAtAddMore = resolveOrderNextAction({
    aiNextAction: 'await_confirmation',
    fieldsComplete: true,
    fieldsWereCompleteBeforeTurn: true,
    wasAwaitingConfirmation: false,
    userMessage: 'لا',
    language: 'arabic',
    collectedInfo: {
      name: 'Hussein',
      phone: '091',
      address: 'Damascus',
      product_name: 'Shirt',
    },
    responseText: addMoreBot,
    lastBotReply: addMoreBot,
    turnIntent: 'other',
  });
  assert(
    noAtAddMore.nextAction === 'confirm_order',
    `«لا» at add-more should confirm, got ${noAtAddMore.nextAction}`
  );
  passed++;

  const yesAtConfirm = resolveOrderNextAction({
    aiNextAction: 'await_confirmation',
    fieldsComplete: true,
    fieldsWereCompleteBeforeTurn: true,
    wasAwaitingConfirmation: true,
    userMessage: 'نعم',
    language: 'arabic',
    collectedInfo: {
      name: 'Hussein',
      phone: '091',
      address: 'Damascus',
      product_name: 'Shirt',
    },
    responseText: confirmAskBot,
    lastBotReply: confirmAskBot,
    turnIntent: 'other',
  });
  assert(
    yesAtConfirm.nextAction === 'confirm_order',
    `«نعم» at confirm should confirm, got ${yesAtConfirm.nextAction}`
  );
  passed++;

  const cancelOrder = resolveOrderNextAction({
    aiNextAction: 'await_confirmation',
    fieldsComplete: true,
    fieldsWereCompleteBeforeTurn: true,
    wasAwaitingConfirmation: true,
    userMessage: 'إلغاء الطلب',
    language: 'arabic',
    collectedInfo: {
      name: 'Hussein',
      phone: '091',
      address: 'Damascus',
      product_name: 'Shirt',
    },
    responseText: confirmAskBot,
    lastBotReply: confirmAskBot,
    turnIntent: 'other',
  });
  assert(
    cancelOrder.nextAction === 'end_conversation',
    `cancel should end, got ${cancelOrder.nextAction}`
  );
  assert(cancelOrder.reason === 'customer_cancelled_order', cancelOrder.reason);
  passed++;

  const politeInfo = resolveOrderNextAction({
    aiNextAction: 'present_product',
    fieldsComplete: true,
    fieldsWereCompleteBeforeTurn: true,
    wasAwaitingConfirmation: false,
    userMessage: 'تمام، ممكن معلومات أكثر؟',
    language: 'arabic',
    collectedInfo: {
      name: 'Hussein',
      phone: '091',
      address: 'Damascus',
      product_name: 'Cream',
    },
    responseText: 'أكيد! شو حابب تعرف؟',
    modelAsksProductInfo: true,
    turnIntent: 'product_qa',
  });
  assert(
    politeInfo.nextAction === 'present_product',
    `product info must not confirm, got ${politeInfo.nextAction}`
  );
  passed++;

  // ── Phase 4: stage sync ──
  const state: { salesgpt_stage_id?: string; current_stage?: string } = {};
  applySalesGPTStage(state as any, '8');
  assert(state.salesgpt_stage_id === '8', 'stage id persisted');
  assert(state.current_stage === 'close', `stage 8 → close, got ${state.current_stage}`);
  assert(
    conversationStageForDb(state as any) === 'close',
    'DB stage derived from numeric id'
  );
  const fresh: { salesgpt_stage_id?: string; current_stage?: string } = {};
  applyFreshConversationStage(fresh as any);
  assert(fresh.salesgpt_stage_id === '1', 'fresh reset → stage 1');
  assert(fresh.current_stage === 'discover', 'fresh reset → discover');
  const handoff: { salesgpt_stage_id?: string; current_stage?: string } = {};
  applyHandoffStage(handoff as any);
  assert(handoff.salesgpt_stage_id === '9', 'handoff stage id');
  assert(handoff.current_stage === 'handoff', 'handoff label');
  assert(
    conversationStageForDb(handoff as any) === 'handoff',
    'DB stage handoff when escalated'
  );
  assert(
    deriveStageFromSalesGPTStageId('4') === 'offer',
    'derive stage 4 → offer'
  );
  passed++;

  console.log(`✅ TurnIntent golden tests passed: ${passed}`);
}

run();

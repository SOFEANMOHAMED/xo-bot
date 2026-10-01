/**
 * ReplyPolicy unit matrix — decision × completeness × missing axes.
 */
import { applyPostAgentReplyPolicy, composeOutboundReply } from './replyPolicy.js';
import { IDENTITY_BUNDLE_ASK_AR } from './collectInfoOrder.js';
import { REAL_TEST_WATCH } from './realTestCatalog.js';

let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string): void {
  if (!condition) {
    failed += 1;
    failures.push(message);
  }
}

{
  const empty = composeOutboundReply({
    decision: 'collect_identity',
    language: 'arabic',
    collected: {},
  });
  assert(
    empty.replyText === IDENTITY_BUNDLE_ASK_AR,
    `empty identity → full bundle, got: ${empty.replyText}`
  );
  assert(empty.nextAction === 'collect_info', 'collect next_action');
}

{
  const pair = composeOutboundReply({
    decision: 'collect_identity',
    language: 'arabic',
    collected: { name: 'سفيان' },
  });
  assert(
    /رقم هاتفك/.test(pair.replyText) && /عنوان التوصيل/.test(pair.replyText),
    `name only → phone+address, got: ${pair.replyText}`
  );
  assert(!/اسمك الكامل ورقم هاتفك وعنوان/.test(pair.replyText), 'not the three-field bundle');
}

{
  const cancel = composeOutboundReply({
    decision: 'cancel',
    language: 'arabic',
  });
  assert(cancel.nextAction === 'end_conversation', 'cancel action');
  assert(Boolean(cancel.replyText.trim()), 'cancel has text');
}

{
  const browse = applyPostAgentReplyPolicy({
    language: 'arabic',
    nextAction: 'present_product',
    turnIntent: 'product_qa',
    replyText: 'السعر 200 ريال.',
    collected: {},
    focusProduct: REAL_TEST_WATCH,
    checkoutMissing: ['name', 'phone', 'address', 'color'],
  });
  assert(
    browse.replySource === 'pass_through' && browse.replyText.includes('200'),
    `browse must not steal identity/color, got source=${browse.replySource} text=${browse.replyText}`
  );
}

{
  const askColor = applyPostAgentReplyPolicy({
    language: 'arabic',
    nextAction: 'collect_info',
    turnIntent: 'checkout',
    replyText: 'تمام نكمل الطلب',
    collected: { name: 'سفيان', phone: '09552222', address: 'دمشق' },
    focusProduct: REAL_TEST_WATCH,
    checkoutMissing: ['color'],
  });
  assert(
    askColor.replySource === 'ask_variant' && /لون/.test(askColor.replyText),
    `checkout missing color → ask variant, got ${askColor.replySource} ${askColor.replyText}`
  );
  assert(askColor.nextAction === 'collect_info', 'variant ask stays collect_info');
}

{
  const awaitReady = applyPostAgentReplyPolicy({
    language: 'arabic',
    nextAction: 'await_confirmation',
    turnIntent: 'checkout',
    replyText: 'x',
    collected: {
      name: 'سفيان',
      phone: '09552222',
      address: 'دمشق',
      product_name: 'ساعة',
    },
    cartLinesSummary: '• ساعة',
    focusProduct: REAL_TEST_WATCH,
    checkoutMissing: [],
  });
  assert(
    awaitReady.replySource === 'await_confirm' &&
      /للتأكيد|أكد/.test(awaitReady.replyText),
    `complete await → confirm template, got ${awaitReady.replySource} ${awaitReady.replyText}`
  );
}

{
  const variantBeatsAwait = applyPostAgentReplyPolicy({
    language: 'arabic',
    nextAction: 'await_confirmation',
    turnIntent: 'checkout',
    replyText: 'طلبك جاهز للتأكيد',
    collected: { name: 'سفيان', phone: '09552222', address: 'دمشق' },
    focusProduct: REAL_TEST_WATCH,
    checkoutMissing: ['color'],
  });
  assert(
    variantBeatsAwait.replySource === 'ask_variant' &&
      variantBeatsAwait.nextAction === 'collect_info',
    `missing color must beat await, got ${variantBeatsAwait.replySource} ${variantBeatsAwait.nextAction}`
  );
}

console.log(`reply-policy: ${failures.length === 0 ? 'passed' : `${failed} failed`}`);
if (failures.length > 0) {
  for (const item of failures) console.error(`FAIL: ${item}`);
  process.exit(1);
}
process.exit(0);

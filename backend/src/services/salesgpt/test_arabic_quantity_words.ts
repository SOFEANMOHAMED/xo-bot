/**
 * PHASE 2F — Arabic quantity words / dual forms.
 * Run: npx tsx --import ./src/database/testPreflight.ts src/services/salesgpt/test_arabic_quantity_words.ts
 */
import {
  ARABIC_QUANTITY_TEST_CASES,
  resolveQuantityFromMessage,
} from './arabicQuantityWords.js';
import {
  findProductsMentionedInText,
  quantityNearProductName,
  shouldSyncMultiProductCart,
} from './conversationCart.js';
import { REAL_TEST_WATCH } from './realTestCatalog.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

let passed = 0;

for (const c of ARABIC_QUANTITY_TEST_CASES) {
  const got = resolveQuantityFromMessage(c.phrase, c.productName);
  assert(
    got === c.quantity,
    `${c.note}: «${c.phrase}» expected ${c.quantity}, got ${got}`
  );
  passed++;
}

assert(
  findProductsMentionedInText('ساعتين', [REAL_TEST_WATCH]).some(
    (p) => p.id === REAL_TEST_WATCH.id
  ),
  'ساعتين names the watch'
);
assert(quantityNearProductName('ساعتين', REAL_TEST_WATCH.name) === 2, 'near-name dual=2');
assert(quantityNearProductName('بدي ساعتين', REAL_TEST_WATCH.name) === 2, 'بدي ساعتين=2');
assert(
  shouldSyncMultiProductCart('ساعتين', [REAL_TEST_WATCH]) === true,
  'ساعتين is orderish cart sync'
);
assert(
  shouldSyncMultiProductCart('بدي ساعتين', [REAL_TEST_WATCH]) === true,
  'بدي ساعتين is orderish cart sync'
);
passed += 5;

console.log(`arabic-quantity-words: ${passed} passed`);
process.exit(0);

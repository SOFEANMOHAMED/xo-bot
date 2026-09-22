/**
 * PHASE 2F — past-bot-claim dispute detector.
 * Run: npx tsx --import ./src/database/testPreflight.ts src/services/salesgpt/test_past_bot_claim_dispute.ts
 */
import {
  PAST_BOT_CLAIM_DISPUTE_TEST_CASES,
  isPastBotClaimDispute,
} from './pastBotClaimDispute.js';
import { resolveTurnIntent } from './turnIntent.js';
import { extractBareColorAnswer } from './pendingBotQuestion.js';
import { REAL_TEST_WATCH } from './realTestCatalog.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

let passed = 0;
for (const c of PAST_BOT_CLAIM_DISPUTE_TEST_CASES) {
  assert(
    isPastBotClaimDispute(c.phrase) === c.isDispute,
    `${c.note}: «${c.phrase}» expected ${c.isDispute}`
  );
  passed++;
}

assert(
  resolveTurnIntent({
    userMessage: 'أنت قلت في أسود',
    customerRequest: {
      wantsAlternatives: false,
      asksProductInfo: false,
      wantsPhoto: false,
      readyToConfirm: false,
      wantsAddAnother: false,
    },
  }) === 'product_qa',
  'dispute resolves to product_qa'
);
assert(
  extractBareColorAnswer('أنت قلت في أسود', REAL_TEST_WATCH.colors || []) === null,
  'dispute is not a bare color answer'
);
passed += 2;

console.log(`past-bot-claim-dispute: ${passed} passed`);
process.exit(0);

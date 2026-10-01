/**
 * Regression: focus priority + unsolicited upsell strip.
 *
 * Priority: message > pending > cart > post-seed > last_bot.
 * Suggestions only when the customer asks — never from reply text alone.
 * Run: npm run test-focus-no-upsell-hijack
 */

import type { Product } from '../../core/types.js';
import type { ProductOverviewRow } from '../../catalog/product-search.js';
import { stripUnsolicitedCrossSellMentions } from './customerRequest.js';
import { applyInterpreterResult } from './interpreter/apply.js';
import { groundInterpreterReply } from './interpreter/ground.js';
import { resolveFocus } from './resolveFocus.js';

const SHIRT_ID = 'cf17e5b3-3254-4f0d-8dee-2854680a498f';
const WATCH_ID = '76eb7b4b-634d-4b35-8067-d8a5e490606c';

const shirt: Product = {
  id: SHIRT_ID,
  name: 'قميص',
  price: 553,
  currency: 'USD',
  stock: 10,
  sizes: ['s', 'm', 'l'],
};

const watch: Product = {
  id: WATCH_ID,
  name: 'ساعة',
  price: 200,
  currency: 'SAR',
  stock: 5,
  colors: ['أسود', 'أحمر'],
};

const watchOverview: ProductOverviewRow = {
  id: WATCH_ID,
  name: 'ساعة',
  category: null,
  price: 200,
  currency: 'SAR',
  inStock: true,
  hasImage: false,
  hasColors: true,
  hasSizes: false,
};

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

let passed = 0;

function run(): void {
  // Live bug: cart focused on قميص; bot last reply casually mentions ساعة as upsell;
  // customer says "طيب بدي أطلبو" with no product name → focus must stay قميص.
  const result = resolveFocus({
    namedInMessage: [],
    pendingProduct: null,
    lastBotProduct: watch,
    cartFocusProduct: shirt,
    seededProduct: null,
  });
  assert(result.source === 'cart', `expected cart source, got ${result.source}`);
  assert(result.product?.id === SHIRT_ID, `expected shirt focus, got ${result.product?.name}`);
  passed++;
  console.log('✓ cart beats last_bot upsell mention');

  // Message mention still wins over cart and seed.
  const messageWins = resolveFocus({
    namedInMessage: [shirt],
    pendingProduct: null,
    lastBotProduct: watch,
    cartFocusProduct: watch,
    seededProduct: watch,
  });
  assert(messageWins.source === 'message', `expected message, got ${messageWins.source}`);
  assert(messageWins.product?.id === SHIRT_ID, 'message-named product must win over seed');
  passed++;
  console.log('✓ message beats cart + post-seed');

  // Pending still beats cart.
  const pendingWins = resolveFocus({
    namedInMessage: [],
    pendingProduct: watch,
    lastBotProduct: shirt,
    cartFocusProduct: shirt,
    seededProduct: null,
  });
  assert(pendingWins.source === 'pending', `expected pending, got ${pendingWins.source}`);
  assert(pendingWins.product?.id === WATCH_ID, 'pending product must win');
  passed++;
  console.log('✓ pending still beats cart');

  // Post-seed beats last_bot upsell aside when cart empty.
  const seedBeatsLastBot = resolveFocus({
    namedInMessage: [],
    pendingProduct: null,
    lastBotProduct: shirt,
    cartFocusProduct: null,
    seededProduct: watch,
  });
  assert(seedBeatsLastBot.source === 'seed', `expected seed, got ${seedBeatsLastBot.source}`);
  assert(seedBeatsLastBot.product?.id === WATCH_ID, 'post-seed must beat last_bot');
  passed++;
  console.log('✓ post-seed beats last_bot');

  // last_bot still used when cart + seed empty.
  const lastBotFallback = resolveFocus({
    namedInMessage: [],
    pendingProduct: null,
    lastBotProduct: watch,
    cartFocusProduct: null,
    seededProduct: null,
  });
  assert(lastBotFallback.source === 'last_bot', `expected last_bot, got ${lastBotFallback.source}`);
  assert(lastBotFallback.product?.id === WATCH_ID, 'last_bot fallback when no cart/seed');
  passed++;
  console.log('✓ last_bot still used when cart+seed empty');

  // ask_product_info with productId must explicitly change focus off the seed.
  {
    const productsById = new Map<string, Product>([
      [SHIRT_ID, shirt],
      [WATCH_ID, watch],
    ]);
    const applied = applyInterpreterResult({
      result: {
        rawModelConfidence: 1,
        actions: [
          {
            type: 'ask_product_info',
            productId: SHIRT_ID,
            infoKind: 'price',
            confidence: 0.95,
            evidence: 'القميص',
            ambiguous: false,
          },
        ],
      },
      state: {
        message_count: 1,
        extracted_entities: {
          product_id: WATCH_ID,
          product_query: 'ساعة',
        },
      },
      productsById,
    });
    assert(applied.focusExplicitlyChanged === true, 'ask_product_info must mark focus changed');
    assert(applied.focusProductId === SHIRT_ID, `focus must move to shirt, got ${applied.focusProductId}`);
    assert(
      applied.state.extracted_entities?.product_id === SHIRT_ID,
      'state product_id must become shirt'
    );
    passed++;
    console.log('✓ ask_product_info updates focus off post-seed');
  }

  // Inherited focus alone must NOT count as explicit change.
  {
    const productsById = new Map<string, Product>([[WATCH_ID, watch]]);
    const applied = applyInterpreterResult({
      result: {
        rawModelConfidence: 1,
        actions: [
          {
            type: 'ask_product_info',
            infoKind: 'price',
            confidence: 0.9,
            evidence: 'السعر',
            ambiguous: false,
          },
        ],
      },
      state: {
        message_count: 1,
        extracted_entities: {
          product_id: WATCH_ID,
          product_query: 'ساعة',
        },
      },
      productsById,
    });
    assert(applied.focusExplicitlyChanged === false, 'no productId → no explicit focus change');
    assert(applied.focusProductId === WATCH_ID, 'inherited seed focus preserved');
    passed++;
    console.log('✓ inherited seed focus is not an explicit change');
  }

  // Reply-text gate: XL shirt order must not keep a watch pitch.
  const stripped = stripUnsolicitedCrossSellMentions({
    replyText:
      'حبيبي، قبل ما أكمل طلبك للقميص مقاس XL، حابب أذكرك إنه عندنا ساعة كمان بسعر 200 ريال سعودي. الساعة مصنوعة من خامات عالية الجودة. حابب تعرف تفاصيل أكثر عن الساعة أو نكمل طلب القميص؟',
    activeProductNames: ['قميص'],
    otherProductNames: ['ساعة'],
    language: 'arabic',
  });
  assert(!/ساعة|200/.test(stripped), `strip must drop watch, got: ${stripped}`);
  passed++;
  console.log('✓ strip drops unsolicited watch pitch');

  // Final honesty gate with catalog overview.
  const grounded = groundInterpreterReply({
    replyText:
      'القميص سعره 553 دولار أمريكي. حابب تعرف تفاصيل أكثر عن الساعة أو أي منتج تاني؟',
    language: 'arabic',
    imageAttached: false,
    noMatchForSpecificQuery: false,
    catalogOverview: [watchOverview],
    salespersonName: 'مساعد المتجر',
    allowAlternatives: false,
    activeProductNames: ['قميص'],
  });
  assert(!/ساعة/.test(grounded), `ground must drop watch ask, got: ${grounded}`);
  assert(/قميص|553|نكمّل|نكمل/.test(grounded), `ground should keep shirt context, got: ${grounded}`);
  passed++;
  console.log('✓ groundInterpreterReply strips cross-sell');

  console.log(`\nAll ${passed} focus / upsell cases passed.`);
}

try {
  run();
} catch (err) {
  console.error(err);
  process.exit(1);
}

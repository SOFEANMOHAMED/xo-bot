/**
 * Phase 5 — Verification matrix (automated layer).
 * Run: npm run test-verification-matrix
 *
 * Covers business scenarios × shared channel helpers. Live Meta/WhatsApp sends
 * are marked manual — this script validates the decision layer all channels share.
 */

import { execSync } from 'child_process';
import { appendOrderDataIfConfirmed, buildMerchantBotConfig } from '../buildMerchantBotConfig.js';
import {
  extractImageUrl,
  extractOrderData,
  isCompleteOrderPayload,
  parseBotReplyTags,
} from '../channels/botTurn.js';
import {
  resolveOrderNextAction,
  customerAffirmsOrder,
  customerDeclinesMoreItems,
  customerCancelsOrder,
  botReplyAsksForConfirmation,
  botReplyAsksToAddMore,
  shouldAppendOrderData,
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
} from './conversationStateSync.js';
import { resetConversationAfterOrder } from '../channelBotOrder.js';
import type { ConversationState } from '../../core/types.js';
import {
  ensureCartForCheckout,
  getCartItems,
} from './conversationCart.js';
import { formatOrderNotesForMerchant, buildMerchantOrderNotes } from '../../orders/merchantOrderNotes.js';

type Channel =
  | 'facebook'
  | 'telegram'
  | 'instagram'
  | 'whatsapp_cloud'
  | 'whatsapp_web'
  | 'playground';

type MatrixRow = {
  id: string;
  scenario: string;
  channels: Channel[] | 'all';
  layer: string;
  run: () => void;
};

const ALL_CHANNELS: Channel[] = [
  'facebook',
  'telegram',
  'instagram',
  'whatsapp_cloud',
  'whatsapp_web',
  'playground',
];

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function channelLabel(ch: Channel): string {
  const map: Record<Channel, string> = {
    facebook: 'Facebook',
    telegram: 'Telegram',
    instagram: 'Instagram',
    whatsapp_cloud: 'WhatsApp Cloud',
    whatsapp_web: 'WhatsApp Web',
    playground: 'Playground',
  };
  return map[ch];
}

const confirmAskBot =
  'تمام! طلبك جاهز للتأكيد:\n• قميص × 1\n• الهاتف: 091\n• العنوان: دمشق\n\nاكتب «نعم» لتثبيت الطلب.';
const addMoreBot = 'تحب تضيف منتج ثاني للطلب؟';

const MATRIX: MatrixRow[] = [
  {
    id: 'M01',
    scenario: 'تحية / بداية محادثة — stage 1 discover',
    channels: 'all',
    layer: 'conversationStateSync',
    run: () => {
      const state = {} as ConversationState;
      applyFreshConversationStage(state);
      assert(state.salesgpt_stage_id === '1', 'fresh stage id');
      assert(state.current_stage === 'discover', 'fresh current_stage');
      assert(conversationStageForDb(state) === 'discover', 'DB stage discover');
    },
  },
  {
    id: 'M02',
    scenario: 'طلب صورة صريح → browse_media + send_image',
    channels: 'all',
    layer: 'turnIntent',
    run: () => {
      assert(isExplicitPhotoRequest('طيب ممكن تبعتلي صورة القميص'), 'photo detect');
      const intent = resolveTurnIntent({
        userMessage: 'طيب ممكن تبعتلي صورة القميص',
        customerRequest: {
          wantsAlternatives: false,
          asksProductInfo: false,
          wantsPhoto: false,
          readyToConfirm: false,
          wantsAddAnother: false,
        },
      });
      assert(intent === 'browse_media', `intent ${intent}`);
      assert(nextActionForBrowseTurn(intent, 'collect_info') === 'send_image', 'force send_image');
    },
  },
  {
    id: 'M03',
    scenario: 'طلب صورة لا يُسرق لمسار التأكيد',
    channels: 'all',
    layer: 'orderConfirmationPolicy',
    run: () => {
      const r = resolveOrderNextAction({
        aiNextAction: 'await_confirmation',
        fieldsComplete: false,
        fieldsWereCompleteBeforeTurn: false,
        wasAwaitingConfirmation: false,
        userMessage: 'بدي صورة القميص',
        language: 'arabic',
        collectedInfo: { product_name: 'قميص' },
        responseText: 'تمام! حتى نكمّل الطلب أحتاج اسمك',
        missingFields: ['name', 'phone', 'address'],
        turnIntent: 'browse_media',
      });
      assert(r.nextAction === 'send_image', `got ${r.nextAction}`);
      assert(!/جاهز للتأكيد/.test(r.responseText), 'no premature confirm');
    },
  },
  {
    id: 'M04',
    scenario: 'سؤال معلومات منتج يحجب التأكيد',
    channels: 'all',
    layer: 'orderConfirmationPolicy',
    run: () => {
      const r = resolveOrderNextAction({
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
      assert(r.nextAction === 'present_product', `got ${r.nextAction}`);
    },
  },
  {
    id: 'M05',
    scenario: 'جمع بيانات — حقول null لا تُفعّل التأكيد',
    channels: 'all',
    layer: 'orderConfirmationPolicy',
    run: () => {
      const r = resolveOrderNextAction({
        aiNextAction: 'await_confirmation',
        fieldsComplete: true,
        fieldsWereCompleteBeforeTurn: false,
        wasAwaitingConfirmation: false,
        userMessage: 'أحمر',
        language: 'arabic',
        collectedInfo: {
          name: 'null',
          phone: 'null',
          address: 'null',
          product_name: 'Watch',
          color: 'أحمر',
        },
        responseText: 'تمام null! طلبك جاهز للتأكيد',
        missingFields: ['name', 'phone', 'address'],
      });
      assert(r.nextAction === 'collect_info', `got ${r.nextAction}`);
      assert(!/\bnull\b/i.test(r.responseText), 'no null in copy');
    },
  },
  {
    id: 'M06',
    scenario: '«لا» عند «هل تريد إضافة المزيد؟» → confirm_order',
    channels: 'all',
    layer: 'orderConfirmationPolicy',
    run: () => {
      assert(customerDeclinesMoreItems('لا'), 'decline more');
      const r = resolveOrderNextAction({
        aiNextAction: AWAIT_CONFIRMATION_ACTION,
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
      assert(r.nextAction === 'confirm_order', `got ${r.nextAction}`);
      assert(botReplyAsksToAddMore(addMoreBot), 'detect add-more ask');
    },
  },
  {
    id: 'M07',
    scenario: '«لا» عند «هل تؤكد الطلب؟» → توضيح (لا confirm)',
    channels: 'all',
    layer: 'orderConfirmationPolicy',
    run: () => {
      assert(!customerAffirmsOrder('لا'), 'لا ليس تأكيداً');
      const r = resolveOrderNextAction({
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
      assert(r.nextAction === 'await_confirmation', `got ${r.nextAction}`);
      assert(r.reason === 'ambiguous_no_at_confirmation', r.reason ?? '');
      assert(r.nextAction !== 'confirm_order', 'must not confirm');
      assert(botReplyAsksForConfirmation(confirmAskBot), 'detect confirm ask');
    },
  },
  {
    id: 'M08',
    scenario: '«نعم» عند التأكيد → confirm_order',
    channels: 'all',
    layer: 'orderConfirmationPolicy',
    run: () => {
      assert(customerAffirmsOrder('نعم'), 'نعم affirms');
      const r = resolveOrderNextAction({
        aiNextAction: AWAIT_CONFIRMATION_ACTION,
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
      assert(r.nextAction === 'confirm_order', `got ${r.nextAction}`);
    },
  },
  {
    id: 'M09',
    scenario: '«إلغاء الطلب» → end_conversation',
    channels: 'all',
    layer: 'orderConfirmationPolicy',
    run: () => {
      assert(customerCancelsOrder('إلغاء الطلب'), 'cancel detect');
      const r = resolveOrderNextAction({
        aiNextAction: AWAIT_CONFIRMATION_ACTION,
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
      assert(r.nextAction === 'end_conversation', `got ${r.nextAction}`);
      assert(r.reason === 'customer_cancelled_order', r.reason ?? '');
    },
  },
  {
    id: 'M10',
    scenario: 'ORDER_DATA يُلحق فقط عند confirm_order',
    channels: 'all',
    layer: 'buildMerchantBotConfig',
    run: () => {
      const entities = { name: 'أحمد', phone: '0912345678', address: 'دمشق' };
      const productIds = ['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'];
      const base = 'تم تأكيد طلبك!';

      assert(!shouldAppendOrderData('await_confirmation', base), 'await no append');
      assert(shouldAppendOrderData('confirm_order', base), 'confirm append');

      const without = appendOrderDataIfConfirmed({
        responseText: base,
        nextAction: 'await_confirmation',
        entities,
        productIds,
        storeCurrency: 'USD',
      });
      assert(!without.includes('[ORDER_DATA]'), 'no tag on await');

      const withTag = appendOrderDataIfConfirmed({
        responseText: base,
        nextAction: 'confirm_order',
        entities,
        productIds,
        storeCurrency: 'USD',
      });
      assert(withTag.includes('[ORDER_DATA]'), 'tag on confirm');
      const { orderData } = extractOrderData(withTag);
      assert(orderData?.customerName === 'أحمد', 'parsed name');
      assert(!String(orderData?.notes || '').includes('Full AI'), 'no Full AI in notes');
      assert(!String(orderData?.notes || '').includes('Order via'), 'no Order via in notes');
    },
  },
  {
    id: 'M11',
    scenario: 'سلة متعددة المنتجات في ORDER_DATA',
    channels: 'all',
    layer: 'buildMerchantBotConfig',
    run: () => {
      const tagged = appendOrderDataIfConfirmed({
        responseText: 'تم!',
        nextAction: 'confirm_order',
        entities: { name: 'سارة', phone: '099', address: 'حلب' },
        productIds: [],
        storeCurrency: 'SYP',
        cartItems: [
          {
            productId: '11111111-2222-3333-4444-555555555555',
            productName: 'قميص',
            quantity: 2,
            unitPrice: 50,
            currency: 'SYP',
            color: 'أزرق',
          },
          {
            productId: '66666666-7777-8888-9999-aaaaaaaaaaaa',
            productName: 'بنطلون',
            quantity: 1,
            unitPrice: 80,
            currency: 'SYP',
          },
        ],
      });
      const { orderData } = extractOrderData(tagged);
      assert(Array.isArray(orderData?.products) && orderData.products.length === 2, '2 products');
      assert(orderData.products[0].productName === 'قميص', 'first product');
      assert(orderData.products[0].quantity === 2, 'qty 2');
      assert(orderData.total === 180, `total ${orderData.total}`);
    },
  },
  {
    id: 'M12',
    scenario: 'استخراج ORDER_DATA — صيغة canonical',
    channels: 'all',
    layer: 'botTurn',
    run: () => {
      const text =
        'شكراً!\n[ORDER_DATA]{"customerName":"Ali","customerPhone":"1","customerAddress":"X","products":[{"productId":"11111111-2222-3333-4444-555555555555","productName":"Watch","quantity":1}]}\n[/ORDER_DATA]';
      const { orderData, cleanText } = extractOrderData(text);
      assert(orderData?.customerName === 'Ali', 'parsed');
      assert(!cleanText.includes('ORDER_DATA'), 'stripped');
      assert(isCompleteOrderPayload(orderData), 'complete payload');
    },
  },
  {
    id: 'M13',
    scenario: 'استخراج ORDER_DATA — صيغة WhatsApp Web البديلة',
    channels: ['whatsapp_web'],
    layer: 'botTurn',
    run: () => {
      const alt =
        'تم\n[ORDER_DATA]{"customerName":"W","customerPhone":"2","customerAddress":"Y","products":[{"productId":"11111111-2222-3333-4444-555555555555","productName":"Bag","quantity":1}]}\n[/ORDER_DATA]';
      const { orderData } = extractOrderData(alt);
      assert(orderData?.customerName === 'W', 'alt parsed');

      const bracketAlt =
        'ok [_]{"customerName":"Z","customerPhone":"3","customerAddress":"Z","products":[{"productId":"11111111-2222-3333-4444-555555555555","productName":"Hat","quantity":1}]}[/_]';
      const { orderData: od2 } = extractOrderData(bracketAlt);
      assert(od2?.customerName === 'Z', 'bracket alt parsed');
    },
  },
  {
    id: 'M14',
    scenario: 'استخراج IMAGE tag + parseBotReplyTags',
    channels: 'all',
    layer: 'botTurn',
    run: () => {
      const text = 'هاي الصورة [IMAGE: https://cdn.example.com/p.jpg] جميلة';
      const { imageUrl, cleanText } = extractImageUrl(text);
      assert(imageUrl === 'https://cdn.example.com/p.jpg', imageUrl ?? '');
      assert(!cleanText.includes('[IMAGE'), 'image stripped');

      const combined =
        'تم [IMAGE: https://x.com/a.png] [ORDER_DATA]{"customerName":"A","customerPhone":"1","customerAddress":"B","products":[{"productId":"11111111-2222-3333-4444-555555555555","productName":"P","quantity":1}]}[/ORDER_DATA]';
      const parsed = parseBotReplyTags(combined);
      assert(!!parsed.imageUrl?.includes('x.com'), 'combined image');
      assert(parsed.orderData?.customerName === 'A', 'combined order');
    },
  },
  {
    id: 'M15',
    scenario: 'stage 8 (await confirm) → close في DB',
    channels: 'all',
    layer: 'conversationStateSync',
    run: () => {
      const state = {} as ConversationState;
      applySalesGPTStage(state, '8');
      assert(state.salesgpt_stage_id === '8', 'id 8');
      assert(state.current_stage === 'close', 'close');
      assert(conversationStageForDb(state) === 'close', 'DB close');
    },
  },
  {
    id: 'M16',
    scenario: 'reset بعد الطلب — stage 1 + مسح checkout',
    channels: 'all',
    layer: 'channelBotOrder',
    run: () => {
      const state = {
        salesgpt_stage_id: '8',
        current_stage: 'close',
        message_count: 5,
        extracted_entities: { name: 'x', phone: 'y', address: 'z' },
        cart: {
          items: [
            {
              productId: '11111111-2222-3333-4444-555555555555',
              productName: 'P',
              quantity: 1,
              unitPrice: 10,
              currency: 'USD',
              addedAt: new Date().toISOString(),
            },
          ],
        },
        abandoned_checkout: { stage: 'close' } as ConversationState['abandoned_checkout'],
      } as ConversationState;
      resetConversationAfterOrder(
        state,
        { products: [{ productName: 'P' }] },
        'ORD-TEST-001'
      );
      assert(state.salesgpt_stage_id === '1', 'reset id');
      assert(state.current_stage === 'discover', 'reset stage');
      assert(!state.cart?.items?.length, 'cart cleared');
      assert(!state.abandoned_checkout, 'checkout cleared');
    },
  },
  {
    id: 'M17',
    scenario: 'تصعيد بشري — handoff stage 9',
    channels: 'all',
    layer: 'conversationStateSync',
    run: () => {
      const state = {} as ConversationState;
      applyHandoffStage(state);
      assert(state.salesgpt_stage_id === '9', 'handoff id');
      assert(state.current_stage === 'handoff', 'handoff label');
      assert(conversationStageForDb(state) === 'handoff', 'DB handoff');
    },
  },
  {
    id: 'M18',
    scenario: 'Full AI دائماً — use_full_ai_mode: true',
    channels: 'all',
    layer: 'buildMerchantBotConfig',
    run: () => {
      for (const ch of ALL_CHANNELS) {
        const cfg = buildMerchantBotConfig({
          merchantId: '00000000-0000-4000-8000-000000000001',
          settings: { store_name: 'Test', store_currency: 'USD' },
          systemPromptSuffix: ch === 'instagram' || ch === 'facebook' ? 'acquisition note' : '',
        });
        assert(cfg.use_full_ai_mode === true, `${ch} full ai`);
      }
    },
  },
  {
    id: 'M19',
    scenario: 'طلب ناقص لا يُعتبر complete للحفظ',
    channels: 'all',
    layer: 'botTurn',
    run: () => {
      assert(!isCompleteOrderPayload(null), 'null');
      assert(!isCompleteOrderPayload({ customerName: 'A' }), 'partial');
      assert(
        isCompleteOrderPayload({
          customerName: 'A',
          customerPhone: '1',
          customerAddress: 'B',
          products: [{ productId: '11111111-2222-3333-4444-555555555555', productName: 'P', quantity: 1 }],
        }),
        'complete'
      );
    },
  },
  {
    id: 'M20',
    scenario: 'سلة متعددة: ملء لون الساعة دون سطر ثالث',
    channels: 'all',
    layer: 'conversationCart',
    run: () => {
      const watchId = 'aaaaaaaa-1111-4000-8000-000000000001';
      const shirtId = 'bbbbbbbb-2222-4000-8000-000000000002';
      const next = ensureCartForCheckout(
        {
          message_count: 1,
          extracted_entities: {
            name: 'أحمد',
            phone: '099',
            address: 'دمشق',
            product_id: watchId,
            color: 'اسود',
          },
          cart: {
            status: 'building',
            items: [
              {
                productId: watchId,
                productName: 'ساعات',
                quantity: 1,
                unitPrice: 200,
                currency: 'USD',
                addedAt: '2026-08-23T00:00:00.000Z',
              },
              {
                productId: shirtId,
                productName: 'قميص',
                quantity: 1,
                unitPrice: 553,
                currency: 'USD',
                addedAt: '2026-08-23T00:00:00.000Z',
              },
            ],
          },
        },
        {
          id: watchId,
          name: 'ساعات',
          price: 200,
          currency: 'USD',
          stock: 10,
          colors: ['أسود', 'أبيض'],
        },
        'USD'
      );
      const items = getCartItems(next);
      assert(items.length === 2, `expected 2 lines, got ${items.length}`);
      assert(
        items.find((row) => row.productId === watchId)?.color === 'أسود',
        'watch color filled'
      );
    },
  },
  {
    id: 'M21',
    scenario: 'ملاحظات الطلب عربية بدون Full AI أو تكرار القناة',
    channels: 'all',
    layer: 'merchantOrderNotes',
    run: () => {
      const legacy =
        'Order via Facebook Messenger (Full AI Mode) | 1 × ساعات | 1 × قميص | 1 × ساعات | Color: اسود';
      const formatted = formatOrderNotesForMerchant(legacy);
      assert(!formatted.toLowerCase().includes('full ai'), 'stripped Full AI');
      assert(!formatted.toLowerCase().includes('order via'), 'stripped Order via');
      assert(formatted.includes('اللون: اسود'), 'color in Arabic');
      assert(formatted.includes('ساعات'), 'keeps product names for legacy');
      assert(!buildMerchantOrderNotes({ notes: legacy })?.includes('Facebook'), 'new store drops channel');
      assert(buildMerchantOrderNotes({}) === null, 'empty notes stay empty');
    },
  },
];

type Result = {
  id: string;
  scenario: string;
  channels: string;
  status: 'PASS' | 'FAIL';
  error?: string;
};

function runMatrix(): Result[] {
  const results: Result[] = [];
  for (const row of MATRIX) {
    const channels =
      row.channels === 'all'
        ? ALL_CHANNELS.map(channelLabel).join(', ')
        : row.channels.map(channelLabel).join(', ');
    try {
      row.run();
      results.push({ id: row.id, scenario: row.scenario, channels, status: 'PASS' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.push({ id: row.id, scenario: row.scenario, channels, status: 'FAIL', error: msg });
    }
  }
  return results;
}

function printTable(results: Result[]): void {
  const idW = 4;
  const statusW = 6;
  console.log('\n┌──────┬────────┬────────────────────────────────────────────────────────────┐');
  console.log('│ ID   │ Status │ Scenario                                                   │');
  console.log('├──────┼────────┼────────────────────────────────────────────────────────────┤');
  for (const r of results) {
    const scenario = r.scenario.length > 58 ? `${r.scenario.slice(0, 55)}...` : r.scenario;
    const status = r.status === 'PASS' ? '  ✅  ' : '  ❌  ';
    console.log(`│ ${r.id.padEnd(idW)} │${status}│ ${scenario.padEnd(58)} │`);
    if (r.error) {
      console.log(`│      │        │ ↳ ${r.error.slice(0, 70)}`);
    }
  }
  console.log('└──────┴────────┴────────────────────────────────────────────────────────────┘');
}

function runGoldenSuites(): { name: string; ok: boolean; detail?: string }[] {
  const suites = [
    { name: 'test-turn-intent-golden', script: 'test-turn-intent-golden' },
    { name: 'test-salesgpt-golden', script: 'test-salesgpt-golden' },
    { name: 'test-conversation-cart', script: 'test-conversation-cart' },
  ];
  return suites.map(({ name, script }) => {
    try {
      execSync(`npm run ${script}`, { cwd: process.cwd(), stdio: 'pipe', encoding: 'utf8' });
      return { name, ok: true };
    } catch (e: any) {
      const detail = e?.stdout || e?.stderr || String(e);
      return { name, ok: false, detail };
    }
  });
}

function main(): void {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' Phase 5 — Automated Verification Matrix');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const results = runMatrix();
  printTable(results);

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL');

  console.log(`\nMatrix: ${passed}/${results.length} passed`);

  console.log('\n── Golden suites (regression) ──');
  const goldens = runGoldenSuites();
  for (const g of goldens) {
    console.log(g.ok ? `  ✅ ${g.name}` : `  ❌ ${g.name}\n${g.detail}`);
  }

  console.log('\n── Manual only (requires live channel / merchant) ──');
  const manual = [
    'H01 — إرسال تحية حقيقية على IG/FB/TG/WA → رد بوت + stage محفوظ',
    'H02 — طلب صورة → وصول [IMAGE] للعميل',
    'H03 — محادثة كاملة حتى confirm_order → ظهور طلب في لوحة التاجر',
    'H04 — merchant_id isolation: محادثتان لتاجرين → لا تسرّب بيانات',
    'H05 — acquisitionNote على IG/FB من إعلان → سياق المنتج في الرد',
  ];
  for (const h of manual) console.log(`  ⏸  ${h}`);

  const goldenOk = goldens.every((g) => g.ok);
  if (failed.length > 0 || !goldenOk) {
    console.error('\n❌ Verification FAILED');
    process.exit(1);
  }

  console.log('\n✅ All automated verification checks passed');
  console.log(`   Matrix: ${passed} scenarios × all shared channels`);
  console.log(`   Golden: ${goldens.length} regression suites`);
  process.exit(0);
}

main();

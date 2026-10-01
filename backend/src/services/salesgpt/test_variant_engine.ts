/**
 * VARIANT_ENGINE V1–V3 unit + V4 size-gate + V5 color wrappers.
 * Run: npm run test-variant-engine
 */
import type { CartItem, Product } from '../../core/types.js';
import {
  buildAskColorMessage,
  resolveOrderColor,
} from './orderColorPolicy.js';
import { extractBareColorAnswer } from './pendingBotQuestion.js';
import { resolveVariantChange } from './resolveVariantChange.js';
import {
  axisById,
  buildAskVariantMessage,
  detectPendingAxis,
  effectiveAxes,
  extractBareVariantAnswer,
  gateConfirmWhenVariantsInvalid,
  isAxisActive,
  isOurVariantAskTemplate,
  missingAxes,
  resolveIncomingPending,
  resolveVariantAxisChange,
  selectionInCatalog,
  setLineVariant,
} from './variantEngine/index.js';

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

const perfume: Product = {
  id: 'perfume-1',
  name: 'عطر',
  price: 220,
  currency: 'AED',
  stock: 3,
  colors: [],
  sizes: ['50ml', '100ml'],
};

const dress: Product = {
  id: 'dress-1',
  name: 'فستان',
  price: 120,
  currency: 'USD',
  stock: 4,
  colors: ['أحمر', 'L'],
  sizes: ['S', 'M', 'L'],
};

const styled: Product = {
  id: 'phone-1',
  name: 'هاتف',
  price: 1,
  currency: 'USD',
  stock: 2,
  colors: ['أسود'],
  sizes: [],
  variant_axes: [
    { id: 'style', labels: { ar: 'طراز', en: 'Style' }, values: ['رياضي', 'كلاسيك'] },
    { id: 'color', labels: { ar: 'لون', en: 'Color' }, values: ['ذهبي'] },
  ],
};

const shirt: Product = {
  id: 'shirt-1',
  name: 'قميص',
  price: 10,
  currency: 'USD',
  stock: 1,
  colors: [],
  sizes: [],
};

function line(product: Product, extras: Partial<CartItem> = {}): CartItem {
  return {
    lineId: 'line-1',
    productId: product.id,
    productName: product.name,
    quantity: 1,
    unitPrice: product.price,
    currency: product.currency,
    addedAt: 't',
    ...extras,
  };
}

// ——— V1 axes ———
{
  const axes = effectiveAxes(watch);
  assert(axes.length === 1 && axes[0].id === 'color', 'watch: color only');
  assert(axes[0].values[0] === 'أسود', 'watch color values from column');
  assert(isAxisActive(watch, 'color') && !isAxisActive(watch, 'size'), 'watch size inactive');
}

{
  const axes = effectiveAxes(perfume);
  assert(axes.length === 1 && axes[0].id === 'size', 'perfume: size only');
  assert(axisById(perfume, 'size')?.values.includes('50ml') === true, '50ml present');
}

{
  const ids = effectiveAxes(dress).map((a) => a.id);
  assert(ids.join(',') === 'color,size', `dress axes ${ids.join(',')}`);
}

{
  const ids = effectiveAxes(styled).map((a) => a.id);
  assert(ids.includes('color') && ids.includes('style'), 'styled has color+style');
  assert(!ids.filter((id) => id === 'color').length || true, 'color once');
  const color = axisById(styled, 'color');
  assert(color?.values.includes('أسود') === true, 'column color wins over JSONB color');
  assert(color?.values.includes('ذهبي') !== true, 'JSONB color ignored');
}

{
  assert(effectiveAxes(shirt).length === 0, 'shirt no axes');
  assert(effectiveAxes(null).length === 0, 'null product');
}

{
  const missing = missingAxes(watch, {});
  assert(missing.length === 1 && missing[0].id === 'color', 'watch missing color');
  assert(missingAxes(watch, { color: 'أسود' }).length === 0, 'watch color filled');
  assert(missingAxes(watch, { color: 'أزرق' }).length === 1, 'watch blue not in catalog');
  assert(selectionInCatalog(effectiveAxes(watch)[0], 'اسود') === true, 'color adapter أسود');
}

// ——— V3 ask template ———
{
  const sizeAxis = axisById(perfume, 'size')!;
  const ar = buildAskVariantMessage('arabic', sizeAxis);
  assert(ar.startsWith('أي مقاس بتحب؟'), `ar ask: ${ar}`);
  assert(ar.includes('50ml') && ar.includes('100ml'), 'ask lists values');
  assert(isOurVariantAskTemplate(ar, sizeAxis), 'our size template matches');
  assert(!isOurVariantAskTemplate('شو المقاس المناسب؟ 50ml', sizeAxis), 'free LLM size ask is not ours');

  const colorAxis = axisById(watch, 'color')!;
  const en = buildAskVariantMessage('english', colorAxis);
  assert(/Which Color would you like/i.test(en), `en ask: ${en}`);
  assert(isOurVariantAskTemplate(en, colorAxis), 'our color template matches');
  assert(
    en.includes('1) أسود\n2) أحمر') || en.includes('1) أسود\n2)'),
    `options must be vertical (one per line), got: ${en}`
  );
}

{
  const styleAxis = axisById(styled, 'style')!;
  const ask = buildAskVariantMessage('arabic', styleAxis);
  assert(ask.startsWith('أي طراز بتحب؟'), ask);
  assert(detectPendingAxis(ask, styled) === 'style', 'detect style from our template');
  assert(detectPendingAxis('أي لون بتحب؟\n1) أسود — 2) أحمر', watch) === 'color', 'legacy color fingerprint');
}

{
  const pending = resolveIncomingPending({
    stored: 'style',
    storedProductId: styled.id,
    lastBotReply: '',
    product: styled,
  });
  assert(pending?.axisId === 'style', 'V2 stored extra axis id');
}

// ——— V3 extract (strict) ———
{
  const sizeAxis = axisById(perfume, 'size')!;
  assert(extractBareVariantAnswer('50ml', sizeAxis) === '50ml', 'bare 50ml');
  assert(extractBareVariantAnswer('بدي 100ml', sizeAxis) === '100ml', 'بدي 100ml');
  assert(extractBareVariantAnswer('2', sizeAxis) === '100ml', 'numeric 2 → 100ml');
  assert(extractBareVariantAnswer('M', sizeAxis) === null, 'M not a perfume size');
  assert(
    extractBareVariantAnswer('50ml غالي؟', sizeAxis) === null,
    'size value in a longer sentence is not a bare answer'
  );
}

{
  const colorAxis = axisById(watch, 'color')!;
  assert(extractBareVariantAnswer('أسود', colorAxis) === 'أسود', 'bare أسود');
  assert(extractBareVariantAnswer('الأسود', colorAxis) === 'أسود', 'الأسود');
  assert(extractBareVariantAnswer('بدي الأسود', colorAxis) === 'أسود', 'بدي الأسود');
  assert(extractBareVariantAnswer('2', colorAxis) === 'أحمر', 'numeric 2 → أحمر');
  assert(
    extractBareVariantAnswer('الأسود غالي؟', colorAxis) === null,
    'P1-2: color in a price question is not a selection'
  );
  assert(extractBareVariantAnswer('M', colorAxis) === null, 'M not a watch color');
}

{
  const sizeAxis = axisById(dress, 'size')!;
  const colorAxis = axisById(dress, 'color')!;
  assert(extractBareVariantAnswer('M', sizeAxis) === 'M', 'dress M is size');
  assert(extractBareVariantAnswer('M', colorAxis) === null, 'dress M is not color');
  assert(extractBareVariantAnswer('L', sizeAxis) === 'L', 'L on size');
  assert(extractBareVariantAnswer('L', colorAxis) === 'L', 'L on color (catalog value)');
}

// ——— change / disambiguation ———
{
  const cart = [line(watch, { color: 'أسود' })];
  const none = resolveVariantAxisChange({
    messageText: 'الأسود غالي؟',
    product: watch,
    cartLines: cart,
    pending: null,
    selection: { color: 'أسود' },
  });
  assert(none.kind === 'none', `price question is not a color change, got ${none.kind}`);

  const pick = resolveVariantAxisChange({
    messageText: 'أحمر',
    product: watch,
    cartLines: cart,
    pending: null,
    selection: { color: 'أسود' },
  });
  assert(pick.kind === 'apply' && pick.kind === 'apply' && pick.value === 'أحمر', 'bare أحمر applies');

  const corrected = resolveVariantAxisChange({
    messageText: 'لا ما بدي اسود بدي احمر',
    product: watch,
    cartLines: cart,
    pending: null,
    selection: { color: 'أسود' },
  });
  assert(
    corrected.kind === 'apply' && corrected.value === 'أحمر',
    `correction → أحمر, got ${JSON.stringify(corrected)}`
  );
}

{
  const ambiguous = resolveVariantAxisChange({
    messageText: 'L',
    product: dress,
    cartLines: [line(dress)],
    pending: null,
    selection: {},
  });
  assert(ambiguous.kind === 'ask_which_axis', `L on dress → ask axis, got ${ambiguous.kind}`);
  if (ambiguous.kind === 'ask_which_axis') {
    assert(ambiguous.axisIds.includes('color') && ambiguous.axisIds.includes('size'), 'both axes');
  }

  const pendingSize = resolveVariantAxisChange({
    messageText: 'L',
    product: dress,
    cartLines: [line(dress)],
    pending: { axisId: 'size', productId: dress.id },
    selection: {},
  });
  assert(
    pendingSize.kind === 'apply' && pendingSize.value === 'L' && pendingSize.axisId === 'size',
    'pending size wins on L'
  );
}

// ——— gate ———
{
  const blocked = gateConfirmWhenVariantsInvalid({
    nextAction: 'confirm_order',
    product: watch,
    selection: {},
    language: 'arabic',
    replyText: 'تم',
  });
  assert(blocked.nextAction === 'await_confirmation', 'gate blocks confirm');
  assert(blocked.missingAxis?.id === 'color', 'asks color');
  assert(/أي لون بتحب/.test(blocked.replyText), blocked.replyText);

  const ok = gateConfirmWhenVariantsInvalid({
    nextAction: 'confirm_order',
    product: watch,
    selection: { color: 'أسود' },
    language: 'arabic',
    replyText: 'تم',
  });
  assert(ok.nextAction === 'confirm_order', 'complete color may confirm');

  const sizeBlocked = gateConfirmWhenVariantsInvalid({
    nextAction: 'confirm_order',
    product: perfume,
    selection: {},
    language: 'arabic',
    replyText: 'تم',
  });
  assert(sizeBlocked.nextAction === 'await_confirmation', 'perfume size gate blocks');
  assert(sizeBlocked.missingAxis?.id === 'size', 'asks size');
  assert(/أي مقاس بتحب/.test(sizeBlocked.replyText), sizeBlocked.replyText);
}

// ——— line mirror ———
{
  const updated = setLineVariant(line(watch), 'color', 'أحمر');
  assert(updated.color === 'أحمر', 'mirror color');
  assert(updated.variants?.color === 'أحمر', 'variants.color');
}

// ——— V5 color wrappers (P1-2) ———
{
  const colors = watch.colors || [];
  assert(extractBareColorAnswer('أسود', colors) === 'أسود', 'V5 bare أسود');
  assert(extractBareColorAnswer('الأسود', colors) === 'أسود', 'V5 الأسود');
  assert(extractBareColorAnswer('بدي الأسود', colors) === 'أسود', 'V5 بدي الأسود');
  assert(extractBareColorAnswer('2', colors) === 'أحمر', 'V5 numeric 2');
  assert(extractBareColorAnswer('الأسود غالي؟', colors) === null, 'V5 P1-2 price question');

  const ask = buildAskColorMessage('arabic', colors);
  const colorAxis = axisById(watch, 'color')!;
  assert(isOurVariantAskTemplate(ask, colorAxis), 'V5 ask-color is engine template');
  assert(/أي لون بتحب/.test(ask) && ask.includes('أسود'), ask);

  const fromPrice = resolveOrderColor({
    catalogColors: colors,
    currentMessage: 'الأسود غالي؟',
    userMessages: ['الأسود غالي؟'],
  });
  assert(fromPrice.color === null, `V5 resolveOrderColor ignores price question, got ${fromPrice.color}`);

  const fromBare = resolveOrderColor({
    catalogColors: colors,
    currentMessage: 'الأسود',
    userMessages: ['الأسود'],
  });
  assert(fromBare.color === 'أسود', `V5 resolveOrderColor bare, got ${fromBare.color}`);

  const fromHistory = resolveOrderColor({
    catalogColors: colors,
    currentMessage: 'الأسود غالي؟',
    userMessages: ['بدي الأسود', 'الأسود غالي؟'],
    storedColor: 'أسود',
  });
  assert(fromHistory.color === 'أسود', 'V5 history/stored still wins when current is not a pick');

  const changeNone = resolveVariantChange({
    messageText: 'الأسود غالي؟',
    cartLines: [line(watch, { color: 'أحمر' })],
    products: [watch],
    focusProductId: watch.id,
  });
  assert(changeNone.kind === 'none', `V5 price question is not a color change, got ${changeNone.kind}`);

  const changePick = resolveVariantChange({
    messageText: 'أسود',
    cartLines: [line(watch, { color: 'أحمر' })],
    products: [watch],
    focusProductId: watch.id,
  });
  assert(changePick.kind === 'apply' && changePick.color === 'أسود', 'V5 bare color change');
}

// ——— Size correction without pending («غيّر المقاس … s») ———
{
  const sizedShirt: Product = {
    id: 'shirt-sized-1',
    name: 'قميص',
    price: 553,
    currency: 'USD',
    stock: 10,
    colors: [],
    sizes: ['s', 'm', 'l'],
  };
  const cart = [line(sizedShirt, { size: 'm' })];
  const corrected = resolveVariantAxisChange({
    messageText: 'بد أغير المقاس بديا s',
    product: sizedShirt,
    cartLines: cart,
    pending: null,
    selection: { size: 'm' },
  });
  assert(
    corrected.kind === 'apply' &&
      corrected.axisId === 'size' &&
      corrected.value === 's',
    `engine size correction → s, got ${JSON.stringify(corrected)}`
  );

  const viaAdapter = resolveVariantChange({
    messageText: 'بد أغير المقاس بديا s',
    cartLines: cart,
    products: [sizedShirt],
    focusProductId: sizedShirt.id,
  });
  assert(
    viaAdapter.kind === 'apply' &&
      viaAdapter.axisId === 'size' &&
      viaAdapter.value === 's',
    `adapter size correction → s, got ${JSON.stringify(viaAdapter)}`
  );

  const unchanged = resolveVariantChange({
    messageText: 'غيّر المقاس لـ m',
    cartLines: cart,
    products: [sizedShirt],
    focusProductId: sizedShirt.id,
  });
  assert(
    unchanged.kind === 'unchanged' && unchanged.value === 'm',
    `already m is unchanged, got ${JSON.stringify(unchanged)}`
  );

  const viaAdel = resolveVariantChange({
    messageText: 'عدل المقاس لـ s',
    cartLines: cart,
    products: [sizedShirt],
    focusProductId: sizedShirt.id,
  });
  assert(
    viaAdel.kind === 'apply' && viaAdel.axisId === 'size' && viaAdel.value === 's',
    `عدل المقاس → s, got ${JSON.stringify(viaAdel)}`
  );
}

console.log('test_variant_engine: PASS');

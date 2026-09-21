import { register } from 'node:module';

/*
 * ESM exports are immutable, so assigning generateJSON/searchProducts after
 * importing the pipeline does not work under tsx. This preload registers a
 * narrow ESM resolve hook before index.ts is evaluated. Only the catalog and
 * Gemini modules are replaced; their test implementations read the shared
 * harness state in the application realm.
 *
 * Node 20's node:test mock API has no stable mock.module implementation, which
 * is why these suites use a register hook rather than mutation or a DB.
 */

const stateUrl = new URL('./test_pipeline_harness_state.ts', import.meta.url).href;

const catalogModule = `
import { harness } from ${JSON.stringify(stateUrl)};

const normalize = (value) => String(value || '')
  .normalize('NFKD')
  .replace(/[\\u064B-\\u065F\\u0670]/g, '')
  .replace(/[إأآٱ]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/ؤ/g, 'و')
  .replace(/ئ/g, 'ي')
  .replace(/ة/g, 'ه')
  .toLowerCase()
  .trim();

export const normalizeArabic = normalize;

const cloned = (value) => structuredClone(value);
const available = (filters) =>
  filters?.inStockOnly ? harness.catalog.filter((product) => product.stock > 0) : harness.catalog;

export const searchProducts = async (_merchantId, query, filters, limit = 5) => {
  harness.calls.searchProducts += 1;
  const needle = normalize(query).replace(/^ال/, '');
  const rows = available(filters).filter((product) => {
    if (!needle) return true;
    const fields = [product.name, product.category, product.description]
      .map(normalize)
      .map((value) => value.replace(/^ال/, ''));
    return fields.some((value) => value.includes(needle) || needle.includes(value));
  });
  return cloned(rows.slice(0, limit));
};

export const getTopProducts = async (_merchantId, limit = 10) =>
  cloned(harness.catalog.slice(0, limit));

export const getProductById = async (_merchantId, productId) => {
  const product = harness.catalog.find((candidate) => candidate.id === productId);
  return product ? cloned(product) : null;
};

export const getProductsOverview = async (_merchantId, limit = 30) =>
  cloned(harness.catalog.slice(0, limit).map((product) => ({
    id: product.id,
    name: product.name,
    category: product.category ?? null,
    price: product.price,
    currency: product.currency,
    inStock: product.stock > 0,
    hasImage: Boolean(product.imageUrl),
    hasColors: Boolean(product.colors?.length),
    hasSizes: Boolean(product.sizes?.length),
  })));

export const getCatalogMeta = async () => {
  const categories = new Map();
  for (const product of harness.catalog) {
    const name = product.category || 'غير مصنف';
    categories.set(name, (categories.get(name) || 0) + 1);
  }
  return {
    totalProducts: harness.catalog.length,
    inStockProducts: harness.catalog.filter((product) => product.stock > 0).length,
    categories: [...categories].map(([name, count]) => ({ name, count })),
  };
};

export const clearProductCache = () => undefined;
`;

const geminiModule = `
import { harness } from ${JSON.stringify(stateUrl)};

export const generateJSON = async (prompt) => {
  harness.calls.generateJSON += 1;
  harness.lastGeneratePrompt = prompt;
  return { data: structuredClone(harness.llmReply), success: true };
};

let aiCalls = 0;
export const trackAICall = () => { aiCalls += 1; };
export const getAICallsCount = () => aiCalls;
export const resetAICallsCount = () => { aiCalls = 0; };
export const generateSimple = async () => ({ text: '', success: true });
export const generateContent = async () => ({ text: '', success: true });
export const getAIClient = () => null;
export const isAIAvailable = () => true;
`;

const loaderSource = `
const catalogUrl = 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(catalogModule)});
const geminiUrl = 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(geminiModule)});

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('/catalog/product-search.js')) {
    return { url: catalogUrl, shortCircuit: true };
  }
  if (specifier.endsWith('/ai/gemini-client.js')) {
    return { url: geminiUrl, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
`;

register(`data:text/javascript,${encodeURIComponent(loaderSource)}`, import.meta.url);

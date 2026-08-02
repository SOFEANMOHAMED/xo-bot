/**
 * Image Recognition Service
 * Analyzes customer-sent images via OpenAI Vision, then searches the merchant catalog.
 * Used by Telegram / Messenger / Instagram DM controllers.
 */

import OpenAI from 'openai';
import { logger } from '../utils/logger.js';
import { searchProducts } from '../catalog/product-search.js';
import type { Product } from '../core/types.js';

const API_KEY = process.env.OPENAI_API_KEY || '';

let client: OpenAI | null = null;
const getClient = (): OpenAI | null => {
  if (!API_KEY) return null;
  if (!client) client = new OpenAI({ apiKey: API_KEY });
  return client;
};

export interface ImageAnalysisResult {
  description: string;
  searchQuery: string;
  products: Product[];
}

/**
 * Download an image from a URL and return a base64 data-URL.
 * Works for Telegram file links, Facebook CDN, Instagram CDN, etc.
 */
export async function imageUrlToBase64(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    const mime = resp.headers.get('content-type') || 'image/jpeg';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (e) {
    logger.error('Failed to download image for vision', e as Error, { url });
    return null;
  }
}

/**
 * Analyze an image and search the merchant catalog for matching products.
 *
 * @param imageDataUrl  base64 data-URL (data:image/…;base64,…) OR a public https URL
 * @param merchantId    merchant whose catalog to search
 * @param userMessage   optional text the user sent alongside the photo
 * @param storeCurrency for context in the prompt
 */
export async function analyzeImageAndSearch(
  imageDataUrl: string,
  merchantId: string,
  userMessage?: string,
  storeCurrency?: string
): Promise<ImageAnalysisResult | null> {
  const ai = getClient();
  if (!ai) {
    logger.warn('imageRecognition: OpenAI key not configured');
    return null;
  }

  try {
    const systemPrompt = `You are a product recognition assistant for an online store.
The user sent a photo — possibly of a product they want to buy.
1. Describe the item briefly (type, color, brand if visible, material).
2. Return a concise JSON object with:
   { "description": "<short Arabic description>", "searchQuery": "<1-3 Arabic keywords suitable for searching a product catalog>" }
Only output the JSON, no markdown fences.`;

    const userContent: OpenAI.Chat.ChatCompletionContentPart[] = [];

    if (userMessage && userMessage.trim()) {
      userContent.push({ type: 'text', text: `رسالة العميل: ${userMessage}` });
    }

    userContent.push({
      type: 'image_url',
      image_url: { url: imageDataUrl, detail: 'low' }
    });

    const completion = await ai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ],
      temperature: 0.3,
      max_tokens: 300
    });

    let raw = completion.choices?.[0]?.message?.content?.trim() || '';
    if (raw.startsWith('```')) {
      raw = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }

    let parsed: { description?: string; searchQuery?: string };
    try {
      parsed = JSON.parse(raw);
    } catch {
      logger.warn('imageRecognition: could not parse vision JSON', { raw });
      parsed = { description: raw, searchQuery: raw.substring(0, 40) };
    }

    const description = parsed.description || 'منتج';
    const searchQuery = parsed.searchQuery || description;

    logger.info('imageRecognition: vision result', { description, searchQuery, merchantId });

    const products = await searchProducts(merchantId, searchQuery, undefined, 5);

    return { description, searchQuery, products };
  } catch (e) {
    logger.error('imageRecognition: analysis failed', e as Error, { merchantId });
    return null;
  }
}

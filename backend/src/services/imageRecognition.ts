/**
 * Image Recognition Service
 * Primary path: CLIP visual similarity against the merchant's product images.
 * Fallback: OpenAI Vision description + text catalog search.
 *
 * Used by Telegram / Messenger / Instagram DM controllers.
 */

import OpenAI from 'openai';
import { logger } from '../utils/logger.js';
import { searchProducts } from '../catalog/product-search.js';
import {
  embedImageBuffer,
  searchProductsByImageEmbedding,
  loadProductsByIdsOrdered,
  resolveImageToBuffer
} from '../catalog/visual-embeddings.js';
import type { Product } from '../core/types.js';
import { recordOpenAIUsage } from './llmUsage/index.js';

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
  /** visual | vision_text | none */
  matchMethod?: 'visual' | 'vision_text' | 'none';
  visualScores?: Array<{ productId: string; score: number }>;
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

async function dataUrlOrUrlToBuffer(imageDataUrl: string): Promise<Buffer | null> {
  if (imageDataUrl.startsWith('data:image/')) {
    const match = imageDataUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
    if (!match?.[1]) return null;
    return Buffer.from(match[1], 'base64');
  }
  return resolveImageToBuffer(imageDataUrl);
}

async function describeImageWithVision(
  imageDataUrl: string,
  merchantId: string,
  userMessage?: string
): Promise<{ description: string; searchQuery: string } | null> {
  const ai = getClient();
  if (!ai) return null;

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

  recordOpenAIUsage(completion.usage, {
    merchantId,
    purpose: 'image_recognition',
    model: 'gpt-4o-mini',
  });

  let raw = completion.choices?.[0]?.message?.content?.trim() || '';
  if (raw.startsWith('```')) {
    raw = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }

  try {
    const parsed = JSON.parse(raw) as { description?: string; searchQuery?: string };
    return {
      description: parsed.description || 'منتج',
      searchQuery: parsed.searchQuery || parsed.description || 'منتج'
    };
  } catch {
    return { description: raw || 'منتج', searchQuery: (raw || 'منتج').substring(0, 40) };
  }
}

/**
 * Analyze an image and match against the merchant catalog.
 * Prefer CLIP visual similarity; fall back to Vision + text search.
 */
export async function analyzeImageAndSearch(
  imageDataUrl: string,
  merchantId: string,
  userMessage?: string,
  _storeCurrency?: string
): Promise<ImageAnalysisResult | null> {
  try {
    const buffer = await dataUrlOrUrlToBuffer(imageDataUrl);
    if (!buffer) {
      logger.warn('imageRecognition: could not decode customer image', { merchantId });
      return null;
    }

    // ---------- Primary: CLIP visual match (tenant-scoped) ----------
    const queryEmbedding = await embedImageBuffer(buffer);
    if (queryEmbedding) {
      const matches = await searchProductsByImageEmbedding(merchantId, queryEmbedding, {
        limit: 5,
        minScore: Number(process.env.VISUAL_MATCH_MIN_SCORE || '0.28')
      });

      if (matches.length > 0) {
        const products = await loadProductsByIdsOrdered(
          merchantId,
          matches.map((m) => m.productId)
        );

        // Optional short Arabic description for bot UX (non-blocking on failure)
        let description = products[0]?.name || 'منتج مشابه';
        let searchQuery = products[0]?.name || description;
        try {
          const vision = await describeImageWithVision(imageDataUrl, merchantId, userMessage);
          if (vision?.description) description = vision.description;
          if (vision?.searchQuery) searchQuery = vision.searchQuery;
        } catch {
          /* keep product-name fallback */
        }

        logger.info('imageRecognition: visual CLIP match', {
          merchantId,
          matchCount: products.length,
          topScore: matches[0]?.score,
          topProduct: products[0]?.name
        });

        return {
          description,
          searchQuery,
          products,
          matchMethod: 'visual',
          visualScores: matches.map((m) => ({ productId: m.productId, score: m.score }))
        };
      }

      logger.info('imageRecognition: no visual match above threshold', { merchantId });
    } else {
      logger.warn('imageRecognition: CLIP embed failed — falling back to vision text', {
        merchantId
      });
    }

    // ---------- Fallback: Vision caption + lexical catalog search ----------
    const vision = await describeImageWithVision(imageDataUrl, merchantId, userMessage);
    if (!vision) {
      logger.warn('imageRecognition: vision fallback unavailable', { merchantId });
      return {
        description: 'صورة منتج',
        searchQuery: '',
        products: [],
        matchMethod: 'none'
      };
    }

    const products = await searchProducts(merchantId, vision.searchQuery, undefined, 5);
    logger.info('imageRecognition: vision text fallback', {
      merchantId,
      descriptionLength: vision.description?.length || 0,
      searchQueryLength: vision.searchQuery?.length || 0,
      productCount: products.length
    });

    return {
      description: vision.description,
      searchQuery: vision.searchQuery,
      products,
      matchMethod: products.length > 0 ? 'vision_text' : 'none'
    };
  } catch (e) {
    logger.error('imageRecognition: analysis failed', e as Error, { merchantId });
    return null;
  }
}

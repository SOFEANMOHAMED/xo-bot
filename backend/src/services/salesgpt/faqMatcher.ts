/**
 * Merchant FAQ semantic matcher — classify customer turn against merchant FAQs.
 * On match, callers send the stored answer verbatim (no AI-generated reply text).
 */
import { generateJSON } from '../../ai/gemini-client.js';
import { logger } from '../../utils/logger.js';
import {
  getCachedMerchantFaqs,
  type MerchantFaqRow,
} from '../cacheService.js';
import type { Message } from '../../core/types.js';

/** Minimum model confidence to accept an FAQ match (0..1). */
export const FAQ_CONFIDENCE_THRESHOLD = 0.75;

export type FaqMatchResult = {
  id: string;
  answer: string;
};

type FaqClassifyPayload = {
  faqId?: string | null;
  confidence?: number;
};

function buildFaqClassifyPrompt(
  faqs: MerchantFaqRow[],
  messageText: string,
  recentMessages: Message[]
): string {
  const catalog = faqs.map((f) => ({ id: f.id, question: f.question }));
  const recent = recentMessages.slice(-4).map((m) => ({
    role: m.role,
    content: String(m.content || '').slice(0, 200),
  }));

  return `Classify whether the customer message matches one of the merchant FAQs by meaning (not exact wording).
Return JSON only.
faqs: ${JSON.stringify(catalog)}
recentMessages: ${JSON.stringify(recent)}
message: ${JSON.stringify(messageText)}

Rules:
- Match by semantic intent / meaning across Arabic dialects and English.
- Return faqId of the single best matching FAQ id, or null if none clearly matches.
- confidence is 0..1 for how sure you are the match is correct.
- Do NOT invent FAQ ids. Only use ids from faqs.
- Do NOT write an answer. Classification only.

{
  "faqId": "uuid-or-null",
  "confidence": 0.0
}`;
}

/**
 * Semantic FAQ match for one customer turn.
 * Returns null when no FAQs exist (no AI call) or confidence is below threshold.
 */
export async function matchFaqForTurn(input: {
  merchantId: string;
  messageText: string;
  recentMessages: Message[];
}): Promise<FaqMatchResult | null> {
  const faqs = await getCachedMerchantFaqs(input.merchantId);
  if (faqs.length === 0) return null;

  try {
    const generated = await generateJSON<FaqClassifyPayload>(
      buildFaqClassifyPrompt(faqs, input.messageText, input.recentMessages),
      {
        temperature: 0,
        maxOutputTokens: 150,
        usage: { merchantId: input.merchantId, purpose: 'sales_chat' },
      }
    );

    if (!generated.success || !generated.data?.faqId) {
      return null;
    }

    const confidence =
      typeof generated.data.confidence === 'number' ? generated.data.confidence : 0;
    if (confidence < FAQ_CONFIDENCE_THRESHOLD) {
      logger.info('FAQ match below confidence threshold', {
        merchantId: input.merchantId,
        faqId: generated.data.faqId,
        confidence,
      });
      return null;
    }

    const matched = faqs.find((f) => f.id === generated.data!.faqId);
    if (!matched) {
      logger.warn('FAQ classifier returned unknown faqId', {
        merchantId: input.merchantId,
        faqId: generated.data.faqId,
      });
      return null;
    }

    return { id: matched.id, answer: matched.answer };
  } catch (error) {
    logger.error('FAQ matcher failed', error as Error, {
      merchantId: input.merchantId,
    });
    return null;
  }
}

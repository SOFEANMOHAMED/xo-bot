import { Request, Response, NextFunction } from 'express';
import OpenAI from 'openai';
import { createError } from '../middleware/errorHandler.js';
import { z } from 'zod';
import { SAAS_MARKETING_DATA, SAAS_SUPPORT_DATA } from '../constants/saasData.js';
import { logger } from '../utils/logger.js';

// Ensure API key is present
const API_KEY = process.env.OPENAI_API_KEY || '';
const DEFAULT_MODEL = 'gpt-4o-mini';
const ai = API_KEY ? new OpenAI({ apiKey: API_KEY }) : null;

const saasBotRequestSchema = z.object({
  query: z.string().min(1),
  botType: z.enum(['marketing', 'support']),
});

/**
 * Public endpoint for SaaS bots (no authentication required)
 * Used by LandingChatBot and DashboardAssistant
 */
export const generateSaaSBotResponse = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!ai) {
      return next(createError('AI service not configured', 500));
    }

    const validated = saasBotRequestSchema.parse(req.body);
    const { query, botType } = validated;

    let systemPrompt = '';

    if (botType === 'marketing') {
      systemPrompt = `
      You are the AI Assistant for the "Al-Musa'id" (Smart Assistant) SaaS Platform landing page.
      Goal: Help visitors understand the service and convert to signups.
      
      Service Info (Source is Arabic, Translate as needed):
      - Name: ${SAAS_MARKETING_DATA.product_name}
      - Value: ${SAAS_MARKETING_DATA.main_value}
      - Pricing: ${SAAS_MARKETING_DATA.pricing_notes}
      - Features: ${SAAS_MARKETING_DATA.features.join(', ')}
      - CTA: ${SAAS_MARKETING_DATA.cta}
      
      Rules:
      1. LANGUAGE: Detect user language (Arabic, English, etc.) and reply in that language.
      2. If the user asks in English, translate the Arabic service info to English.
      3. Tone: Friendly, welcoming, conversion-focused.
      4. Always end with a Call to Action to sign up.
    `;
    } else {
      systemPrompt = `
      You are the Support Assistant inside the dashboard.
      Goal: Help existing merchants use the platform.
      
      Knowledge Base (Source is Arabic, Translate as needed):
      - Add Product Steps: ${SAAS_SUPPORT_DATA.tutorials.add_product.join(' -> ')}
      - Connect Shopify Steps: ${SAAS_SUPPORT_DATA.tutorials.connect_shopify.join(' -> ')}
      - Test Bot Steps: ${SAAS_SUPPORT_DATA.tutorials.test_bot.join(' -> ')}
      - Support Contact: ${SAAS_SUPPORT_DATA.support_contact}
      
      Rules:
      1. LANGUAGE: Detect user language and reply in that language.
      2. If user asks "How to...", provide numbered steps.
      3. Be helpful and direct.
    `;
    }

    // Generate response with retry logic for rate limits and service unavailable
    let response;
    let retries = 0;
    const maxRetries = 4; // Increased for 503 errors
    
    while (retries <= maxRetries) {
      try {
        response = await ai.chat.completions.create({
          model: DEFAULT_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: query }
          ],
          temperature: 0.3
        });
        break; // Success, exit retry loop
      } catch (error: any) {
        // Check if it's a service unavailable / overloaded error (503)
        const isServiceUnavailable = error?.status === 503 ||
          error?.code === 503 ||
          error?.statusCode === 503 ||
          error?.status === 'UNAVAILABLE' ||
          error?.code === 'UNAVAILABLE' ||
          error?.message?.includes('503') ||
          error?.message?.includes('overloaded') ||
          error?.message?.includes('UNAVAILABLE') ||
          error?.message?.includes('The model is overloaded');

        // Check if it's a rate limit error (429)
        const isRateLimit = error?.status === 429 || 
                           error?.code === 429 || 
                           error?.statusCode === 429 ||
                           error?.message?.includes('429') ||
                           error?.message?.includes('quota') ||
                           error?.message?.includes('RESOURCE_EXHAUSTED');
        
        // Retry for both 503 and 429 errors
        if ((isServiceUnavailable || isRateLimit) && retries < maxRetries) {
          // For 503 errors, use exponential backoff: 2s, 4s, 8s, 16s
          // For 429 errors, use the delay from error or default 5s
          let retryDelay: number;
          
          if (isServiceUnavailable) {
            // Exponential backoff for service unavailable
            retryDelay = Math.min(2000 * Math.pow(2, retries), 16000); // Max 16 seconds
            logger.warn(`Service unavailable (503), retrying in ${retryDelay}ms (attempt ${retries + 1}/${maxRetries + 1})`, { error });
          } else {
            // For rate limits, extract delay from error if available
            retryDelay = 5000; // Default 5 seconds
            try {
              const errorDetails = error?.details || error?.error?.details || [];
              const retryInfo = errorDetails.find((d: any) => d['@type']?.includes('RetryInfo'));
              if (retryInfo?.retryDelay) {
                // Convert seconds to milliseconds
                retryDelay = parseFloat(retryInfo.retryDelay) * 1000;
              }
            } catch (e) {
              // Use default delay
            }
            logger.warn(`Rate limit hit (429), retrying in ${retryDelay}ms (attempt ${retries + 1}/${maxRetries + 1})`, { error });
          }
          
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          retries++;
          continue;
        }
        
        // If not retryable error or max retries reached, throw the error
        const errorMessage = isServiceUnavailable
          ? 'الخدمة مشغولة حالياً. يرجى المحاولة مرة أخرى خلال بضع ثوانٍ.'
          : isRateLimit 
          ? 'تم تجاوز الحد المسموح به من الطلبات اليومية. يرجى المحاولة لاحقاً أو ترقية الخطة.'
          : error?.message || 'حدث خطأ في الاتصال بخدمة الذكاء الاصطناعي.';
        throw new Error(errorMessage);
      }
    }
    
    // If we still don't have a response after retries, throw an error
    if (!response) {
      throw new Error('تم تجاوز الحد المسموح به من الطلبات اليومية. يرجى المحاولة لاحقاً أو ترقية الخطة.');
    }

    const responseText = response.choices?.[0]?.message?.content || "I didn't understand, could you clarify?";

    res.json({
      success: true,
      data: {
        response: responseText
      }
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return next(createError(error.errors[0].message, 400));
    }
    next(error);
  }
};


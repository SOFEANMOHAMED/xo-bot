import { Response, NextFunction } from 'express';
import { z } from 'zod';
import OpenAI from 'openai';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import pool from '../database/connection.js';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';
import { handleIncomingMessage } from '../bot/index.js';
import {
  buildMerchantBotConfig,
  appendOrderDataIfConfirmed
} from '../services/buildMerchantBotConfig.js';
import { escalateConversationToHuman } from '../services/escalation.js';
import { stripInternalControlMarkers } from '../response/sanitize-reply.js';
import {
  getOrCreateConversationHelper,
  appendMessage,
  patchConversationState
} from '../controllers/conversation.controller.js';
import { getCachedMerchantSettings } from '../services/cacheService.js';
import { conversationIngressQueue } from '../services/conversationIngressQueue.js';
import { getAIClient, isAIAvailable } from '../ai/gemini-client.js';
import { generateImageWithKie } from '../ai/kie-client.js';
import { logger } from '../utils/logger.js';
import type { ConversationState, Message, Persona, Platform } from '../core/types.js';

const chatRequestSchema = z.object({
  conversationId: z.string().uuid().optional(),
  platform: z.enum(['web', 'facebook_messenger', 'facebook_comment', 'telegram', 'whatsapp', 'instagram']).default('web'),
  botType: z.enum(['products', 'services', 'marketing', 'support']).default('products'),
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string()
  })).min(1),
  context: z.object({
    products: z.array(z.any()).optional(),
    services: z.array(z.any()).optional(),
    storeName: z.string().optional(),
    storeCurrency: z.string().optional(),
    systemPrompt: z.string().optional(),
    persona: z.enum(['formal', 'friendly', 'sales', 'fast', 'luxury']).optional(),
    policies: z.object({
      shippingPolicy: z.string().optional(),
      deliveryTime: z.string().optional(),
      paymentMethods: z.string().optional(),
      returnPolicy: z.string().optional(),
      additionalNotes: z.string().optional(),
      enableAIInjection: z.boolean().optional()
    }).optional()
  }).optional()
});

/** Map playground/API platform to the same Platform union used by FB/IG/Telegram. */
function resolveBotPlatform(platform: string): Platform {
  if (platform === 'facebook_comment') return 'facebook_comment';
  if (platform === 'facebook_messenger') return 'facebook_messenger';
  if (platform === 'instagram') return 'instagram';
  if (platform === 'telegram') return 'telegram';
  if (platform === 'whatsapp') return 'whatsapp';
  return 'web';
}

export const generateChatResponse = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const validated = chatRequestSchema.parse(req.body);
    const { conversationId, platform, messages, context } = validated;

    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
    const messageText = lastUserMessage?.content || messages[messages.length - 1]?.content || '';

    if (!messageText.trim()) {
      return next(createError('Message text is required', 400));
    }

    const cachedSettings = await getCachedMerchantSettings(req.merchantId);
    if (!cachedSettings) {
      return next(createError('Merchant settings not found', 404));
    }

    // Same entry point as Facebook / Instagram / Telegram
    const botPlatform = resolveBotPlatform(platform);
    const playgroundUserId = 'playground-test-user';

    // Prefer existing conversation (tenant-scoped); otherwise same get-or-create pattern as channels
    let conversation: Awaited<ReturnType<typeof getOrCreateConversationHelper>>;
    if (conversationId) {
      const owned = await pool.query(
        `SELECT id, merchant_id, platform, user_id, user_name, conversation_state,
                current_intent, session_metadata, stage, last_error, last_message_at,
                created_at, updated_at
         FROM conversations
         WHERE id = $1 AND merchant_id = $2
         LIMIT 1`,
        [conversationId, req.merchantId]
      );
      if (owned.rows.length === 0) {
        return next(createError('Conversation not found', 404));
      }
      const row = owned.rows[0];
      conversation = {
        id: row.id,
        merchantId: row.merchant_id,
        platform: row.platform,
        userId: row.user_id,
        userName: row.user_name,
        conversationState: row.conversation_state || {},
        currentIntent: row.current_intent,
        sessionMetadata: row.session_metadata || {},
        stage: row.stage || 'discover',
        lastError: row.last_error,
        lastMessageAt: row.last_message_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    } else {
      conversation = await getOrCreateConversationHelper({
        merchantId: req.merchantId,
        platform: botPlatform,
        userId: playgroundUserId
      });
    }

    const merchantConfig = buildMerchantBotConfig({
      merchantId: req.merchantId,
      settings: {
        ...cachedSettings,
        store_name: context?.storeName || cachedSettings.store_name,
        store_currency: context?.storeCurrency || cachedSettings.store_currency,
        system_prompt: context?.systemPrompt ?? cachedSettings.system_prompt,
        bot_persona: context?.persona || cachedSettings.bot_persona,
        shipping_policy: context?.policies?.shippingPolicy ?? cachedSettings.shipping_policy,
        delivery_time: context?.policies?.deliveryTime ?? cachedSettings.delivery_time,
        payment_methods: context?.policies?.paymentMethods ?? cachedSettings.payment_methods,
        return_policy: context?.policies?.returnPolicy ?? cachedSettings.return_policy,
        additional_notes: context?.policies?.additionalNotes ?? cachedSettings.additional_notes,
      },
      overrides: {
        persona: (context?.persona || cachedSettings.bot_persona || 'friendly') as Persona,
      }
    });

    type PlaygroundIngressPayload = {
      conversationId: string;
      merchantId: string;
      botPlatform: Platform;
      playgroundUserId: string;
      merchantConfig: ReturnType<typeof buildMerchantBotConfig>;
      storeCurrency: string;
    };

    const ingress = await conversationIngressQueue.enqueue({
      conversationKey: `${req.merchantId}:${botPlatform}:${conversation.id}`,
      merchantId: req.merchantId,
      platform: botPlatform,
      text: messageText,
      externalMessageId: `playground-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      payload: {
        conversationId: conversation.id,
        merchantId: req.merchantId,
        botPlatform,
        playgroundUserId,
        merchantConfig,
        storeCurrency: cachedSettings.store_currency || 'USD'
      } satisfies PlaygroundIngressPayload,
      process: async (batch) => {
        const p = batch.latestPayload;
        const mergedText = batch.mergedText || messageText;

        // Reload conversation state at flush time (SaaS-scoped) so merged turns see latest DB state
        const fresh = await pool.query(
          `SELECT conversation_state FROM conversations
           WHERE id = $1 AND merchant_id = $2
           LIMIT 1`,
          [p.conversationId, p.merchantId]
        );
        const freshState: ConversationState =
          fresh.rows[0]?.conversation_state && typeof fresh.rows[0].conversation_state === 'object'
            ? { message_count: 0, ...fresh.rows[0].conversation_state }
            : { message_count: 0 };

        const recentMessagesResult = await pool.query(
          `SELECT role, content FROM messages
           WHERE conversation_id = $1
           ORDER BY created_at DESC
           LIMIT 25`,
          [p.conversationId]
        );
        const recentMessages: Message[] = recentMessagesResult.rows
          .reverse()
          .map((row: { role: string; content: string }) => ({
            role: row.role as 'user' | 'assistant',
            content: row.content
          }));

        const result = await handleIncomingMessage({
          merchantId: p.merchantId,
          platform: p.botPlatform,
          userId: playgroundUserId,
          userName: 'عميل تجريبي',
          messageText: mergedText,
          externalMessageId: `playground-batch-${Date.now()}`,
          recentMessages,
          conversationState: freshState,
          merchantConfig: p.merchantConfig
        });

        let responseText = result.replyText;
        const updatedState = result.updatedState;
        const entities = updatedState.extracted_entities || {};
        const productIds = updatedState.last_recommended_products || [];

        responseText = appendOrderDataIfConfirmed({
          responseText,
          nextAction: result.next_action,
          entities,
          productIds,
          storeCurrency: p.storeCurrency,
          channelLabel: `Bot Playground (${p.botPlatform})`,
        });

        if (result.shouldEscalate) {
          await escalateConversationToHuman({
            merchantId: p.merchantId,
            conversationId: p.conversationId,
            platform: p.botPlatform,
            userId: playgroundUserId,
            userName: 'عميل تجريبي',
            reason: result.next_action === 'handoff' ? 'handoff_action' : 'escalate_marker',
            replyPreview: responseText,
          });
        }

        responseText = stripInternalControlMarkers(responseText);

        await appendMessage(
          p.conversationId,
          'user',
          mergedText,
          'user',
          undefined,
          {
            platform: p.botPlatform,
            timestamp: new Date().toISOString(),
            source: 'playground',
            mergedParts: batch.parts.length
          },
          result.meta.intent,
          entities
        );

        await appendMessage(
          p.conversationId,
          'assistant',
          responseText,
          'bot',
          undefined,
          {
            platform: p.botPlatform,
            pipelineUsed: result.meta.pipelineUsed,
            aiCallsCount: result.meta.aiCallsCount,
            processingTimeMs: result.meta.processingTimeMs,
            next_action: result.next_action,
            source: 'playground',
            engine: 'channel-bot',
            mergedParts: batch.parts.length
          },
          result.meta.intent,
          { recommended_products: productIds }
        );

        await patchConversationState(p.conversationId, {
          conversation_state: updatedState,
          current_intent: result.meta.intent,
          stage: result.meta.stage
        });

        logger.info('Playground message processed via channel bot path', {
          merchantId: p.merchantId,
          conversationId: p.conversationId,
          platform: p.botPlatform,
          pipelineUsed: result.meta.pipelineUsed,
          intent: result.meta.intent,
          stage: result.meta.stage,
          mergedParts: batch.parts.length
        });

        return {
          responseText,
          conversationId: p.conversationId
        };
      }
    });

    res.json({
      success: true,
      data: {
        response: ingress.result.responseText,
        conversationId: ingress.result.conversationId,
        mergedParts: ingress.batchSize
      }
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return next(createError(error.errors[0].message, 400));
    }
    next(error);
  }
};

const productDescriptionSchema = z.object({
  productName: z.string().min(1, 'اسم المنتج مطلوب').max(500),
  keywords: z.string().max(5000).optional().default(''),
  category: z.string().max(200).optional().default('عام'),
  /** data URL (data:image/...;base64,...) أو base64 خام */
  imageBase64: z.string().max(25 * 1024 * 1024).optional()
});

export interface ProductDescriptionAIResult {
  title: string;
  description: string;
  features: string[];
  cta: string;
}

/**
 * توليد وصف تسويقي للمنتج عبر OpenAI (مفتاح الخادم) — يدعم صورة اختيارية (رؤية).
 */
export const generateProductDescriptionAI = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.merchantId) {
      return next(createError('Unauthorized', 401));
    }

    if (!isAIAvailable()) {
      return next(
        createError(
          'خدمة الذكاء الاصطناعي غير مضبوطة على الخادم. أضف OPENAI_API_KEY في إعدادات الـ backend.',
          503
        )
      );
    }

    const validated = productDescriptionSchema.parse(req.body);
    const client = getAIClient();
    if (!client) {
      return next(createError('عميل الذكاء الاصطناعي غير متاح', 503));
    }

    const systemInstruction = `You are a professional e-commerce copywriter.
Your task is to generate an attractive product listing from the product name, category, optional keywords, and optional product image.

Rules:
1. Language: Detect the language of the product name and keywords. If Arabic, write in Arabic. If English, write in English. Default to Arabic if unclear.
2. Style: Persuasive, benefits-focused, suitable for an online store.
3. Do not invent technical specs (exact model numbers, certifications) unless clearly implied by the input or visible in the image.
4. If an image is provided, use it only to infer visual traits (color, style, type) — do not claim details you cannot see.
5. Respond with a single JSON object only (no markdown fences). Keys must be exactly: "title", "description", "features", "cta".
6. "description" should be one marketing paragraph (about 30–55 words).
7. "features" must be an array of 3 to 5 short bullet strings (no numbering in strings).
8. "cta" is one short call-to-action line.`;

    const userText = `Product Name: ${validated.productName}
Category: ${validated.category}
Keywords/Notes: ${validated.keywords.trim() || '(none)'}

Generate the JSON now.`;

    const userContent: OpenAI.Chat.ChatCompletionContentPart[] = [
      { type: 'text', text: userText }
    ];

    if (validated.imageBase64) {
      const url = validated.imageBase64.startsWith('data:')
        ? validated.imageBase64
        : `data:image/jpeg;base64,${validated.imageBase64}`;
      userContent.push({
        type: 'image_url',
        image_url: { url }
      });
    }

    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userContent }
      ],
      temperature: 0.7,
      max_tokens: 900
    });

    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) {
      return next(createError('لم يُرجع نموذج الذكاء الاصطناعي أي محتوى', 502));
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      logger.error('Product description AI: invalid JSON', new Error(raw.slice(0, 200)));
      return next(createError('استجابة الذكاء الاصطناعي غير صالحة (JSON)', 502));
    }

    const title = String(parsed.title ?? validated.productName).slice(0, 500);
    const description = String(parsed.description ?? '').slice(0, 5000);
    let features: string[] = [];
    if (Array.isArray(parsed.features)) {
      features = parsed.features.map((f) => String(f)).filter(Boolean).slice(0, 20);
    } else if (typeof parsed.features === 'string') {
      features = [parsed.features];
    }
    const cta = String(parsed.cta ?? '').slice(0, 500);

    const data: ProductDescriptionAIResult = {
      title,
      description,
      features,
      cta
    };

    res.json({
      success: true,
      data
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return next(createError(error.errors[0]?.message || 'بيانات غير صالحة', 400));
    }
    next(error);
  }
};

const marketingImageSchema = z.object({
  prompt: z.string().min(1, 'الوصف مطلوب').max(10000),
  aspectRatio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4']).default('1:1'),
  imageSize: z.enum(['1K', '2K', '4K']).default('1K'),
  referenceImageBase64: z.string().max(20 * 1024 * 1024).optional()
});

const marketingImageHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(24)
});

let marketingImagesTableReady: Promise<void> | null = null;

function ensureMarketingImagesTable(): Promise<void> {
  if (!marketingImagesTableReady) {
    marketingImagesTableReady = pool.query(`
      CREATE TABLE IF NOT EXISTS design_studio_images (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
        prompt TEXT NOT NULL,
        revised_prompt TEXT,
        aspect_ratio VARCHAR(10) NOT NULL,
        image_size VARCHAR(10) NOT NULL,
        original_image_url TEXT,
        image_path TEXT NOT NULL,
        mime_type VARCHAR(100) NOT NULL DEFAULT 'image/png',
        file_size INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_design_studio_images_merchant_created
        ON design_studio_images(merchant_id, created_at DESC);
    `).then(() => undefined);
  }

  return marketingImagesTableReady;
}

function parseImageDataUrl(dataUrl: string): {
  buffer: Buffer;
  mimeType: string;
  extension: 'png' | 'jpg' | 'webp';
} {
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([\s\S]+)$/);
  if (!match) {
    throw createError('صيغة الصورة المتولدة غير مدعومة', 502);
  }

  const mimeType = match[1] === 'image/jpg' ? 'image/jpeg' : match[1];
  const extension = mimeType === 'image/jpeg'
    ? 'jpg'
    : mimeType === 'image/webp'
      ? 'webp'
      : 'png';
  const base64 = match[2].replace(/\s/g, '');

  return {
    buffer: Buffer.from(base64, 'base64'),
    mimeType,
    extension
  };
}

function getGeneratedImagesDir(merchantId: string): string {
  return path.join(process.cwd(), 'uploads', merchantId, 'design-studio');
}

function toMarketingImageDto(row: any) {
  return {
    id: row.id,
    prompt: row.prompt,
    revisedPrompt: row.revised_prompt,
    aspectRatio: row.aspect_ratio,
    imageSize: row.image_size,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    createdAt: row.created_at
  };
}

async function saveGeneratedMarketingImage(params: {
  merchantId: string;
  prompt: string;
  aspectRatio: '1:1' | '16:9' | '9:16' | '4:3' | '3:4';
  imageSize: '1K' | '2K' | '4K';
  originalImageUrl: string;
  imageDataUrl: string;
}) {
  await ensureMarketingImagesTable();

  const parsed = parseImageDataUrl(params.imageDataUrl);
  const targetDir = getGeneratedImagesDir(params.merchantId);
  await fs.mkdir(targetDir, { recursive: true });

  const filename = `${randomUUID()}.${parsed.extension}`;
  const filePath = path.join(targetDir, filename);
  await fs.writeFile(filePath, parsed.buffer);

  const imagePath = `/uploads/${params.merchantId}/design-studio/${filename}`;
  const result = await pool.query(
    `INSERT INTO design_studio_images (
       merchant_id, prompt, revised_prompt, aspect_ratio, image_size,
       original_image_url, image_path, mime_type, file_size
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, prompt, revised_prompt, aspect_ratio, image_size, mime_type, file_size, created_at`,
    [
      params.merchantId,
      params.prompt,
      null,
      params.aspectRatio,
      params.imageSize,
      params.originalImageUrl,
      imagePath,
      parsed.mimeType,
      parsed.buffer.length
    ]
  );

  return toMarketingImageDto(result.rows[0]);
}

async function summarizeReferenceImage(
  client: OpenAI,
  dataUrl: string
): Promise<string> {
  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Describe this reference image in 2–4 short sentences: subject, colors, lighting, composition, and art style. English only, no preamble — for an image generation prompt.'
          },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }
    ],
    max_tokens: 250
  });
  return completion.choices[0]?.message?.content?.trim() || '';
}

/**
 * ستوديو التصميم — توليد صورة تسويقية عبر Kie.ai (Nano Banana Pro).
 */
export const generateMarketingImageAI = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const validated = marketingImageSchema.parse(req.body);
    let finalPrompt = validated.prompt.trim();

    if (validated.referenceImageBase64 && isAIAvailable()) {
      const client = getAIClient();
      if (client) {
        const url = validated.referenceImageBase64.startsWith('data:')
          ? validated.referenceImageBase64
          : `data:image/jpeg;base64,${validated.referenceImageBase64}`;
        try {
          const refSummary = await summarizeReferenceImage(client, url);
          if (refSummary) {
            finalPrompt = `Visual reference (match mood, palette, and style where it fits the request): ${refSummary}\n\nUser request: ${finalPrompt}`;
          }
        } catch (e) {
          logger.warn('Reference image summarization failed, continuing with text prompt only', {
            error: (e as Error).message
          });
        }
      }
    }

    if (finalPrompt.length > 10000) {
      finalPrompt = finalPrompt.slice(0, 10000);
    }

    const result = await generateImageWithKie(
      finalPrompt,
      validated.aspectRatio,
      validated.imageSize
    );
    const savedImage = await saveGeneratedMarketingImage({
      merchantId: req.merchantId,
      prompt: validated.prompt.trim(),
      aspectRatio: validated.aspectRatio,
      imageSize: validated.imageSize,
      originalImageUrl: result.imageUrl,
      imageDataUrl: result.imageDataUrl
    });

    res.json({
      success: true,
      data: {
        imageDataUrl: result.imageDataUrl,
        revisedPrompt: undefined,
        image: savedImage
      }
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return next(createError(error.errors[0]?.message || 'بيانات غير صالحة', 400));
    }
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('Marketing image generation failed (Kie.ai)', error as Error);
    if (msg.includes('content_policy') || msg.includes('safety') || msg.includes('moderation')) {
      return next(
        createError('تم رفض الطلب بسبب سياسات المحتوى. عدّل الوصف وحاول مرة أخرى.', 400)
      );
    }
    if (msg.includes('402') || msg.includes('Insufficient Credits')) {
      return next(createError('رصيد غير كافٍ في خدمة توليد الصور. تواصل مع المسؤول.', 429));
    }
    if (msg.includes('429') || msg.includes('Rate') || msg.includes('rate_limit')) {
      return next(createError('تم تجاوز حد الطلبات — حاول لاحقاً.', 429));
    }
    if (msg.includes('All Kie.ai API keys failed')) {
      return next(createError('فشلت جميع محاولات توليد الصورة. حاول مرة أخرى لاحقاً.', 502));
    }
    next(error);
  }
};

export const getMarketingImageHistory = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.merchantId) {
      return next(createError('Unauthorized', 401));
    }

    await ensureMarketingImagesTable();
    const query = marketingImageHistoryQuerySchema.parse(req.query);
    const result = await pool.query(
      `SELECT id, prompt, revised_prompt, aspect_ratio, image_size, mime_type, file_size, created_at
       FROM design_studio_images
       WHERE merchant_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [req.merchantId, query.limit]
    );

    res.json({
      success: true,
      data: {
        images: result.rows.map(toMarketingImageDto)
      }
    });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return next(createError(error.errors[0]?.message || 'بيانات غير صالحة', 400));
    }
    next(error);
  }
};

export const getMarketingImageContent = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await ensureMarketingImagesTable();

    const result = await pool.query(
      `SELECT image_path, mime_type, created_at
       FROM design_studio_images
       WHERE id = $1 AND merchant_id = $2`,
      [id, req.merchantId]
    );

    if (result.rows.length === 0) {
      return next(createError('Image not found', 404));
    }

    const imagePath = String(result.rows[0].image_path || '');
    const relativePath = imagePath.startsWith('/') ? imagePath.slice(1) : imagePath;
    const filePath = path.resolve(process.cwd(), relativePath);
    const uploadsRoot = path.resolve(process.cwd(), 'uploads');

    if (!filePath.startsWith(uploadsRoot + path.sep)) {
      return next(createError('Invalid image path', 400));
    }

    const file = await fs.readFile(filePath);
    const mimeType = String(result.rows[0].mime_type || 'image/png');
    const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1] || 'png';
    const filename = `design-studio-${id}.${ext}`;

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', file.length);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader(
      'Content-Disposition',
      `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${filename}"`
    );

    return res.send(file);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return next(createError(error.errors[0]?.message || 'بيانات غير صالحة', 400));
    }
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return next(createError('Image file not found', 404));
    }
    next(error);
  }
};

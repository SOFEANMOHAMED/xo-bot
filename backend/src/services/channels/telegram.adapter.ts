/**
 * Telegram Channel Adapter
 * Handles Telegram webhook events and message sending
 */

import pool from '../../database/connection.js';
import { logger } from '../../utils/logger.js';
import {
  ChannelAdapter,
  ParsedIncomingEvent,
  SendMessageParams
} from './channel.interface.js';

// Extract image URL from response text
const extractImageUrl = (text: string): { imageUrl: string | null; cleanText: string } => {
  const imageRegex = /\[IMAGE:\s*([^\]]+)\]/i;
  const match = text.match(imageRegex);
  
  if (match && match[1]) {
    const imageUrl = match[1].trim();
    const cleanText = text.replace(imageRegex, '').trim();
    return { imageUrl, cleanText };
  }
  
  return { imageUrl: null, cleanText: text };
};

// Send photo via Telegram Bot API
const sendTelegramPhoto = async (
  chatId: string,
  photoUrl: string,
  caption: string,
  botToken: string
): Promise<boolean> => {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        photo: photoUrl,
        caption: caption.substring(0, 1024), // Telegram caption limit is 1024 characters
        parse_mode: 'HTML'
      })
    });

    const data = await response.json() as { ok?: boolean; error_code?: number; description?: string };
    
    if (!response.ok) {
      logger.error('Telegram API error sending photo', new Error(JSON.stringify(data)), {
        chatId,
        photoUrl
      });
      return false;
    }

    return true;
  } catch (error) {
    logger.error('Error sending Telegram photo', error as Error, { chatId, photoUrl });
    return false;
  }
};

// Send message via Telegram Bot API
const sendTelegramMessage = async (
  chatId: string,
  message: string,
  botToken: string
): Promise<boolean> => {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML'
      })
    });

    const data = await response.json() as { ok?: boolean; error_code?: number; description?: string };
    
    if (!response.ok) {
      logger.error('Telegram API error', new Error(JSON.stringify(data)), { chatId });
      return false;
    }

    return true;
  } catch (error) {
    logger.error('Error sending Telegram message', error as Error, { chatId });
    return false;
  }
};

export class TelegramAdapter implements ChannelAdapter {
  /**
   * Parse incoming Telegram webhook event
   */
  async parseIncomingEvent(rawEvent: any): Promise<ParsedIncomingEvent | null> {
    try {
      const message = rawEvent.message;
      if (!message || !message.text) {
        logger.debug('Telegram message without text or message object', {
          hasMessage: !!message,
          hasText: !!message?.text
        });
        return null;
      }

      const chatId = message.chat.id.toString();
      const userId = message.from.id.toString();
      const userName = message.from.first_name || 'Unknown User';
      const messageText = message.text;

      // Get merchant ID from event metadata (set by webhook handler)
      let merchantId: string | null = rawEvent.merchantId || null;
      const botId: string | null = rawEvent.botId || null;
      const configuredBotType: string | null = rawEvent.botType || null;

      if (!merchantId) {
        logger.error('Merchant ID not provided to Telegram adapter', new Error('Merchant ID missing'), {
          chatId,
          userId
        });
        return null;
      }

      // Get bot token
      let botToken: string | null = null;
      if (botId) {
        // New approach: Get bot token from telegram_bots table
        const botResult = await pool.query(
          `SELECT bot_token FROM telegram_bots WHERE id = $1 AND merchant_id = $2 AND is_active = true`,
          [botId, merchantId]
        );

        if (botResult.rows.length === 0) {
          logger.warn('Telegram bot not found or inactive', { merchantId, botId });
          return null;
        }

        botToken = botResult.rows[0].bot_token;
      } else {
        // Legacy approach: Get bot token from merchant_settings
        const settingsResult = await pool.query(
          `SELECT telegram_bot_token FROM merchant_settings WHERE merchant_id = $1`,
          [merchantId]
        );

        if (settingsResult.rows.length === 0 || !settingsResult.rows[0].telegram_bot_token) {
          logger.warn('Telegram bot token not found for merchant', { merchantId });
          return null;
        }

        botToken = settingsResult.rows[0].telegram_bot_token;
      }

      return {
        merchantId,
        platform: 'telegram',
        userId,
        messageText,
        externalMessageId: message.message_id?.toString(),
        userName,
        rawEventMetadata: {
          chatId,
          botId: botId || null,
          botType: configuredBotType || null,
          botToken // Store for sending messages
        }
      };
    } catch (error) {
      logger.error('Error parsing Telegram event', error as Error, { event: rawEvent });
      return null;
    }
  }

  /**
   * Send message via Telegram
   */
  async sendMessage(params: SendMessageParams): Promise<boolean> {
    try {
      const { merchantId, userId, text, metadata = {} } = params;

      // Get bot token from metadata or database
      let botToken: string | null = null;

      if (metadata.botToken) {
        botToken = metadata.botToken;
      } else if (metadata.botId) {
        // Get from telegram_bots table
        const botResult = await pool.query(
          `SELECT bot_token FROM telegram_bots WHERE id = $1 AND merchant_id = $2 AND is_active = true`,
          [metadata.botId, merchantId]
        );

        if (botResult.rows.length > 0) {
          botToken = botResult.rows[0].bot_token;
        }
      } else {
        // Legacy: Get from merchant_settings
        const settingsResult = await pool.query(
          `SELECT telegram_bot_token FROM merchant_settings WHERE merchant_id = $1`,
          [merchantId]
        );

        if (settingsResult.rows.length > 0 && settingsResult.rows[0].telegram_bot_token) {
          botToken = settingsResult.rows[0].telegram_bot_token;
        }
      }

      if (!botToken) {
        logger.error('Bot token not found for Telegram', new Error('Bot token missing'), { merchantId, userId });
        return false;
      }

      // Extract image URL if present
      const { imageUrl, cleanText } = extractImageUrl(text);

      // Check if imageUrl is valid and accessible (not localhost)
      let validImageUrl: string | null = null;
      if (imageUrl && imageUrl !== 'N/A' && imageUrl.startsWith('http')) {
        // Convert localhost URLs to public URLs
        if (imageUrl.includes('localhost') || imageUrl.includes('127.0.0.1')) {
          const backendUrl = process.env.BACKEND_URL || process.env.CORS_ORIGIN?.replace(':3000', ':3001') || '';
          if (backendUrl && backendUrl.startsWith('https://')) {
            validImageUrl = imageUrl.replace(/https?:\/\/[^\/]+/, backendUrl);
          } else {
            validImageUrl = null;
          }
        } else {
          validImageUrl = imageUrl;
        }
      }

      // Send photo with caption if image available
      if (validImageUrl && validImageUrl.startsWith('https://')) {
        const photoSent = await sendTelegramPhoto(userId, validImageUrl, cleanText || '', botToken);
        if (photoSent) {
          return true;
        }
        // If photo failed, send text message instead
      }

      // Send text message
      return await sendTelegramMessage(userId, cleanText || text, botToken);
    } catch (error) {
      logger.error('Error sending Telegram message', error as Error, {
        merchantId: params.merchantId,
        userId: params.userId
      });
      return false;
    }
  }

  /**
   * Get Telegram channel metadata
   */
  async getChannelMetadata(merchantId: string): Promise<Record<string, any>> {
    try {
      // Try new telegram_bots table first
      const botsResult = await pool.query(
        `SELECT id, bot_token, bot_name, bot_username, bot_type, is_active
         FROM telegram_bots 
         WHERE merchant_id = $1 AND is_active = true
         LIMIT 1`,
        [merchantId]
      );

      if (botsResult.rows.length > 0) {
        return {
          botId: botsResult.rows[0].id,
          botToken: botsResult.rows[0].bot_token,
          botName: botsResult.rows[0].bot_name,
          botUsername: botsResult.rows[0].bot_username,
          botType: botsResult.rows[0].bot_type,
          isActive: botsResult.rows[0].is_active
        };
      }

      // Fallback to legacy merchant_settings
      const settingsResult = await pool.query(
        `SELECT telegram_bot_token FROM merchant_settings WHERE merchant_id = $1`,
        [merchantId]
      );

      if (settingsResult.rows.length > 0 && settingsResult.rows[0].telegram_bot_token) {
        return {
          botToken: settingsResult.rows[0].telegram_bot_token
        };
      }

      return {};
    } catch (error) {
      logger.error('Error getting Telegram metadata', error as Error, { merchantId });
      return {};
    }
  }
}

// Export singleton instance
export const telegramAdapter = new TelegramAdapter();


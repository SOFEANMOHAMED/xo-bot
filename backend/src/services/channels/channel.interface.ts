/**
 * Channel Adapter Interface
 * Standard interface for all channel adapters (Facebook, Telegram, WhatsApp, etc.)
 */

export interface ParsedIncomingEvent {
  merchantId: string;
  platform: 'facebook' | 'telegram' | 'web' | 'whatsapp' | 'instagram';
  userId: string;
  messageText: string;
  externalMessageId?: string;
  userName?: string;
  /** URL of an image the customer attached (photo, sticker, etc.) */
  imageAttachmentUrl?: string;
  /** URL of a voice note / audio attachment (Messenger audio) */
  audioAttachmentUrl?: string;
  rawEventMetadata?: Record<string, any>;
}

export interface SendMessageParams {
  merchantId: string;
  userId: string;
  text: string;
  metadata?: {
    imageUrl?: string;
    orderData?: any;
    [key: string]: any;
  };
}

export interface TypingIndicatorParams {
  merchantId: string;
  userId: string;
  isTyping: boolean;
  metadata?: Record<string, any>;
}

export interface ChannelAdapter {
  /**
   * Parse incoming webhook event to standard format
   * 
   * @param rawEvent - Raw event from channel webhook
   * @returns Parsed event in standard format, or null if event should be ignored
   */
  parseIncomingEvent(rawEvent: any): Promise<ParsedIncomingEvent | null>;

  /**
   * Send message to user via channel
   * 
   * @param params - Message parameters
   * @returns true if message sent successfully, false otherwise
   */
  sendMessage(params: SendMessageParams): Promise<boolean>;

  /**
   * Toggle channel typing indicator (Messenger typing_on, Telegram chat action, etc.)
   */
  setTypingIndicator?(params: TypingIndicatorParams): Promise<void>;

  /**
   * Get channel-specific metadata for merchant
   * Used for getting access tokens, bot tokens, etc.
   * 
   * @param merchantId - Merchant ID
   * @returns Channel-specific metadata
   */
  getChannelMetadata?(merchantId: string): Promise<Record<string, any>>;
}


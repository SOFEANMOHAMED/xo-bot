# Channel Adapters

نظام Channel Adapters يجعل Controllers رقيقة (thin) وقابلة للصيانة. كل channel له adapter خاص به.

## المميزات

1. **Standardized Interface**: نفس الـ interface لجميع القنوات
2. **Separation of Concerns**: Controllers لا تعرف تفاصيل القنوات
3. **Easy to Extend**: إضافة قناة جديدة = إنشاء adapter جديد
4. **Testable**: يمكن اختبار كل adapter بشكل منفصل

## Architecture

```
Webhook → Controller → Adapter.parseIncomingEvent() → Orchestrator → Adapter.sendMessage()
```

### Flow:

1. **Webhook arrives** → Controller receives raw event
2. **Adapter.parseIncomingEvent()** → Converts to standard format
3. **Orchestrator.handleIncomingMessage()** → Processes message
4. **Adapter.sendMessage()** → Sends reply via channel

## Interface

### ChannelAdapter

```typescript
interface ChannelAdapter {
  parseIncomingEvent(rawEvent: any): Promise<ParsedIncomingEvent | null>;
  sendMessage(params: SendMessageParams): Promise<boolean>;
  getChannelMetadata?(merchantId: string): Promise<Record<string, any>>;
}
```

### ParsedIncomingEvent

```typescript
{
  merchantId: string;
  platform: 'facebook' | 'telegram' | 'web' | 'whatsapp';
  userId: string;
  messageText: string;
  externalMessageId?: string;
  userName?: string;
  rawEventMetadata?: Record<string, any>;
}
```

### SendMessageParams

```typescript
{
  merchantId: string;
  userId: string;
  text: string;
  metadata?: {
    imageUrl?: string;
    orderData?: any;
    [key: string]: any;
  };
}
```

## Adapters

### Facebook Adapter

**Location**: `/backend/src/services/channels/facebook.adapter.ts`

**Features:**
- Parses Facebook Messenger webhook events
- Handles page ID and access token lookup
- Supports image messages
- Checks `auto_reply_messenger` setting

**Usage:**
```typescript
import { facebookAdapter } from '../services/channels/facebook.adapter.js';

// Parse event
const parsed = await facebookAdapter.parseIncomingEvent(rawEvent);
if (!parsed) return; // Event ignored

// Send message
await facebookAdapter.sendMessage({
  merchantId: 'merchant-123',
  userId: 'user-456',
  text: 'Hello!',
  metadata: {
    pageId: 'page-789',
    accessToken: 'token-abc'
  }
});
```

### Telegram Adapter

**Location**: `/backend/src/services/channels/telegram.adapter.ts`

**Features:**
- Parses Telegram webhook events
- Handles bot token lookup (new telegram_bots table or legacy merchant_settings)
- Supports image messages
- Handles localhost URL conversion

**Usage:**
```typescript
import { telegramAdapter } from '../services/channels/telegram.adapter.js';

// Parse event
const parsed = await telegramAdapter.parseIncomingEvent(rawEvent);
if (!parsed) return; // Event ignored

// Send message
await telegramAdapter.sendMessage({
  merchantId: 'merchant-123',
  userId: 'user-456',
  text: 'Hello!',
  metadata: {
    botId: 'bot-789',
    botToken: 'token-abc'
  }
});
```

## Controller Refactoring

### Before (Old):

```typescript
// Facebook Controller
const processFacebookMessage = async (event: any) => {
  const pageId = event.recipient?.id;
  const senderId = event.sender?.id;
  const messageText = event.message?.text;
  
  // Find merchant by page ID
  const merchantResult = await pool.query(...);
  const { merchant_id, access_token } = merchantResult.rows[0];
  
  // Process through orchestrator
  const result = await handleIncomingMessage({...});
  
  // Send via Facebook API directly
  await sendFacebookMessage(pageId, senderId, result.replyText, access_token);
};
```

### After (New):

```typescript
// Facebook Controller
const processFacebookMessage = async (event: any) => {
  // STEP 1: Parse incoming event
  const parsedEvent = await facebookAdapter.parseIncomingEvent(event);
  if (!parsedEvent) return;
  
  // STEP 2: Check bot_disabled, etc.
  // ...
  
  // STEP 3: Process through orchestrator
  const result = await handleIncomingMessage({
    merchantId: parsedEvent.merchantId,
    platform: 'facebook',
    userId: parsedEvent.userId,
    messageText: parsedEvent.messageText,
    // ...
  });
  
  // STEP 4: Send via adapter
  await facebookAdapter.sendMessage({
    merchantId: parsedEvent.merchantId,
    userId: parsedEvent.userId,
    text: result.replyText,
    metadata: parsedEvent.rawEventMetadata
  });
};
```

## Benefits

1. **Thin Controllers**: Controllers فقط تنسق بين adapter و orchestrator
2. **Reusable Logic**: Adapter logic يمكن استخدامه في أماكن أخرى
3. **Easy Testing**: يمكن اختبار adapter بشكل منفصل
4. **Future-proof**: إضافة قناة جديدة = إنشاء adapter جديد فقط

## Adding New Channel

1. Create adapter file: `/backend/src/services/channels/newchannel.adapter.ts`
2. Implement `ChannelAdapter` interface
3. Export singleton instance
4. Add to `index.ts`
5. Update controller to use adapter

Example:
```typescript
export class WhatsAppAdapter implements ChannelAdapter {
  async parseIncomingEvent(rawEvent: any): Promise<ParsedIncomingEvent | null> {
    // Parse WhatsApp webhook event
  }
  
  async sendMessage(params: SendMessageParams): Promise<boolean> {
    // Send via WhatsApp API
  }
}

export const whatsappAdapter = new WhatsAppAdapter();
```

## Testing

```typescript
// Test adapter parsing
const parsed = await facebookAdapter.parseIncomingEvent(mockEvent);
expect(parsed?.merchantId).toBe('merchant-123');

// Test adapter sending
const sent = await facebookAdapter.sendMessage({
  merchantId: 'merchant-123',
  userId: 'user-456',
  text: 'Test message'
});
expect(sent).toBe(true);
```


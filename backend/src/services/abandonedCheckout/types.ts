import type { ConversationState } from '../../core/types.js';
import type { AbandonedCheckoutPlatform } from './constants.js';

export interface AbandonedCheckoutMeta {
  /** When checkout first became reminder-eligible (name+phone present) */
  eligible_at?: string;
  /** Claim lock to prevent double-send across workers */
  reminder_claimed_at?: string;
  /** Successful outbound reminder timestamp */
  reminder_sent_at?: string;
  reminder_count?: number;
  /** Last send failure (cleared on success) */
  last_error?: string;
}

export interface MerchantReminderSettings {
  abandoned_reminder_enabled: boolean;
  abandoned_reminder_delay_minutes: number;
  abandoned_reminder_message: string | null;
  store_name: string | null;
}

export interface EligibleAbandonedConversation {
  id: string;
  merchant_id: string;
  platform: AbandonedCheckoutPlatform;
  user_id: string;
  user_name: string | null;
  conversation_state: ConversationState;
  session_metadata: Record<string, unknown> | null;
  last_user_message_at: Date;
  settings: MerchantReminderSettings;
}

export interface ReminderCycleResult {
  scanned: number;
  sent: number;
  failed: number;
  skipped: number;
}

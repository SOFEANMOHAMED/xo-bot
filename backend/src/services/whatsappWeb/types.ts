import type { WASocket } from '@whiskeysockets/baileys';

export type WhatsAppWebStatus =
  | 'disconnected'
  | 'connecting'
  | 'qr'
  | 'connected'
  | 'logged_out';

export type WhatsAppWebPairingEvent =
  | { type: 'qr'; qrDataUrl: string }
  | {
      type: 'status';
      status: WhatsAppWebStatus;
      phoneNumber?: string | null;
      message?: string;
    }
  | { type: 'error'; message: string };

export interface WhatsAppWebSessionRow {
  merchant_id: string;
  phone_number: string | null;
  phone_digits: string | null;
  status: WhatsAppWebStatus;
  creds_ciphertext: string | null;
  keys_ciphertext: string | null;
  auto_reply_enabled: boolean;
  welcome_message: string | null;
  last_connected_at: Date | null;
  last_disconnect_at: Date | null;
  last_disconnect_reason: string | null;
}

export interface MerchantWaRuntime {
  merchantId: string;
  generation: number;
  sock: WASocket | null;
  status: WhatsAppWebStatus;
  qrDataUrl: string | null;
  phoneNumber: string | null;
  pairingListeners: Set<(event: WhatsAppWebPairingEvent) => void>;
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  starting: boolean;
  /** Outbound ids emitted by this process — skip echo on messages.upsert */
  sentMessageIds: Set<string>;
}

export interface PersistedAuthBlobs {
  credsCiphertext: string;
  keysCiphertext: string;
}

import type { WASocket } from '@whiskeysockets/baileys';

export type PlatformWaStatus =
  | 'disconnected'
  | 'connecting'
  | 'qr'
  | 'connected'
  | 'logged_out';

export type PlatformWaPairingEvent =
  | { type: 'qr'; qrDataUrl: string }
  | {
      type: 'status';
      status: PlatformWaStatus;
      phoneNumber?: string | null;
      message?: string;
    }
  | { type: 'error'; message: string };

export interface PlatformWaRuntime {
  generation: number;
  sock: WASocket | null;
  status: PlatformWaStatus;
  qrDataUrl: string | null;
  phoneNumber: string | null;
  pairingListeners: Set<(event: PlatformWaPairingEvent) => void>;
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  starting: boolean;
}

import type { AuthenticationCreds, AuthenticationState, SignalDataTypeMap } from '@whiskeysockets/baileys';
import { BufferJSON, initAuthCreds } from '@whiskeysockets/baileys';
import { logger } from '../../utils/logger.js';
import { decryptSessionBlob, encryptSessionBlob } from '../whatsappWeb/crypto.js';
import {
  getPlatformWhatsAppSession,
  savePlatformEncryptedAuthState,
  upsertPlatformWhatsAppSession
} from './sessionStore.js';

type KeyStore = Record<string, Record<string, unknown>>;

function serialize(value: unknown): string {
  return JSON.stringify(value, BufferJSON.replacer);
}

function deserialize<T>(raw: string): T {
  return JSON.parse(raw, BufferJSON.reviver) as T;
}

export async function createPlatformPostgresAuthState(): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  await upsertPlatformWhatsAppSession();
  const row = await getPlatformWhatsAppSession();

  let creds: AuthenticationCreds = initAuthCreds();
  let keys: KeyStore = {};

  if (row?.creds_ciphertext && row?.keys_ciphertext) {
    try {
      creds = deserialize<AuthenticationCreds>(decryptSessionBlob(row.creds_ciphertext));
      keys = deserialize<KeyStore>(decryptSessionBlob(row.keys_ciphertext));
    } catch (error) {
      logger.error('Failed to decrypt platform WhatsApp session — fresh pairing', error as Error);
      creds = initAuthCreds();
      keys = {};
    }
  }

  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let persistChain: Promise<void> = Promise.resolve();

  const persistNow = async () => {
    const credsCiphertext = encryptSessionBlob(serialize(creds));
    const keysCiphertext = encryptSessionBlob(serialize(keys));
    await savePlatformEncryptedAuthState(credsCiphertext, keysCiphertext);
  };

  const schedulePersist = () => {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persistChain = persistChain.then(persistNow).catch((error) => {
        logger.error('Failed to persist platform WhatsApp auth state', error as Error);
      });
    }, 250);
  };

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async (type, ids) => {
        const bucket = keys[type] || {};
        const result: { [id: string]: SignalDataTypeMap[typeof type] } = {};
        for (const id of ids) {
          const value = bucket[id];
          if (value !== undefined) {
            result[id] = value as SignalDataTypeMap[typeof type];
          }
        }
        return result;
      },
      set: async (data) => {
        for (const type of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
          const incoming = data[type];
          if (!incoming) continue;
          if (!keys[type]) keys[type] = {};
          for (const id of Object.keys(incoming)) {
            const value = incoming[id];
            if (value == null) {
              delete keys[type][id];
            } else {
              keys[type][id] = value;
            }
          }
        }
        schedulePersist();
      },
      clear: async () => {
        keys = {};
        schedulePersist();
      }
    }
  };

  const saveCreds = async () => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    persistChain = persistChain.then(persistNow);
    await persistChain;
  };

  return { state, saveCreds };
}

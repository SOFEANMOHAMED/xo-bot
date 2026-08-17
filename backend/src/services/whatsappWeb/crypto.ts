/**
 * AES-256-GCM encryption for WhatsApp Web session blobs.
 * Envelope: v1.<iv_b64url>.<tag_b64url>.<ciphertext_b64url>
 */

import crypto from 'crypto';

const VERSION = 'v1';
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;
const KDF_SALT = 'xobot-whatsapp-web-sessions-v1';

let cachedKey: Buffer | null = null;

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function fromB64url(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

function resolveKey(): Buffer {
  if (cachedKey) return cachedKey;

  const explicit = (process.env.WHATSAPP_SESSION_ENCRYPTION_KEY || '').trim();
  if (explicit) {
    const fromB64 = Buffer.from(explicit, 'base64');
    if (fromB64.length === KEY_LEN) {
      cachedKey = fromB64;
      return cachedKey;
    }
    const fromHex = Buffer.from(explicit, 'hex');
    if (fromHex.length === KEY_LEN) {
      cachedKey = fromHex;
      return cachedKey;
    }
    throw new Error(
      'WHATSAPP_SESSION_ENCRYPTION_KEY must be 32 bytes (base64 or hex)'
    );
  }

  const secret = (process.env.JWT_SECRET || '').trim();
  if (secret.length < 32) {
    throw new Error(
      'JWT_SECRET (min 32 chars) or WHATSAPP_SESSION_ENCRYPTION_KEY is required to encrypt WhatsApp sessions'
    );
  }

  cachedKey = crypto.scryptSync(secret, KDF_SALT, KEY_LEN);
  return cachedKey;
}

export function encryptSessionBlob(plaintext: string): string {
  const key = resolveKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  if (tag.length !== TAG_LEN) {
    throw new Error('Unexpected GCM tag length');
  }
  return `${VERSION}.${b64url(iv)}.${b64url(tag)}.${b64url(ciphertext)}`;
}

export function decryptSessionBlob(envelope: string): string {
  const parts = envelope.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Invalid WhatsApp session envelope');
  }
  const [, ivPart, tagPart, ctPart] = parts;
  const iv = fromB64url(ivPart);
  const tag = fromB64url(tagPart);
  const ciphertext = fromB64url(ctPart);
  if (iv.length !== IV_LEN || tag.length !== TAG_LEN) {
    throw new Error('Invalid WhatsApp session envelope lengths');
  }

  const key = resolveKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

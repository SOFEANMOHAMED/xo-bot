/**
 * Signed OAuth `state` parameter (HMAC-SHA256).
 * Prevents merchants/admins from being bound to a forged merchantId/adminId
 * via an unsigned base64 JSON blob in the OAuth redirect.
 *
 * Format: base64url(JSON payload).base64url(hmac)
 * Payload always includes `iat` (issued-at, unix seconds).
 */

import crypto from 'crypto';

const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000; // 15 minutes

function getSigningKey(): string {
  const key = (process.env.JWT_SECRET || process.env.SESSION_SECRET || '').trim();
  if (!key) {
    throw new Error('JWT_SECRET (or SESSION_SECRET) is required to sign OAuth state');
  }
  return key;
}

function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function hmacHex(payloadPart: string): string {
  return crypto.createHmac('sha256', getSigningKey()).update(payloadPart).digest('base64url');
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Sign an OAuth state payload (merchantId, purpose, etc.). Adds `iat` automatically. */
export function signOAuthState(payload: Record<string, unknown>): string {
  const body = {
    ...payload,
    iat: Math.floor(Date.now() / 1000),
  };
  const payloadPart = b64urlJson(body);
  const sig = hmacHex(payloadPart);
  return `${payloadPart}.${sig}`;
}

/**
 * Verify a signed OAuth state token.
 * Returns the decoded payload (without relying on unsigned fields) or null on failure.
 */
export function verifyOAuthState<T extends Record<string, unknown> = Record<string, unknown>>(
  token: unknown,
  maxAgeMs: number = DEFAULT_MAX_AGE_MS
): T | null {
  if (typeof token !== 'string' || !token) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadPart, sigPart] = parts;
  if (!payloadPart || !sigPart) return null;

  let expected: string;
  try {
    expected = hmacHex(payloadPart);
  } catch {
    return null;
  }
  if (!timingSafeEqualStr(sigPart, expected)) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const iat = parsed.iat;
  if (typeof iat !== 'number' || !Number.isFinite(iat)) return null;
  const ageMs = Date.now() - iat * 1000;
  if (ageMs < 0 || ageMs > maxAgeMs) return null;

  return parsed as T;
}

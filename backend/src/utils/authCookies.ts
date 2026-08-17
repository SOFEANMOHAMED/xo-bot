import { Request, Response } from 'express';
import crypto from 'crypto';

export const AUTH_COOKIE = 'xobot_token';
export const ADMIN_GATE_COOKIE = 'xobot_admin_gate';

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie || '';
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      out[key] = part.slice(idx + 1).trim();
    }
  }
  return out;
}

function cookieSecure(): boolean {
  return process.env.NODE_ENV === 'production';
}

function baseCookieOptions(maxAgeMs: number): string[] {
  const parts = [
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`
  ];
  if (cookieSecure()) parts.push('Secure');
  const domain = (process.env.COOKIE_DOMAIN || '').trim();
  if (domain) parts.push(`Domain=${domain}`);
  return parts;
}

export function setAuthCookie(res: Response, token: string): void {
  // Align with JWT_EXPIRES_IN default 7d
  const maxAge = 7 * 24 * 60 * 60 * 1000;
  res.append(
    'Set-Cookie',
    `${AUTH_COOKIE}=${encodeURIComponent(token)}; ${baseCookieOptions(maxAge).join('; ')}`
  );
}

export function clearAuthCookie(res: Response): void {
  const parts = ['Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (cookieSecure()) parts.push('Secure');
  res.append('Set-Cookie', `${AUTH_COOKIE}=; ${parts.join('; ')}`);
}

/** Signed proof that ADMIN_GATE_SECRET was unlocked in this browser (never stores the secret). */
export function createAdminGateProof(): string {
  const gate = (process.env.ADMIN_GATE_SECRET || '').trim();
  const signingKey = process.env.JWT_SECRET || process.env.SESSION_SECRET || '';
  if (!gate || !signingKey) return '';
  return crypto.createHmac('sha256', signingKey).update(`admin-gate-v1:${gate}`).digest('hex');
}

export function verifyAdminGateProof(proof: string): boolean {
  const expected = createAdminGateProof();
  if (!expected || !proof) return false;
  const a = Buffer.from(proof, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function setAdminGateCookie(res: Response): void {
  const proof = createAdminGateProof();
  if (!proof) return;
  const maxAge = 12 * 60 * 60 * 1000; // 12h
  res.append(
    'Set-Cookie',
    `${ADMIN_GATE_COOKIE}=${encodeURIComponent(proof)}; ${baseCookieOptions(maxAge).join('; ')}`
  );
}

export function clearAdminGateCookie(res: Response): void {
  const parts = ['Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (cookieSecure()) parts.push('Secure');
  res.append('Set-Cookie', `${ADMIN_GATE_COOKIE}=; ${parts.join('; ')}`);
}

export function secretsEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

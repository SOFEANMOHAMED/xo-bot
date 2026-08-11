/**
 * Deduplicate Meta OAuth callback processing for the same authorization code.
 *
 * Mobile browsers (especially after m.facebook.com) often abort the first callback
 * (nginx 499) then retry with the same code. Without dedup, the first request
 * consumes the code and the retry fails with "authorization code has been used",
 * so the user never receives the success redirect.
 */

const CODE_RESULT_TTL_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60_000;

interface CachedRedirect {
  redirectUrl: string;
  createdAt: number;
}

const resultCache = new Map<string, CachedRedirect>();
const inflight = new Map<string, Promise<string>>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of resultCache.entries()) {
    if (now - entry.createdAt > CODE_RESULT_TTL_MS) {
      resultCache.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS).unref?.();

export async function withOAuthCodeDedup(
  provider: 'facebook' | 'instagram',
  code: string,
  handler: () => Promise<string>
): Promise<string> {
  const key = `${provider}:${code}`;

  const cached = resultCache.get(key);
  if (cached && Date.now() - cached.createdAt < CODE_RESULT_TTL_MS) {
    return cached.redirectUrl;
  }

  let pending = inflight.get(key);
  if (!pending) {
    pending = handler()
      .then((redirectUrl) => {
        resultCache.set(key, { redirectUrl, createdAt: Date.now() });
        return redirectUrl;
      })
      .finally(() => {
        inflight.delete(key);
      });
    inflight.set(key, pending);
  }

  return pending;
}

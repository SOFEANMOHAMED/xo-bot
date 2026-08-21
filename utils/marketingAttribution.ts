/**
 * Persist marketing attribution (UTM / acq / fbclid) across landing → signup.
 * Client-only helper — server validates and stores first-touch on merchants.
 */

const STORAGE_KEY = 'xobot_marketing_attribution_v1';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type MarketingAttribution = {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  ad_id?: string;
  acq?: string;
  ref?: string;
  fbclid?: string;
  gclid?: string;
  landing_path?: string;
  captured_at?: string;
};

function clean(v: string | null | undefined, max = 128): string | undefined {
  if (!v) return undefined;
  const t = v.trim().slice(0, max);
  return t || undefined;
}

export function readAttributionFromSearch(search: string = window.location.search): MarketingAttribution {
  const params = new URLSearchParams(search);
  const attr: MarketingAttribution = {
    utm_source: clean(params.get('utm_source'), 64),
    utm_medium: clean(params.get('utm_medium'), 64),
    utm_campaign: clean(params.get('utm_campaign'), 128),
    utm_content: clean(params.get('utm_content'), 128),
    utm_term: clean(params.get('utm_term'), 128),
    ad_id: clean(params.get('ad_id'), 128),
    acq: clean(params.get('acq'), 32)?.toUpperCase(),
    ref: clean(params.get('ref'), 128)?.toUpperCase().replace(/[^A-Z0-9\-_]/g, ''),
    fbclid: clean(params.get('fbclid'), 256),
    gclid: clean(params.get('gclid'), 256),
    landing_path: clean(`${window.location.pathname}${window.location.search}`, 500),
    captured_at: new Date().toISOString(),
  };

  const has = Object.entries(attr).some(([k, v]) => k !== 'captured_at' && k !== 'landing_path' && !!v);
  return has ? attr : {};
}

export function loadStoredAttribution(): MarketingAttribution {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as MarketingAttribution & { captured_at?: string };
    if (parsed.captured_at) {
      const age = Date.now() - new Date(parsed.captured_at).getTime();
      if (age > MAX_AGE_MS) {
        localStorage.removeItem(STORAGE_KEY);
        return {};
      }
    }
    return parsed || {};
  } catch {
    return {};
  }
}

/** Merge URL params into stored attribution (URL wins for present keys). */
export function captureAndPersistAttribution(search?: string): MarketingAttribution {
  const fromUrl = readAttributionFromSearch(search);
  const stored = loadStoredAttribution();
  const merged: MarketingAttribution = {
    ...stored,
    ...Object.fromEntries(
      Object.entries(fromUrl).filter(([, v]) => v != null && String(v).length > 0)
    ),
    captured_at: stored.captured_at || fromUrl.captured_at || new Date().toISOString(),
    landing_path: fromUrl.landing_path || stored.landing_path,
  };

  const has = Object.entries(merged).some(
    ([k, v]) => !['captured_at', 'landing_path'].includes(k) && !!v
  );
  if (has) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch {
      /* ignore quota */
    }
  }
  return has ? merged : {};
}

export function getAttributionForApi(): MarketingAttribution | undefined {
  const a = captureAndPersistAttribution();
  const has = Object.entries(a).some(
    ([k, v]) => !['captured_at', 'landing_path'].includes(k) && !!v
  );
  return has ? a : undefined;
}

/** Build Google OAuth query string preserving ref/acq/UTMs. */
export function buildGoogleAuthQuery(): string {
  const a = getAttributionForApi() || {};
  const q = new URLSearchParams();
  if (a.ref) q.set('ref', a.ref);
  if (a.acq) q.set('acq', a.acq);
  if (a.utm_source) q.set('utm_source', a.utm_source);
  if (a.utm_medium) q.set('utm_medium', a.utm_medium);
  if (a.utm_campaign) q.set('utm_campaign', a.utm_campaign);
  if (a.utm_content) q.set('utm_content', a.utm_content);
  if (a.utm_term) q.set('utm_term', a.utm_term);
  if (a.ad_id) q.set('ad_id', a.ad_id);
  if (a.fbclid) q.set('fbclid', a.fbclid);
  if (a.gclid) q.set('gclid', a.gclid);
  if (a.landing_path) q.set('landing_path', a.landing_path);
  const s = q.toString();
  return s ? `?${s}` : '';
}

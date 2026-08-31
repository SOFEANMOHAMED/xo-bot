import type { Request } from 'express';
import geoip from 'geoip-lite';

/** ISO 3166-1 alpha-2 → dial code (aligned with frontend constants/countries.ts) */
const ISO_TO_DIAL: Record<string, string> = {
  SA: '+966',
  AE: '+971',
  KW: '+965',
  QA: '+974',
  BH: '+973',
  OM: '+968',
  JO: '+962',
  LB: '+961',
  IQ: '+964',
  EG: '+20',
  MA: '+212',
  DZ: '+213',
  TN: '+216',
  LY: '+218',
  SD: '+249',
  YE: '+967',
  SY: '+963',
  PS: '+970',
  IL: '+972',
  US: '+1',
  GB: '+44',
  FR: '+33',
  DE: '+49',
  IT: '+39',
  ES: '+34',
  TR: '+90',
  IN: '+91',
  PK: '+92',
  BD: '+880',
  CN: '+86',
  JP: '+81',
  KR: '+82',
  AU: '+61',
  CA: '+1',
  BR: '+55',
  MX: '+52',
  RU: '+7',
  ZA: '+27',
  NG: '+234',
  KE: '+254',
};

export const DEFAULT_VISITOR_DIAL_CODE = '+966';

function normalizeIso(raw: string | undefined | null): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const iso = raw.trim().toUpperCase();
  if (iso.length !== 2 || iso === 'XX' || iso === 'T1') return null;
  return iso;
}

function isoFromHeaders(req: Request): string | null {
  const candidates = [
    req.headers['cf-ipcountry'],
    req.headers['x-country-code'],
    req.headers['cloudfront-viewer-country'],
    req.headers['x-appengine-country'],
  ];
  for (const header of candidates) {
    const iso = normalizeIso(typeof header === 'string' ? header : undefined);
    if (iso) return iso;
  }
  return null;
}

function isoFromGeoIp(req: Request): string | null {
  const ip = (req.ip || '').trim();
  if (!ip) return null;
  const lookup = geoip.lookup(ip);
  return normalizeIso(lookup?.country);
}

export function dialCodeForIso(iso: string | null): string | null {
  if (!iso) return null;
  return ISO_TO_DIAL[iso] ?? null;
}

export type VisitorCountrySource = 'cf-header' | 'proxy-header' | 'geoip' | 'default';

export function resolveVisitorCountry(req: Request): {
  countryIso: string | null;
  dialCode: string;
  source: VisitorCountrySource;
} {
  const fromHeader = isoFromHeaders(req);
  if (fromHeader) {
    const dial = dialCodeForIso(fromHeader);
    if (dial) {
      return {
        countryIso: fromHeader,
        dialCode: dial,
        source: req.headers['cf-ipcountry'] ? 'cf-header' : 'proxy-header',
      };
    }
  }

  const fromGeo = isoFromGeoIp(req);
  if (fromGeo) {
    const dial = dialCodeForIso(fromGeo);
    if (dial) {
      return { countryIso: fromGeo, dialCode: dial, source: 'geoip' };
    }
  }

  return {
    countryIso: fromHeader || fromGeo || null,
    dialCode: DEFAULT_VISITOR_DIAL_CODE,
    source: 'default',
  };
}

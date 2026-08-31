import { Request, Response, NextFunction } from 'express';
import { resolveVisitorCountry } from '../utils/visitorCountry.js';

/**
 * GET /api/geo/visitor-country
 * Public: infer dial code from visitor IP (Cloudflare/proxy headers or geoip-lite).
 * Does not expose raw IP.
 */
export const getVisitorCountry = (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = resolveVisitorCountry(req);
    res.json({
      success: true,
      data: {
        countryIso: result.countryIso,
        dialCode: result.dialCode,
        source: result.source,
      },
    });
  } catch (error) {
    next(error);
  }
};

import { useEffect, useState } from 'react';
import { apiService } from '../services/api';
import { logger } from '../utils/logger';

export type FooterCmsLink = { slug: string; title: string };

/**
 * Loads published CMS pages for the marketing footer (excludes slugs linked statically: privacy-policy, terms-of-service).
 */
export function usePublishedFooterPages(): FooterCmsLink[] {
  const [pages, setPages] = useState<FooterCmsLink[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await apiService.getPublishedPagesForFooter();
        if (!cancelled && Array.isArray(list)) {
          setPages(list.filter((p) => p?.slug && p?.title));
        }
      } catch (e) {
        logger.error('Failed to load footer CMS pages', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return pages;
}

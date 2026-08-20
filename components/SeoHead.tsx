import { useEffect } from 'react';
import type { FC } from 'react';
import {
  SEO_DEFAULTS,
  absoluteUrl,
  formatPageTitle,
} from '../utils/seo';

export interface SeoHeadProps {
  title: string;
  description?: string;
  /** Path only, e.g. `/storify` */
  canonicalPath?: string;
  ogImagePath?: string;
  ogType?: 'website' | 'article';
  noindex?: boolean;
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
}

const MANAGED_SELECTOR = 'data-seo-managed';

function upsertMeta(
  attribute: 'name' | 'property',
  key: string,
  content: string
): void {
  let el = document.head.querySelector<HTMLMetaElement>(
    `meta[${attribute}="${key}"][${MANAGED_SELECTOR}]`
  );
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attribute, key);
    el.setAttribute(MANAGED_SELECTOR, 'true');
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function upsertLink(rel: string, href: string): void {
  let el = document.head.querySelector<HTMLLinkElement>(
    `link[rel="${rel}"][${MANAGED_SELECTOR}]`
  );
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    el.setAttribute(MANAGED_SELECTOR, 'true');
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

function removeManagedJsonLd(): void {
  document
    .querySelectorAll(`script[type="application/ld+json"][${MANAGED_SELECTOR}]`)
    .forEach((node) => node.remove());
}

function setManagedJsonLd(
  payload: Record<string, unknown> | Record<string, unknown>[]
): void {
  removeManagedJsonLd();
  const blocks = Array.isArray(payload) ? payload : [payload];
  blocks.forEach((block, index) => {
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.setAttribute(MANAGED_SELECTOR, 'true');
    script.id = `seo-json-ld-${index}`;
    script.textContent = JSON.stringify(block);
    document.head.appendChild(script);
  });
}

function removeManagedHeadTags(): void {
  document
    .querySelectorAll(`[${MANAGED_SELECTOR}]`)
    .forEach((node) => node.remove());
}

/**
 * Updates document title and SEO meta tags for the current SPA route.
 * Restores defaults on unmount.
 */
const SeoHead: FC<SeoHeadProps> = ({
  title,
  description = SEO_DEFAULTS.description,
  canonicalPath,
  ogImagePath = SEO_DEFAULTS.ogImagePath,
  ogType = 'website',
  noindex = false,
  jsonLd,
}) => {
  useEffect(() => {
    const formattedTitle = formatPageTitle(title);
    const canonicalUrl = canonicalPath
      ? absoluteUrl(canonicalPath)
      : absoluteUrl(typeof window !== 'undefined' ? window.location.pathname : '/');
    const ogImage = absoluteUrl(ogImagePath);
    const robots = noindex ? 'noindex, nofollow' : 'index, follow';

    document.title = formattedTitle;
    upsertMeta('name', 'description', description);
    upsertMeta('name', 'robots', robots);
    upsertLink('canonical', canonicalUrl);

    upsertMeta('property', 'og:title', formattedTitle);
    upsertMeta('property', 'og:description', description);
    upsertMeta('property', 'og:url', canonicalUrl);
    upsertMeta('property', 'og:image', ogImage);
    upsertMeta('property', 'og:type', ogType);
    upsertMeta('property', 'og:locale', SEO_DEFAULTS.locale);
    upsertMeta('property', 'og:site_name', SEO_DEFAULTS.siteName);

    upsertMeta('name', 'twitter:card', 'summary_large_image');
    upsertMeta('name', 'twitter:title', formattedTitle);
    upsertMeta('name', 'twitter:description', description);
    upsertMeta('name', 'twitter:image', ogImage);

    if (jsonLd) {
      setManagedJsonLd(jsonLd);
    } else {
      removeManagedJsonLd();
    }

    return () => {
      document.title = SEO_DEFAULTS.title;
      removeManagedHeadTags();
      removeManagedJsonLd();

      const desc = document.querySelector<HTMLMetaElement>('meta[name="description"]');
      if (desc) desc.setAttribute('content', SEO_DEFAULTS.description);
    };
  }, [title, description, canonicalPath, ogImagePath, ogType, noindex, jsonLd]);

  return null;
};

export default SeoHead;

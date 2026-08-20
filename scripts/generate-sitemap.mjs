/**
 * Generates public/sitemap.xml before production build.
 * Tries the live backend API first; falls back to static marketing routes.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const outPath = path.join(rootDir, 'public', 'sitemap.xml');

const siteOrigin = (process.env.VITE_SITE_URL || 'https://xo-bot.com').replace(/\/+$/, '');
const apiBase = (process.env.SITEMAP_API_URL || process.env.VITE_API_URL || 'http://127.0.0.1:3001/api')
  .replace(/\/+$/, '');

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildStaticSitemap() {
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: `${siteOrigin}/`, changefreq: 'weekly', priority: '1.0' },
    { loc: `${siteOrigin}/about`, changefreq: 'monthly', priority: '0.9' },
    { loc: `${siteOrigin}/whatsapp-bot`, changefreq: 'monthly', priority: '0.85' },
    { loc: `${siteOrigin}/storify`, changefreq: 'monthly', priority: '0.8' },
    { loc: `${siteOrigin}/privacy-policy`, changefreq: 'monthly', priority: '0.6' },
    { loc: `${siteOrigin}/terms-of-service`, changefreq: 'monthly', priority: '0.6' },
  ];

  const entries = urls
    .map(
      (u) => `
  <url>
    <loc>${escapeXml(u.loc)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries}
</urlset>`;
}

async function fetchFromApi() {
  const url = `${apiBase}/pages/sitemap.xml`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    throw new Error(`API returned ${res.status}`);
  }
  const xml = await res.text();
  if (!xml.includes('<urlset')) {
    throw new Error('Invalid sitemap XML from API');
  }
  return xml;
}

async function main() {
  let xml;
  try {
    xml = await fetchFromApi();
    console.log('[sitemap] Generated from API:', `${apiBase}/pages/sitemap.xml`);
  } catch (error) {
    console.warn('[sitemap] API unavailable, using static fallback:', error?.message || error);
    xml = buildStaticSitemap();
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, xml, 'utf8');
  console.log('[sitemap] Wrote', outPath);
}

main().catch((error) => {
  console.error('[sitemap] Fatal error:', error);
  process.exit(1);
});

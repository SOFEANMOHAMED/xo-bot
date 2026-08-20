/**
 * Pre-renders public marketing routes to static HTML after vite build.
 * Requires puppeteer (optional — build continues if unavailable).
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const previewPort = Number(process.env.PRERENDER_PORT || 4173);
const baseUrl = `http://127.0.0.1:${previewPort}`;

const STATIC_ROUTES = ['/', '/about', '/storify', '/whatsapp-bot'];

function parseSitemapRoutes() {
  const sitemapPath = path.join(rootDir, 'public', 'sitemap.xml');
  if (!fs.existsSync(sitemapPath)) return [];
  const xml = fs.readFileSync(sitemapPath, 'utf8');
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => {
      try {
        return new URL(match[1]).pathname;
      } catch {
        return null;
      }
    })
    .filter((pathname) => Boolean(pathname))
    .filter((pathname) => !STATIC_ROUTES.includes(pathname));
}

async function waitForServer(url, maxAttempts = 40) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
    } catch {
      // preview still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Vite preview server did not become ready');
}

function startPreview() {
  return spawn(
    'npx',
    ['vite', 'preview', '--port', String(previewPort), '--host', '127.0.0.1'],
    { cwd: rootDir, stdio: 'pipe', shell: false }
  );
}

function routeToOutputFile(route) {
  if (route === '/') return path.join(distDir, 'index.html');
  const segment = route.replace(/^\//, '').replace(/\/$/, '');
  return path.join(distDir, segment, 'index.html');
}

async function main() {
  if (!fs.existsSync(distDir)) {
    console.warn('[prerender] dist/ missing — run vite build first');
    return;
  }

  let puppeteerModule;
  try {
    puppeteerModule = await import('puppeteer');
  } catch {
    console.warn('[prerender] puppeteer not installed — skipping static HTML prerender');
    return;
  }

  const routes = [...new Set([...STATIC_ROUTES, ...parseSitemapRoutes()])];
  const preview = startPreview();

  try {
    await waitForServer(baseUrl);
    const browser = await puppeteerModule.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800 });

      for (const route of routes) {
        const url = `${baseUrl}${route}`;
        console.log('[prerender]', route);
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 90000 });
        await page.waitForSelector('h1', { timeout: 20000 }).catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, 400));

        const html = await page.content();
        const outputFile = routeToOutputFile(route);
        fs.mkdirSync(path.dirname(outputFile), { recursive: true });
        fs.writeFileSync(outputFile, html, 'utf8');
      }
    } finally {
      await browser.close();
    }

    console.log(`[prerender] Wrote ${routes.length} routes to dist/`);
  } finally {
    preview.kill('SIGTERM');
  }
}

main().catch((error) => {
  console.warn('[prerender] Skipped:', error?.message || error);
});

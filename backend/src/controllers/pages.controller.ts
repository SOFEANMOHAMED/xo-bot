import { Request, Response, NextFunction } from 'express';
import pool from '../database/connection.js';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';

const SITE_ORIGIN = (process.env.FRONTEND_URL || 'https://xo-bot.com').replace(/\/+$/, '');

/** Marketing routes always included in sitemap (path → optional fixed lastmod ISO date). */
const STATIC_SITEMAP_PATHS: Array<{ path: string; changefreq: string; priority: string }> = [
  { path: '/', changefreq: 'weekly', priority: '1.0' },
  { path: '/about', changefreq: 'monthly', priority: '0.9' },
  { path: '/whatsapp-bot', changefreq: 'monthly', priority: '0.85' },
  { path: '/storify', changefreq: 'monthly', priority: '0.8' },
];

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatSitemapDate(value: Date | string | null | undefined): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

const STATIC_SITEMAP_SLUGS = new Set([
  ...STATIC_SITEMAP_PATHS.map((entry) => entry.path.replace(/^\//, '')).filter(Boolean),
  'about',
  'whatsapp-bot',
]);

/** Slugs not listed in dynamic footer: static legal links + removed / optional topics. */
const FOOTER_EXCLUDED_SLUGS = new Set([
  'privacy-policy',
  'terms-of-service',
  'return-policy',
  'refund-policy',
  'returns-policy',
  'exchange-policy'
]);

// Public: XML sitemap for search engines
export const getSitemap = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const result = await pool.query<{ slug: string; updated_at: Date }>(
      `SELECT slug, updated_at FROM pages
       WHERE is_published = TRUE
       ORDER BY updated_at DESC`
    );

    const urlEntries: string[] = [];

    for (const entry of STATIC_SITEMAP_PATHS) {
      urlEntries.push(`
  <url>
    <loc>${escapeXml(`${SITE_ORIGIN}${entry.path}`)}</loc>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`);
    }

    for (const row of result.rows) {
      if (STATIC_SITEMAP_SLUGS.has(row.slug)) continue;
      urlEntries.push(`
  <url>
    <loc>${escapeXml(`${SITE_ORIGIN}/${row.slug}`)}</loc>
    <lastmod>${formatSitemapDate(row.updated_at)}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`);
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urlEntries.join('')}
</urlset>`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(xml);
  } catch (error: any) {
    console.error('Error generating sitemap:', error);
    next(error);
  }
};

// Public: published pages for site footer (slug + title only)
export const listPublishedPagesForFooter = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const result = await pool.query<{ slug: string; title: string }>(
      `SELECT slug, title FROM pages
       WHERE is_published = TRUE
       ORDER BY title ASC`
    );

    const data = result.rows.filter((row) => !FOOTER_EXCLUDED_SLUGS.has(row.slug));

    res.setHeader('Cache-Control', 'public, max-age=120');
    res.json({
      success: true,
      data
    });
  } catch (error: any) {
    console.error('Error listing published pages for footer:', error);
    next(error);
  }
};

// Get all pages (admin only)
export const getAdminPages = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const result = await pool.query(
      `SELECT id, slug, title, meta_description, is_published, created_at, updated_at
       FROM pages
       ORDER BY created_at DESC`
    );

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error: any) {
    console.error('Error fetching pages:', error);
    next(error);
  }
};

// Get single page by slug (public)
export const getPageBySlug = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { slug } = req.params;

    const result = await pool.query(
      `SELECT id, slug, title, content, meta_description, is_published, updated_at
       FROM pages
       WHERE slug = $1 AND is_published = TRUE`,
      [slug]
    );

    if (result.rows.length === 0) {
      return next(createError('Page not found', 404));
    }

    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error: any) {
    console.error('Error fetching page:', error);
    next(error);
  }
};

// Get single page by ID (admin)
export const getAdminPage = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT * FROM pages WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return next(createError('Page not found', 404));
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error: any) {
    console.error('Error fetching page:', error);
    next(error);
  }
};

// Create new page
export const createPage = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { slug, title, content, meta_description, is_published } = req.body;

    if (!slug || !title || !content) {
      return next(createError('Slug, title, and content are required', 400));
    }

    // Check if slug already exists
    const existingPage = await pool.query(
      `SELECT id FROM pages WHERE slug = $1`,
      [slug]
    );

    if (existingPage.rows.length > 0) {
      return next(createError('Page with this slug already exists', 400));
    }

    const result = await pool.query(
      `INSERT INTO pages (slug, title, content, meta_description, is_published)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [slug, title, content, meta_description || null, is_published !== false]
    );

    res.status(201).json({
      success: true,
      message: 'Page created successfully',
      data: result.rows[0]
    });
  } catch (error: any) {
    console.error('Error creating page:', error);
    next(error);
  }
};

// Update page
export const updatePage = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const { slug, title, content, meta_description, is_published } = req.body;

    // Check if page exists
    const existingPage = await pool.query(
      `SELECT id FROM pages WHERE id = $1`,
      [id]
    );

    if (existingPage.rows.length === 0) {
      return next(createError('Page not found', 404));
    }

    // Check if slug is being changed and if new slug already exists
    if (slug) {
      const slugCheck = await pool.query(
        `SELECT id FROM pages WHERE slug = $1 AND id != $2`,
        [slug, id]
      );

      if (slugCheck.rows.length > 0) {
        return next(createError('Page with this slug already exists', 400));
      }
    }

    const result = await pool.query(
      `UPDATE pages
       SET slug = COALESCE($1, slug),
           title = COALESCE($2, title),
           content = COALESCE($3, content),
           meta_description = COALESCE($4, meta_description),
           is_published = COALESCE($5, is_published),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING *`,
      [slug, title, content, meta_description, is_published, id]
    );

    res.json({
      success: true,
      message: 'Page updated successfully',
      data: result.rows[0]
    });
  } catch (error: any) {
    console.error('Error updating page:', error);
    next(error);
  }
};

// Delete page
export const deletePage = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM pages WHERE id = $1 RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return next(createError('Page not found', 404));
    }

    res.json({
      success: true,
      message: 'Page deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting page:', error);
    next(error);
  }
};


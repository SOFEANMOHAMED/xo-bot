import { Response, NextFunction, Request } from 'express';
import pool from '../database/connection.js';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { invalidateProductKeywords } from '../services/cacheService.js';
import { clearProductKeywordsCache } from '../services/tools/catalogTool.js';
import { clearProductCache } from '../catalog/product-search.js';
import { resolveImageSrcForServing } from '../catalog/resolve-product-image.js';
import { scheduleProductImageReindex } from '../catalog/visual-embeddings.js';

const MAX_PRODUCT_IMAGES = 10;

/** Accept absolute http(s) URLs used by uploads / CDN */
const imageUrlSchema = z
  .string()
  .refine(
    (v) => !v || v.startsWith('http://') || v.startsWith('https://') || v.startsWith('data:image/'),
    { message: 'Invalid image URL' }
  );

const productSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.number().positive(),
  currency: z.string().default('USD'),
  category: z.string().optional(),
  stock: z.number().int().min(0).default(0),
  sizes: z.array(z.string()).optional(),
  colors: z.array(z.string()).optional(),
  imageUrl: imageUrlSchema.optional(),
  /** Extra / gallery images (first becomes primary / image_url when provided) */
  images: z.array(imageUrlSchema).max(MAX_PRODUCT_IMAGES).optional(),
  /** Per-image color link (parallel to images); empty string = unassigned */
  imageColors: z.array(z.string().max(100).nullable()).max(MAX_PRODUCT_IMAGES).optional(),
  source: z.enum(['manual', 'shopify', 'excel']).default('manual'),
  externalId: z.string().optional()
});

type ProductRow = {
  id: string;
  external_id: string | null;
  name: string;
  description: string | null;
  price: string | number;
  currency: string;
  category: string | null;
  stock: number;
  sizes: string[] | null;
  colors: string[] | null;
  image_url: string | null;
  source: string;
  created_at: Date;
  updated_at: Date;
};

const mapProductRow = (
  row: ProductRow,
  gallery: Array<{ src: string; color: string | null }> = []
) => {
  const imageUrl = row.image_url;
  const images =
    gallery.length > 0
      ? gallery.map((g) => g.src)
      : imageUrl
        ? [imageUrl]
        : [];
  const imageColors =
    gallery.length > 0
      ? gallery.map((g) => g.color)
      : images.map(() => null);
  return {
    id: row.id,
    externalId: row.external_id,
    name: row.name,
    description: row.description,
    price: parseFloat(String(row.price)),
    currency: row.currency,
    category: row.category,
    stock: row.stock,
    sizes: row.sizes || [],
    colors: row.colors || [],
    imageUrl,
    images,
    imageColors,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
};

/** Load gallery URLs + color (alt) for many products (merchant-scoped). */
const fetchProductImagesMap = async (
  merchantId: string,
  productIds: string[]
): Promise<Map<string, Array<{ src: string; color: string | null }>>> => {
  const map = new Map<string, Array<{ src: string; color: string | null }>>();
  if (productIds.length === 0) return map;

  const result = await pool.query(
    `SELECT product_id, src, alt
     FROM product_images
     WHERE merchant_id = $1 AND product_id = ANY($2::uuid[])
     ORDER BY position ASC, created_at ASC`,
    [merchantId, productIds]
  );

  for (const row of result.rows) {
    const list = map.get(row.product_id) || [];
    list.push({
      src: row.src,
      color: row.alt && String(row.alt).trim() ? String(row.alt).trim() : null
    });
    map.set(row.product_id, list);
  }
  return map;
};

/**
 * Replace gallery for a product. Always scoped by merchant_id (SaaS isolation).
 * Prefer explicit per-image colors (imageColors); else fall back to product colors by index.
 */
const replaceProductImages = async (
  productId: string,
  merchantId: string,
  imageUrls: string[],
  imageColors?: (string | null)[] | null,
  fallbackColors?: string[] | null
): Promise<void> => {
  const pairs: Array<{ src: string; color: string | null }> = [];
  const seen = new Set<string>();

  for (let i = 0; i < imageUrls.length; i++) {
    const src = (imageUrls[i] || '').trim();
    if (!src || seen.has(src)) continue;
    seen.add(src);
    const explicit = imageColors?.[i]?.trim() || null;
    const fallback = fallbackColors?.[pairs.length]?.trim() || null;
    pairs.push({ src, color: explicit || fallback || null });
    if (pairs.length >= MAX_PRODUCT_IMAGES) break;
  }

  await pool.query(
    'DELETE FROM product_images WHERE product_id = $1 AND merchant_id = $2',
    [productId, merchantId]
  );

  for (let i = 0; i < pairs.length; i++) {
    await pool.query(
      `INSERT INTO product_images (
        product_id, merchant_id, src, alt, position, is_primary
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [productId, merchantId, pairs[i].src, pairs[i].color, i, i === 0]
    );
  }
};

/** Resolve final image list + primary URL from request body */
const resolveImagesPayload = (
  imageUrl?: string,
  images?: string[]
): { primary: string | null; gallery: string[] } => {
  if (images && images.length > 0) {
    const gallery = [...new Set(images.map((u) => u.trim()).filter(Boolean))].slice(
      0,
      MAX_PRODUCT_IMAGES
    );
    return { primary: gallery[0] || null, gallery };
  }
  if (imageUrl && imageUrl.trim()) {
    return { primary: imageUrl.trim(), gallery: [imageUrl.trim()] };
  }
  return { primary: null, gallery: [] };
};

export const getProducts = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const result = await pool.query(
      `SELECT id, external_id, name, description, price, currency, category, 
              stock, sizes, colors, image_url, source, created_at, updated_at
       FROM products 
       WHERE merchant_id = $1 
       ORDER BY created_at DESC`,
      [req.merchantId]
    );

    const ids = result.rows.map((r: ProductRow) => r.id);
    const imagesMap = await fetchProductImagesMap(req.merchantId!, ids);

    const products = result.rows.map((row: ProductRow) =>
      mapProductRow(row, imagesMap.get(row.id) || [])
    );

    res.json({
      success: true,
      data: { products }
    });
  } catch (error) {
    next(error);
  }
};

export const getProduct = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT id, external_id, name, description, price, currency, category, 
              stock, sizes, colors, image_url, source, created_at, updated_at
       FROM products 
       WHERE id = $1 AND merchant_id = $2`,
      [id, req.merchantId]
    );

    if (result.rows.length === 0) {
      return next(createError('Product not found', 404));
    }

    const imagesMap = await fetchProductImagesMap(req.merchantId!, [id]);
    const product = mapProductRow(result.rows[0], imagesMap.get(id) || []);

    res.json({
      success: true,
      data: { product }
    });
  } catch (error) {
    next(error);
  }
};

export const createProduct = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const validated = productSchema.parse(req.body);
    const { primary, gallery } = resolveImagesPayload(validated.imageUrl, validated.images);

    const result = await pool.query(
      `INSERT INTO products (
        merchant_id, external_id, name, description, price, currency, 
        category, stock, sizes, colors, image_url, source
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id, external_id, name, description, price, currency, 
                category, stock, sizes, colors, image_url, source, created_at, updated_at`,
      [
        req.merchantId,
        validated.externalId || null,
        validated.name,
        validated.description || null,
        validated.price,
        validated.currency,
        validated.category || null,
        validated.stock,
        validated.sizes || [],
        validated.colors || [],
        primary,
        validated.source
      ]
    );

    const row = result.rows[0] as ProductRow;
    if (gallery.length > 0) {
      await replaceProductImages(
        row.id,
        req.merchantId!,
        gallery,
        validated.imageColors || null,
        validated.colors || []
      );
    }

    const imagesMap = await fetchProductImagesMap(req.merchantId!, [row.id]);
    const product = mapProductRow(row, imagesMap.get(row.id) || gallery.map((src, i) => ({
      src,
      color: validated.imageColors?.[i]?.trim() || validated.colors?.[i] || null
    })));

    invalidateProductKeywords(req.merchantId!);
    clearProductKeywordsCache(req.merchantId!);
    clearProductCache(req.merchantId!);
    scheduleProductImageReindex(req.merchantId!, row.id);

    res.status(201).json({
      success: true,
      data: { product }
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return next(createError(error.errors[0].message, 400));
    }
    next(error);
  }
};

export const updateProduct = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const validated = productSchema.partial().parse(req.body);

    // Check if product exists and belongs to merchant
    const checkResult = await pool.query(
      'SELECT id FROM products WHERE id = $1 AND merchant_id = $2',
      [id, req.merchantId]
    );

    if (checkResult.rows.length === 0) {
      return next(createError('Product not found', 404));
    }

    const hasImagesUpdate =
      validated.images !== undefined ||
      validated.imageUrl !== undefined ||
      validated.imageColors !== undefined;
    let galleryForResponse: Array<{ src: string; color: string | null }> | undefined;

    if (validated.images !== undefined || validated.imageUrl !== undefined) {
      const { primary, gallery } = resolveImagesPayload(
        validated.imageUrl,
        validated.images
      );
      let colorsForAlt = validated.colors;
      if (colorsForAlt === undefined) {
        const colorsRow = await pool.query(
          'SELECT colors FROM products WHERE id = $1 AND merchant_id = $2',
          [id, req.merchantId]
        );
        colorsForAlt = colorsRow.rows[0]?.colors || [];
      }
      await replaceProductImages(
        id,
        req.merchantId!,
        gallery,
        validated.imageColors || null,
        colorsForAlt || []
      );
      galleryForResponse = gallery.map((src, i) => ({
        src,
        color: validated.imageColors?.[i]?.trim() || colorsForAlt?.[i] || null
      }));
      // Keep image_url in sync with primary
      (validated as { imageUrl?: string | null }).imageUrl = primary || '';
    } else if (validated.imageColors !== undefined || validated.colors !== undefined) {
      // Update color links without replacing image binaries
      const imagesMap = await fetchProductImagesMap(req.merchantId!, [id]);
      const existingGallery = imagesMap.get(id) || [];
      if (existingGallery.length > 0) {
        const urls = existingGallery.map((g) => g.src);
        const explicitColors =
          validated.imageColors !== undefined
            ? validated.imageColors
            : existingGallery.map((g) => g.color);
        await replaceProductImages(
          id,
          req.merchantId!,
          urls,
          explicitColors,
          validated.colors || null
        );
        const refreshed = await fetchProductImagesMap(req.merchantId!, [id]);
        galleryForResponse = refreshed.get(id) || [];
      }
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (validated.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(validated.name);
    }
    if (validated.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(validated.description);
    }
    if (validated.price !== undefined) {
      updates.push(`price = $${paramIndex++}`);
      values.push(validated.price);
    }
    if (validated.currency !== undefined) {
      updates.push(`currency = $${paramIndex++}`);
      values.push(validated.currency);
    }
    if (validated.category !== undefined) {
      updates.push(`category = $${paramIndex++}`);
      values.push(validated.category);
    }
    if (validated.stock !== undefined) {
      updates.push(`stock = $${paramIndex++}`);
      values.push(validated.stock);
    }
    if (validated.sizes !== undefined) {
      updates.push(`sizes = $${paramIndex++}`);
      values.push(validated.sizes);
    }
    if (validated.colors !== undefined) {
      updates.push(`colors = $${paramIndex++}`);
      values.push(validated.colors);
    }
    if (validated.imageUrl !== undefined) {
      updates.push(`image_url = $${paramIndex++}`);
      values.push(validated.imageUrl || null);
    }
    if (validated.source !== undefined) {
      updates.push(`source = $${paramIndex++}`);
      values.push(validated.source);
    }

    if (updates.length === 0 && !hasImagesUpdate) {
      return next(createError('No fields to update', 400));
    }

    let row: ProductRow;
    if (updates.length > 0) {
      updates.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(id, req.merchantId);

      const result = await pool.query(
        `UPDATE products 
         SET ${updates.join(', ')}
         WHERE id = $${paramIndex++} AND merchant_id = $${paramIndex}
         RETURNING id, external_id, name, description, price, currency, 
                   category, stock, sizes, colors, image_url, source, created_at, updated_at`,
        values
      );
      row = result.rows[0];
    } else {
      const result = await pool.query(
        `SELECT id, external_id, name, description, price, currency, category, 
                stock, sizes, colors, image_url, source, created_at, updated_at
         FROM products WHERE id = $1 AND merchant_id = $2`,
        [id, req.merchantId]
      );
      row = result.rows[0];
    }

    if (galleryForResponse === undefined) {
      const imagesMap = await fetchProductImagesMap(req.merchantId!, [id]);
      galleryForResponse = imagesMap.get(id) || [];
    }

    const product = mapProductRow(row, galleryForResponse);

    invalidateProductKeywords(req.merchantId!);
    clearProductKeywordsCache(req.merchantId!);
    clearProductCache(req.merchantId!);
    if (hasImagesUpdate || validated.imageUrl !== undefined) {
      scheduleProductImageReindex(req.merchantId!, id);
    }

    res.json({
      success: true,
      data: { product }
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return next(createError(error.errors[0].message, 400));
    }
    next(error);
  }
};

// Get product image (handles both base64 and HTTP URLs)
// Public endpoint — supports ?img=<galleryUuid>&color=<name> for color-aware bot delivery
export const getProductImage = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { productId } = req.params;
    const imageId =
      typeof req.query.img === 'string' && req.query.img.trim()
        ? req.query.img.trim()
        : null;
    const colorQuery =
      typeof req.query.color === 'string' && req.query.color.trim()
        ? req.query.color.trim()
        : null;

    // Get product image from database (merchant-scoped via product row)
    const result = await pool.query(
      `SELECT image_url, merchant_id, colors
       FROM products 
       WHERE id = $1`,
      [productId]
    );

    if (result.rows.length === 0) {
      return next(createError('Product not found', 404));
    }

    const product = result.rows[0];
    const merchantId = product.merchant_id as string;

    const imageUrl = await resolveImageSrcForServing({
      merchantId,
      productId,
      primaryImageUrl: product.image_url || null,
      imageId,
      color: colorQuery,
      colors: product.colors || null
    });

    if (!imageUrl) {
      return next(createError('Image not found', 404));
    }

    // Set CORS headers for all responses
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    // If it's a base64 image, convert it to a data URL response
    if (imageUrl.startsWith('data:image/')) {
      const match = imageUrl.match(/data:image\/([^;]+);base64,(.+)/);
      if (match && match[2]) {
        const mimeType = match[1];
        const base64Data = match[2];
        const imageBuffer = Buffer.from(base64Data, 'base64');

        res.setHeader('Content-Type', `image/${mimeType}`);
        res.setHeader('Content-Length', imageBuffer.length);
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        return res.send(imageBuffer);
      }
    }

    // Local disk path from upload API (e.g. /uploads/product-image-123.jpg or /uploads/{merchantId}/image.webp)
    const pathMod = await import('path');
    const fsMod = await import('fs');
    const trimmed = imageUrl.trim();
    if (trimmed.startsWith('/uploads/') || trimmed.startsWith('uploads/')) {
      const relative = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
      const localPath = pathMod.default.join(process.cwd(), relative);
      if (fsMod.existsSync(localPath) && fsMod.statSync(localPath).isFile()) {
        const ext = pathMod.default.extname(localPath).toLowerCase();
        const mimeTypes: Record<string, string> = {
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.gif': 'image/gif',
          '.webp': 'image/webp',
          '.svg': 'image/svg+xml'
        };
        res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        return res.sendFile(pathMod.default.resolve(localPath));
      }

      // ✅ Backward compat: if path is /uploads/filename (no merchantId), also check /uploads/{merchantId}/filename
      if (merchantId) {
        const filename = pathMod.default.basename(relative);
        const merchantPath = pathMod.default.join(process.cwd(), 'uploads', merchantId, filename);
        if (fsMod.existsSync(merchantPath) && fsMod.statSync(merchantPath).isFile()) {
          const ext = pathMod.default.extname(merchantPath).toLowerCase();
          const mimeTypes: Record<string, string> = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml'
          };
          res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
          res.setHeader('Cache-Control', 'public, max-age=31536000');
          return res.sendFile(pathMod.default.resolve(merchantPath));
        }
      }
    }

    // If it's an HTTP/HTTPS URL, check if the file exists locally first
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      // Extract filename from URL (e.g., product-image-1775466193824-953125307.jpg)
      const urlPath = new URL(imageUrl).pathname;
      const filename = urlPath.split('/').pop();
      
      if (filename) {
        const path = await import('path');
        const fs = await import('fs');
        const localPath = path.default.join(process.cwd(), 'uploads', filename);
        
        // If file exists locally in root uploads, serve it directly (legacy files)
        if (fs.existsSync(localPath)) {
          const ext = path.default.extname(filename).toLowerCase();
          const mimeTypes: Record<string, string> = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml'
          };
          
          res.setHeader('Content-Type', mimeTypes[ext] || 'image/jpeg');
          res.setHeader('Cache-Control', 'public, max-age=31536000');
          return res.sendFile(localPath);
        }

        // ✅ Also check merchant-specific subdirectory (new file structure)
        if (merchantId) {
          const merchantPath = path.default.join(process.cwd(), 'uploads', merchantId, filename);
          if (fs.existsSync(merchantPath)) {
            const ext = path.default.extname(filename).toLowerCase();
            const mimeTypes: Record<string, string> = {
              '.jpg': 'image/jpeg',
              '.jpeg': 'image/jpeg',
              '.png': 'image/png',
              '.gif': 'image/gif',
              '.webp': 'image/webp',
              '.svg': 'image/svg+xml'
            };
            
            res.setHeader('Content-Type', mimeTypes[ext] || 'image/jpeg');
            res.setHeader('Cache-Control', 'public, max-age=31536000');
            return res.sendFile(merchantPath);
          }
        }
      }

      // File not found locally, try redirect as fallback
      return res.redirect(imageUrl);
    }

    // No image available
    return next(createError('Image not found', 404));
  } catch (error) {
    next(error);
  }
};

export const deleteProduct = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM products WHERE id = $1 AND merchant_id = $2 RETURNING id',
      [id, req.merchantId]
    );

    if (result.rows.length === 0) {
      return next(createError('Product not found', 404));
    }

    invalidateProductKeywords(req.merchantId!);
    clearProductKeywordsCache(req.merchantId!);
    clearProductCache(req.merchantId!);

    res.json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};


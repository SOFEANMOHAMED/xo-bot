import { Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';

const WEBP_QUALITY = 80;

// Multer stores to a temp directory first; we convert to WebP afterwards.
const uploadDir = process.env.UPLOAD_DIR || 'uploads';

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    // ✅ Security: Store files in merchant-specific subdirectory
    const merchantId = (req as any).merchantId;
    const targetDir = merchantId
      ? path.join(uploadDir, merchantId)
      : uploadDir;

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    cb(null, targetDir);
  },
  filename: (_req, file, cb) => {
    // ASCII-only names: Meta Graph rejects poorly encoded unicode/space paths
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = (path.extname(file.originalname) || '.bin').toLowerCase();
    cb(null, `file-${uniqueSuffix}${ext}`);
  }
});

const imageMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
const proofMimes = [...imageMimes, 'application/pdf'];

const fileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (imageMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only images are allowed.'));
  }
};

const proofFileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (proofMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only images and PDF are allowed.'));
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter
});

const proofUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: proofFileFilter
});

export const uploadSingle = upload.single('file');
export const uploadMultiple = upload.array('files', 10);
export const uploadProofSingle = proofUpload.single('file');

/**
 * Convert an uploaded image to WebP in-place.
 * Returns the new filename (*.webp). If already webp, just returns the original name.
 * The original non-webp file is deleted after conversion.
 */
async function convertToWebP(filePath: string, filename: string): Promise<{ webpFilename: string; webpSize: number }> {
  if (filename.toLowerCase().endsWith('.webp')) {
    const stat = fs.statSync(filePath);
    return { webpFilename: filename, webpSize: stat.size };
  }

  const webpFilename = filename.replace(/\.[^.]+$/, '.webp');
  const webpPath = path.join(path.dirname(filePath), webpFilename);

  await sharp(filePath)
    .webp({ quality: WEBP_QUALITY })
    .toFile(webpPath);

  // Remove original file
  try { fs.unlinkSync(filePath); } catch { /* ignore */ }

  const stat = fs.statSync(webpPath);
  return { webpFilename, webpSize: stat.size };
}

// Upload single file
export const uploadFile = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.file) {
      return next(createError('No file uploaded', 400));
    }

    const { webpFilename, webpSize } = await convertToWebP(req.file.path, req.file.filename);
    const baseUrl = process.env.BACKEND_URL || process.env.BASE_URL || 'https://xo-bot.com';
    // ✅ Security: Include merchantId in the URL path for tenant isolation
    const merchantId = req.merchantId;
    const urlPath = merchantId ? `${merchantId}/${webpFilename}` : webpFilename;
    const encodedPath = urlPath
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    const fileUrl = `${baseUrl.replace(/\/$/, '')}/uploads/${encodedPath}`;

    res.json({
      success: true,
      data: {
        file: {
          filename: webpFilename,
          originalName: req.file.originalname,
          mimetype: 'image/webp',
          size: webpSize,
          url: fileUrl,
          path: `/uploads/${urlPath}`
        }
      }
    });
  } catch (error: any) {
    console.error('Error uploading file:', error);
    next(error);
  }
};

/**
 * Upload payment proof (images or PDF). PDFs are stored as-is; images convert to WebP.
 */
export const uploadPaymentProof = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.file) {
      return next(createError('No file uploaded', 400));
    }

    const merchantId = req.merchantId;
    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    const baseUrl = process.env.BACKEND_URL || process.env.BASE_URL || 'https://xo-bot.com';
    const isPdf = req.file.mimetype === 'application/pdf';

    let filename = req.file.filename;
    let mimetype = req.file.mimetype;
    let size = req.file.size;

    if (!isPdf) {
      const converted = await convertToWebP(req.file.path, req.file.filename);
      filename = converted.webpFilename;
      mimetype = 'image/webp';
      size = converted.webpSize;
    }

    const urlPath = `${merchantId}/${filename}`;
    const fileUrl = `${baseUrl}/uploads/${urlPath}`;

    res.json({
      success: true,
      data: {
        file: {
          filename,
          originalName: req.file.originalname,
          mimetype,
          size,
          url: fileUrl,
          path: `/uploads/${urlPath}`
        }
      }
    });
  } catch (error: any) {
    console.error('Error uploading payment proof:', error);
    next(error);
  }
};

// Upload multiple files
export const uploadFiles = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.files || (req.files as Express.Multer.File[]).length === 0) {
      return next(createError('No files uploaded', 400));
    }

    const baseUrl = process.env.BACKEND_URL || process.env.BASE_URL || 'https://xo-bot.com';
    // ✅ Security: Include merchantId in the URL path for tenant isolation
    const merchantId = req.merchantId;
    const files = await Promise.all(
      (req.files as Express.Multer.File[]).map(async (file) => {
        const { webpFilename, webpSize } = await convertToWebP(file.path, file.filename);
        const urlPath = merchantId ? `${merchantId}/${webpFilename}` : webpFilename;
        const encodedPath = urlPath
          .split('/')
          .map((segment) => encodeURIComponent(segment))
          .join('/');
        return {
          filename: webpFilename,
          originalName: file.originalname,
          mimetype: 'image/webp',
          size: webpSize,
          url: `${baseUrl.replace(/\/$/, '')}/uploads/${encodedPath}`,
          path: `/uploads/${urlPath}`
        };
      })
    );

    res.json({
      success: true,
      data: { files }
    });
  } catch (error: any) {
    console.error('Error uploading files:', error);
    next(error);
  }
};

// Delete file
export const deleteFile = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { filename } = req.params;
    const merchantId = req.merchantId;
    const baseUploadDir = process.env.UPLOAD_DIR || 'uploads';

    if (!merchantId) {
      return next(createError('Unauthorized', 401));
    }

    // ✅ Security: Sanitize filename — strip any directory traversal characters
    const safeName = path.basename(filename);

    // ✅ Security: Only allow deletion within the merchant's own directory
    const merchantDir = path.join(baseUploadDir, merchantId);
    const filePath = path.join(merchantDir, safeName);

    // ✅ Security: Verify resolved path is inside the merchant's directory (prevent path traversal)
    const resolvedPath = path.resolve(filePath);
    const resolvedMerchantDir = path.resolve(merchantDir);
    if (!resolvedPath.startsWith(resolvedMerchantDir + path.sep) && resolvedPath !== resolvedMerchantDir) {
      console.warn('[deleteFile] Path traversal attempt blocked:', { filename, merchantId, resolvedPath });
      return next(createError('Invalid file path', 400));
    }

    // Check if file exists in merchant's directory
    if (!fs.existsSync(filePath)) {
      // ✅ Backward compat: also check root uploads dir for legacy files,
      // but only delete if the merchant owns it (by convention, legacy files
      // have no owner, so we block deletion of root-level files for safety).
      return next(createError('File not found', 404));
    }

    // Delete file
    fs.unlinkSync(filePath);

    res.json({
      success: true,
      message: 'File deleted successfully'
    });
  } catch (error: any) {
    console.error('Error deleting file:', error);
    next(error);
  }
};


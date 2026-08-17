import { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { createError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';

const WEBP_QUALITY = 80;
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const VIDEO_MAX_BYTES = 100 * 1024 * 1024;

const IMAGE_MIMES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
const VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/x-m4v'];
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v']);

function isVideoUpload(file: Express.Multer.File): boolean {
  if (VIDEO_MIMES.includes(file.mimetype)) return true;
  const ext = path.extname(file.originalname || file.filename || '').toLowerCase();
  return VIDEO_EXTENSIONS.has(ext);
}

function publicUploadUrl(merchantId: string | undefined, filename: string): {
  fileUrl: string;
  urlPath: string;
} {
  const baseUrl = process.env.BACKEND_URL || process.env.BASE_URL || 'https://xo-bot.com';
  const urlPath = merchantId ? `${merchantId}/${filename}` : filename;
  const encodedPath = urlPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return {
    urlPath,
    fileUrl: `${baseUrl.replace(/\/$/, '')}/uploads/${encodedPath}`
  };
}

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

const proofMimes = [...IMAGE_MIMES, 'application/pdf'];

const fileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (IMAGE_MIMES.includes(file.mimetype) || isVideoUpload(file)) {
    cb(null, true);
    return;
  }
  cb(createError('صيغة غير مدعومة. الصور: JPEG/PNG/WebP/GIF — الفيديو: MP4 أو MOV', 400));
};

const proofFileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (proofMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(createError('صيغة غير مدعومة. يُسمح بالصور وملفات PDF فقط', 400));
  }
};

const upload = multer({
  storage,
  limits: { fileSize: VIDEO_MAX_BYTES },
  fileFilter
});

export const handleMulterError = (
  err: unknown,
  _req: Request,
  _res: Response,
  next: NextFunction
) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      next(createError('حجم الملف يتجاوز الحد المسموح (100 ميجابايت للفيديو، 10 ميجابايت للصورة)', 400));
      return;
    }
    next(createError(err.message || 'فشل رفع الملف', 400));
    return;
  }
  if (err) {
    next(err);
    return;
  }
  next();
};

const proofStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const merchantId = (req as any).merchantId;
    if (!merchantId) {
      cb(new Error('Unauthorized'), '');
      return;
    }
    const targetDir = path.join(uploadDir, merchantId, 'payment-proofs');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    cb(null, targetDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = (path.extname(file.originalname) || '.bin').toLowerCase();
    cb(null, `proof-${uniqueSuffix}${ext}`);
  }
});

const proofUpload = multer({
  storage: proofStorage,
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

    const merchantId = req.merchantId;
    const video = isVideoUpload(req.file);

    if (video) {
      const { fileUrl, urlPath } = publicUploadUrl(merchantId, req.file.filename);
      res.json({
        success: true,
        data: {
          file: {
            filename: req.file.filename,
            originalName: req.file.originalname,
            mimetype: req.file.mimetype || 'video/mp4',
            size: req.file.size,
            url: fileUrl,
            path: `/uploads/${urlPath}`,
            mediaType: 'video'
          }
        }
      });
      return;
    }

    if (req.file.size > IMAGE_MAX_BYTES) {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      return next(createError('حجم الصورة يتجاوز 10 ميجابايت', 400));
    }

    const { webpFilename, webpSize } = await convertToWebP(req.file.path, req.file.filename);
    const { fileUrl, urlPath } = publicUploadUrl(merchantId, webpFilename);

    res.json({
      success: true,
      data: {
        file: {
          filename: webpFilename,
          originalName: req.file.originalname,
          mimetype: 'image/webp',
          size: webpSize,
          url: fileUrl,
          path: `/uploads/${urlPath}`,
          mediaType: 'image'
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

    const urlPath = `${merchantId}/payment-proofs/${filename}`;
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

    const merchantId = req.merchantId;
    const files = await Promise.all(
      (req.files as Express.Multer.File[]).map(async (file) => {
        if (isVideoUpload(file)) {
          const { fileUrl, urlPath } = publicUploadUrl(merchantId, file.filename);
          return {
            filename: file.filename,
            originalName: file.originalname,
            mimetype: file.mimetype || 'video/mp4',
            size: file.size,
            url: fileUrl,
            path: `/uploads/${urlPath}`,
            mediaType: 'video' as const
          };
        }

        if (file.size > IMAGE_MAX_BYTES) {
          try { fs.unlinkSync(file.path); } catch { /* ignore */ }
          throw createError('حجم الصورة يتجاوز 10 ميجابايت', 400);
        }

        const { webpFilename, webpSize } = await convertToWebP(file.path, file.filename);
        const { fileUrl, urlPath } = publicUploadUrl(merchantId, webpFilename);
        return {
          filename: webpFilename,
          originalName: file.originalname,
          mimetype: 'image/webp',
          size: webpSize,
          url: fileUrl,
          path: `/uploads/${urlPath}`,
          mediaType: 'image' as const
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


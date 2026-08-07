/**
 * Prepare media URLs for Meta Graph (FB / IG).
 * Meta rejects many WebP URLs and poorly encoded paths ("Missing or invalid image file").
 */

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { logger } from '../../utils/logger.js';
import type { ContentPublicationMediaRow } from './types.js';

const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
const PUBLIC_BASE =
  process.env.BACKEND_URL || process.env.BASE_URL || 'https://xo-bot.com';

/** Encode each path segment so Meta can fetch URLs with spaces / unicode. */
export function encodePublicMediaUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.pathname = url.pathname
    .split('/')
    .map((segment) => {
      if (!segment) return segment;
      try {
        return encodeURIComponent(decodeURIComponent(segment));
      } catch {
        return encodeURIComponent(segment);
      }
    })
    .join('/');
  return url.toString();
}

function resolveLocalUploadPath(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (!parsed.pathname.startsWith('/uploads/')) return null;

  let relative: string;
  try {
    relative = decodeURIComponent(parsed.pathname.slice('/uploads/'.length));
  } catch {
    relative = parsed.pathname.slice('/uploads/'.length);
  }

  const root = path.resolve(UPLOAD_DIR);
  const resolved = path.resolve(root, relative);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return null;
  }
  if (!fs.existsSync(resolved)) return null;
  return resolved;
}

function publicUrlForLocalFile(absolutePath: string): string {
  const root = path.resolve(UPLOAD_DIR);
  const relative = path.relative(root, absolutePath).split(path.sep).join('/');
  const encoded = relative
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${PUBLIC_BASE.replace(/\/$/, '')}/uploads/${encoded}`;
}

/**
 * Ensure an image URL is fetchable by Meta as JPEG/PNG.
 * Converts local WebP uploads to a cached `.meta.jpg` sibling.
 */
export async function prepareImageUrlForMeta(rawUrl: string): Promise<string> {
  const localPath = resolveLocalUploadPath(rawUrl);

  if (!localPath) {
    return encodePublicMediaUrl(rawUrl);
  }

  const ext = path.extname(localPath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg' || ext === '.png') {
    return publicUrlForLocalFile(localPath);
  }

  // WebP / GIF / others → JPEG for Graph Content Publishing + Page photos
  const metaJpegPath = localPath.replace(/\.[^.]+$/, '.meta.jpg');
  try {
    const sourceStat = fs.statSync(localPath);
    const needsConvert =
      !fs.existsSync(metaJpegPath) ||
      fs.statSync(metaJpegPath).mtimeMs < sourceStat.mtimeMs;

    if (needsConvert) {
      await sharp(localPath)
        .rotate()
        .jpeg({ quality: 90, mozjpeg: true })
        .toFile(metaJpegPath);
      logger.info('Prepared Meta-compatible JPEG for publish', {
        source: path.basename(localPath),
        output: path.basename(metaJpegPath)
      });
    }
    return publicUrlForLocalFile(metaJpegPath);
  } catch (error) {
    logger.error('Failed to convert media for Meta', error as Error, {
      localPath
    });
    return encodePublicMediaUrl(rawUrl);
  }
}

export async function prepareMediaForMeta(
  media: ContentPublicationMediaRow[]
): Promise<ContentPublicationMediaRow[]> {
  const prepared: ContentPublicationMediaRow[] = [];
  for (const item of media) {
    if (item.media_type === 'image') {
      const mediaUrl = await prepareImageUrlForMeta(item.media_url);
      prepared.push({ ...item, media_url: mediaUrl });
    } else {
      prepared.push({ ...item, media_url: encodePublicMediaUrl(item.media_url) });
    }
  }
  return prepared;
}

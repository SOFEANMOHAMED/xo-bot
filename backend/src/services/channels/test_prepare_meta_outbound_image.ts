/**
 * Smoke test: product API WebP URL prepares to public JPEG for Meta.
 * Run: npx tsx src/services/channels/test_prepare_meta_outbound_image.ts
 */
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { prepareImageUrlForMeta } from '../contentPublishing/preparePublishMedia.js';

const merchantId = '2b73ae4b-bc86-4cbb-8356-e1796599cb2a';
const webpName = 'file-1790681207080-726624835.webp';
const uploadUrl = `https://xo-bot.com/uploads/${merchantId}/${webpName}`;
const localWebp = path.resolve(process.cwd(), 'uploads', merchantId, webpName);

if (!fs.existsSync(localWebp)) {
  console.log('test_prepare_meta_outbound_image: skip (sample webp not on disk)');
  process.exit(0);
}

const prepared = await prepareImageUrlForMeta(uploadUrl);
assert.match(prepared, /\.meta\.jpg$/i, `expected meta jpeg url, got ${prepared}`);
assert.match(prepared, /\/uploads\//, 'prepared URL stays under uploads');
const localJpeg = path.resolve(
  process.cwd(),
  'uploads',
  merchantId,
  webpName.replace(/\.webp$/i, '.meta.jpg')
);
assert.ok(fs.existsSync(localJpeg), `meta jpeg written: ${localJpeg}`);

console.log('test_prepare_meta_outbound_image: all passed');
console.log('  prepared=', prepared);

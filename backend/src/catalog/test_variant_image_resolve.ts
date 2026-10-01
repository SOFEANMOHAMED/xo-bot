/**
 * Variant-safe gallery picking + upload path resolution.
 * Run: npx tsx src/catalog/test_variant_image_resolve.ts
 */
import assert from 'node:assert/strict';
import {
  galleryIsVariantBound,
  pickGalleryImageForVariant,
  type ProductGalleryImage,
} from './resolve-product-image.js';
import { uploadSrcToLocalCandidates } from './upload-local-media.js';

const merchantId = '2b73ae4b-bc86-4cbb-8356-e1796599cb2a';

const gallery: ProductGalleryImage[] = [
  {
    id: 'img-black',
    src: `https://xo-bot.com/uploads/${merchantId}/black.webp`,
    alt: 'أسود',
    position: 0,
    isPrimary: true,
    variantIds: [],
  },
  {
    id: 'img-red',
    src: `https://xo-bot.com/uploads/${merchantId}/red.webp`,
    alt: 'أحمر',
    position: 1,
    isPrimary: false,
    variantIds: [],
  },
];

const product = {
  id: 'prod-1',
  imageUrl: gallery[0].src,
  colors: ['أسود', 'أحمر'],
  sizes: ['s', 'm'],
  variants: null,
};

assert.equal(galleryIsVariantBound(gallery, product), true, 'alt-linked colors are variant-bound');

const red = pickGalleryImageForVariant(gallery, product, { color: 'أحمر' });
assert.equal(red?.image.id, 'img-red', 'red request picks red gallery row');

const black = pickGalleryImageForVariant(gallery, product, { color: 'اسود' });
assert.equal(black?.image.id, 'img-black', 'black request picks black gallery row');

const missing = pickGalleryImageForVariant(gallery, product, { color: 'أزرق' });
assert.equal(missing, null, 'unknown color does not pick another variant image');

const sizeGallery: ProductGalleryImage[] = [
  { id: 's', src: '/uploads/a/s.webp', alt: 's', position: 0, isPrimary: true, variantIds: [] },
  { id: 'm', src: '/uploads/a/m.webp', alt: 'm', position: 1, isPrimary: false, variantIds: [] },
];
const sized = {
  id: 'prod-2',
  imageUrl: sizeGallery[0].src,
  colors: [] as string[],
  sizes: ['s', 'm'],
  variants: null,
};
assert.equal(galleryIsVariantBound(sizeGallery, sized), true, 'size-alt gallery is variant-bound');
const sizeM = pickGalleryImageForVariant(sizeGallery, sized, { size: 'M' });
assert.equal(sizeM?.image.id, 'm', 'size M picks matching gallery row');
assert.equal(
  pickGalleryImageForVariant(sizeGallery, sized, { size: 'xl' }),
  null,
  'unknown size does not pick wrong image'
);

const httpsPath = `https://xo-bot.com/uploads/${merchantId}/file-123.webp`;
const candidates = uploadSrcToLocalCandidates(httpsPath, merchantId);
assert.ok(
  candidates.some((c) => c.replace(/\\/g, '/').endsWith(`uploads/${merchantId}/file-123.webp`)),
  `HTTPS uploads URL keeps merchant folder: ${candidates.join(' | ')}`
);

console.log('test_variant_image_resolve: all passed');

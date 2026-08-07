/**
 * Backfill CLIP visual embeddings for product images.
 * Usage:
 *   cd backend && npm run backfill-visual-embeddings
 *   cd backend && npx tsx src/scripts/backfill-visual-embeddings.ts --merchant=<uuid>
 */

import {
  backfillProductImageEmbeddings,
  ensureProductImageEmbeddingsTable
} from '../catalog/visual-embeddings.js';

async function main() {
  const merchantArg = process.argv.find((a) => a.startsWith('--merchant='));
  const merchantId = merchantArg ? merchantArg.split('=')[1] : undefined;
  const maxArg = process.argv.find((a) => a.startsWith('--max='));
  const maxProducts = maxArg ? Number(maxArg.split('=')[1]) : 500;

  console.log('🔍 Ensuring product_image_embeddings table…');
  await ensureProductImageEmbeddingsTable();

  console.log('🖼️  Backfilling visual embeddings…', {
    merchantId: merchantId || 'ALL',
    maxProducts
  });

  const stats = await backfillProductImageEmbeddings({
    merchantId,
    maxProducts
  });

  console.log('✅ Visual embedding backfill done:', stats);
  process.exit(0);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});

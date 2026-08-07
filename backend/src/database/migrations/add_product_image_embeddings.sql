-- Visual (CLIP) product image embeddings — tenant-isolated
-- Safe to run multiple times. Uses real[] (no pgvector required).

CREATE TABLE IF NOT EXISTS product_image_embeddings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  merchant_id UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  embedding real[] NOT NULL,
  model VARCHAR(96) NOT NULL DEFAULT 'Xenova/clip-vit-base-patch32',
  dims INTEGER NOT NULL DEFAULT 512,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_product_image_embeddings_merchant_product_hash
    UNIQUE (merchant_id, product_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_product_image_embeddings_merchant
  ON product_image_embeddings (merchant_id);

CREATE INDEX IF NOT EXISTS idx_product_image_embeddings_merchant_product
  ON product_image_embeddings (merchant_id, product_id);

CREATE INDEX IF NOT EXISTS idx_product_image_embeddings_merchant_updated
  ON product_image_embeddings (merchant_id, updated_at DESC);

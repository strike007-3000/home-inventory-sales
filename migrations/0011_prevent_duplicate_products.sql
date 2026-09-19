-- The Worker generates this key with Unicode normalization. Keeping legacy
-- rows nullable lets this migration succeed before historical duplicates are
-- consolidated; all new and edited rows receive a key.
ALTER TABLE products ADD COLUMN identity_key TEXT;

CREATE UNIQUE INDEX idx_products_identity ON products(identity_key)
  WHERE identity_key IS NOT NULL;

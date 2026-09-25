-- Operational consolidation evidence stays in D1; never commit business records.
-- IDs intentionally have no foreign keys: the archive must survive removed products.
CREATE TABLE product_consolidation_audit (
  operation_id TEXT PRIMARY KEY,
  canonical_product_id INTEGER NOT NULL,
  source_product_ids_json TEXT NOT NULL CHECK (json_valid(source_product_ids_json)),
  before_json TEXT NOT NULL CHECK (json_valid(before_json)),
  after_json TEXT NOT NULL CHECK (json_valid(after_json)),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

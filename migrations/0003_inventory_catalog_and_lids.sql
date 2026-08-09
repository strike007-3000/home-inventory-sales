-- Expand products for the July 2026 inventory catalogue.
-- Product IDs remain the only identity key. Colour and size are descriptive
-- because a single workbook row may contain multiple values.

CREATE TABLE locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE
);

ALTER TABLE products ADD COLUMN colour TEXT;
ALTER TABLE products ADD COLUMN size TEXT;
ALTER TABLE products ADD COLUMN set_stock_quantity REAL NOT NULL DEFAULT 0
  CHECK (set_stock_quantity >= 0);
ALTER TABLE products ADD COLUMN mrp_minor INTEGER
  CHECK (mrp_minor IS NULL OR mrp_minor >= 0);
ALTER TABLE products ADD COLUMN location_id INTEGER REFERENCES locations(id);
ALTER TABLE products ADD COLUMN personal_use INTEGER NOT NULL DEFAULT 0
  CHECK (personal_use IN (0, 1));
ALTER TABLE products ADD COLUMN import_source TEXT;
ALTER TABLE products ADD COLUMN import_row_number INTEGER
  CHECK (import_row_number IS NULL OR import_row_number > 0);

-- Existing columns retain these meanings for backwards compatibility:
-- selling_price_minor = SRP/SP, cost_price_minor = consultant price (CP),
-- stock_quantity = authoritative individual QTY.
CREATE INDEX idx_products_colour ON products(colour COLLATE NOCASE);
CREATE INDEX idx_products_size ON products(size COLLATE NOCASE);
CREATE INDEX idx_products_location ON products(location_id);
CREATE INDEX idx_products_personal_use ON products(personal_use);
CREATE INDEX idx_products_import_source ON products(import_source);

-- LIDS is a reference catalogue only. It is deliberately separate from
-- products and has no quantity, set stock, location, or stock movements.
CREATE TABLE lid_references (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT,
  item_code TEXT NOT NULL,
  description TEXT NOT NULL,
  promotion TEXT,
  mrp_minor INTEGER NOT NULL CHECK (mrp_minor >= 0),
  special_price_minor INTEGER NOT NULL CHECK (special_price_minor >= 0),
  consultant_price_minor INTEGER NOT NULL CHECK (consultant_price_minor >= 0),
  import_source TEXT NOT NULL,
  import_row_number INTEGER NOT NULL CHECK (import_row_number > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_lid_references_item_code
  ON lid_references(item_code COLLATE NOCASE);
CREATE INDEX idx_lid_references_order_code
  ON lid_references(order_code COLLATE NOCASE);
CREATE INDEX idx_lid_references_description
  ON lid_references(description COLLATE NOCASE);
CREATE INDEX idx_lid_references_import_source
  ON lid_references(import_source);

-- Lookup consumers use MRP whenever the source SP is zero.
CREATE VIEW lid_price_lookup AS
SELECT
  id,
  order_code,
  item_code,
  description,
  promotion,
  mrp_minor,
  special_price_minor,
  consultant_price_minor,
  CASE
    WHEN special_price_minor = 0 THEN mrp_minor
    ELSE special_price_minor
  END AS display_price_minor,
  import_source,
  import_row_number,
  created_at,
  updated_at
FROM lid_references;

-- A product's catalogue prices are per set, while authoritative stock is held
-- as individual pieces. Keep the conversion explicit rather than deriving it
-- from mutable stock values at sale time.
ALTER TABLE products ADD COLUMN units_per_set INTEGER
  CHECK (
    units_per_set IS NULL
    OR (units_per_set > 0 AND units_per_set = CAST(units_per_set AS INTEGER))
  );

-- Conservatively backfill only clean, positive, whole-number ratios. Rows with
-- zero stock or an ambiguous/fractional ratio remain unconfigured for review.
UPDATE products
SET units_per_set = CAST(stock_quantity / set_stock_quantity AS INTEGER)
WHERE stock_quantity > 0
  AND set_stock_quantity > 0
  AND stock_quantity / set_stock_quantity >= 1
  AND ABS(
    stock_quantity / set_stock_quantity
      - CAST(stock_quantity / set_stock_quantity AS INTEGER)
  ) < 0.000000001;

-- Snapshot the packaging and set price used by future sales. Nullable columns
-- keep historical rows readable without inventing packaging metadata.
ALTER TABLE sale_items ADD COLUMN units_per_set_snapshot INTEGER
  CHECK (units_per_set_snapshot IS NULL OR units_per_set_snapshot > 0);
ALTER TABLE sale_items ADD COLUMN set_price_minor_snapshot INTEGER
  CHECK (set_price_minor_snapshot IS NULL OR set_price_minor_snapshot >= 0);

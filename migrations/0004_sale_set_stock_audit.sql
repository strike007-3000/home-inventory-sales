-- A sale records both authoritative individual QTY and the seller-entered
-- post-sale set/pack count. These snapshots make cancellation reversible.
ALTER TABLE sale_items ADD COLUMN set_stock_before REAL NOT NULL DEFAULT 0
  CHECK (set_stock_before >= 0);
ALTER TABLE sale_items ADD COLUMN set_stock_after REAL NOT NULL DEFAULT 0
  CHECK (set_stock_after >= 0);

ALTER TABLE stock_movements ADD COLUMN set_stock_delta REAL NOT NULL DEFAULT 0;

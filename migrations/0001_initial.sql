-- Products
CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT,
  name TEXT NOT NULL,
  category TEXT,
  selling_price_minor INTEGER NOT NULL CHECK (selling_price_minor >= 0),
  cost_price_minor INTEGER CHECK (cost_price_minor >= 0),
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  low_stock_level INTEGER NOT NULL DEFAULT 0 CHECK (low_stock_level >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_products_sku ON products(sku COLLATE NOCASE) WHERE sku IS NOT NULL;
CREATE INDEX idx_products_name ON products(name);
CREATE INDEX idx_products_active ON products(active);

-- Sales (idempotency_key UNIQUE prevents duplicate sales)
CREATE TABLE sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_number TEXT NOT NULL UNIQUE,
  sold_at TEXT NOT NULL,
  subtotal_minor INTEGER NOT NULL CHECK (subtotal_minor >= 0),
  discount_minor INTEGER NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
  note TEXT,
  status TEXT NOT NULL CHECK (status IN ('completed', 'cancelled')),
  payment_method TEXT CHECK (payment_method IN ('upi', 'cash', 'card', 'bank-transfer', 'other')),
  idempotency_key TEXT UNIQUE,
  cancelled_at TEXT,
  cancellation_reason TEXT
);

-- Sale items (snapshots product at sale time)
CREATE TABLE sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name_snapshot TEXT NOT NULL,
  unit_price_minor INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total_minor INTEGER NOT NULL CHECK (line_total_minor >= 0)
);
CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX idx_sale_items_product ON sale_items(product_id);

-- Stock entries
CREATE TABLE stock_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_number TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('delivery', 'count', 'adjustment')),
  supplier TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);

-- Stock entry items
CREATE TABLE stock_entry_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stock_entry_id INTEGER NOT NULL REFERENCES stock_entries(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity_delta INTEGER NOT NULL,
  unit_cost_minor INTEGER
);
CREATE INDEX idx_sei_entry ON stock_entry_items(stock_entry_id);
CREATE INDEX idx_sei_product ON stock_entry_items(product_id);

-- Stock movements (audit trail — explains every stock change)
CREATE TABLE stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity_delta INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN (
    'sale', 'cancellation', 'delivery', 'count',
    'opening', 'damaged', 'lost', 'sample',
    'personal-use', 'incorrect-entry', 'other'
  )),
  sale_id INTEGER REFERENCES sales(id),
  stock_entry_id INTEGER REFERENCES stock_entries(id),
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sm_product ON stock_movements(product_id);
CREATE INDEX idx_sm_created ON stock_movements(created_at);

-- Cancellation records (atomicity guard — UNIQUE on sale_id)
CREATE TABLE sale_cancellations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL UNIQUE REFERENCES sales(id),
  reason TEXT NOT NULL,
  cancelled_at TEXT NOT NULL
);

-- Login rate limiting (best-effort under concurrency)
CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash TEXT NOT NULL,
  attempted_at_ms INTEGER NOT NULL
);
CREATE INDEX idx_la_ip_time ON login_attempts(ip_hash, attempted_at_ms);

-- Import staging (disposable; cleaned up after commit or expiry)
CREATE TABLE import_staging (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  row_number INTEGER NOT NULL,
  sku TEXT,
  name TEXT NOT NULL,
  category TEXT,
  price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  low_stock_level INTEGER NOT NULL DEFAULT 0 CHECK (low_stock_level >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_import_staging_request ON import_staging(request_id);
CREATE INDEX idx_import_staging_created ON import_staging(created_at);

-- Any product created with opening stock automatically gets an audit movement.
CREATE TRIGGER products_opening_stock
AFTER INSERT ON products
WHEN NEW.stock_quantity > 0
BEGIN
  INSERT INTO stock_movements (product_id, quantity_delta, reason, created_at)
  VALUES (NEW.id, NEW.stock_quantity, 'opening', NEW.created_at);
END;

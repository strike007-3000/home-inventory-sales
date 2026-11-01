-- Seller ledger: stock handed to / received from other sellers, settled by stock or money.
CREATE TABLE sellers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_sellers_name ON sellers(name COLLATE NOCASE);

-- direction 'in' = the seller gave us stock; 'out' = we gave the seller stock.
CREATE TABLE seller_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id INTEGER NOT NULL REFERENCES sellers(id),
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  note TEXT,
  sale_id INTEGER REFERENCES sales(id), -- set when the stock was sourced to fulfil a sale
  occurred_at TEXT NOT NULL
);
CREATE INDEX idx_seller_transfers_seller ON seller_transfers(seller_id);

-- unit_value_minor is fixed when the stock changes hands and never recalculated.
CREATE TABLE seller_transfer_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id INTEGER NOT NULL REFERENCES seller_transfers(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_value_minor INTEGER NOT NULL CHECK (unit_value_minor >= 0)
);
CREATE INDEX idx_seller_transfer_items_transfer ON seller_transfer_items(transfer_id);

-- direction 'paid' = we paid the seller; 'received' = the seller paid us.
CREATE TABLE seller_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id INTEGER NOT NULL REFERENCES sellers(id),
  direction TEXT NOT NULL CHECK (direction IN ('paid', 'received')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('upi', 'cash', 'card', 'bank-transfer', 'other')),
  occurred_at TEXT NOT NULL
);
CREATE INDEX idx_seller_payments_seller ON seller_payments(seller_id);

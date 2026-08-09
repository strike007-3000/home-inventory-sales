CREATE TABLE sale_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('upi', 'cash', 'card', 'bank-transfer', 'other')),
  received_at TEXT NOT NULL
);

CREATE INDEX idx_sale_payments_sale ON sale_payments(sale_id);

INSERT INTO sale_payments (sale_id, amount_minor, payment_method, received_at)
SELECT id, total_minor, COALESCE(payment_method, 'other'), sold_at
FROM sales
WHERE status = 'completed' AND total_minor > 0;

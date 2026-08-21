-- Add explicit gift flag to sales (0 = false, 1 = true)
ALTER TABLE sales ADD COLUMN is_gift INTEGER NOT NULL DEFAULT 0 CHECK (is_gift IN (0, 1));

-- Audit log for per-payment method corrections
CREATE TABLE sale_payment_corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id INTEGER NOT NULL REFERENCES sale_payments(id),
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  old_payment_method TEXT NOT NULL CHECK (old_payment_method IN ('upi', 'cash', 'card', 'bank-transfer', 'other')),
  new_payment_method TEXT NOT NULL CHECK (new_payment_method IN ('upi', 'cash', 'card', 'bank-transfer', 'other')),
  corrected_at TEXT NOT NULL
);

CREATE INDEX idx_spc_payment ON sale_payment_corrections(payment_id);
CREATE INDEX idx_spc_sale ON sale_payment_corrections(sale_id);

-- Savings plans: customer pays a fixed amount over time, product is chosen at redemption.
CREATE TABLE plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT NOT NULL,
  monthly_minor INTEGER NOT NULL CHECK (monthly_minor > 0),
  start_date TEXT NOT NULL,
  months INTEGER CHECK (months IS NULL OR months > 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'redeemed', 'cancelled')),
  sale_id INTEGER REFERENCES sales(id),
  refund_minor INTEGER NOT NULL DEFAULT 0 CHECK (refund_minor >= 0),
  cancellation_reason TEXT,
  created_at TEXT NOT NULL,
  closed_at TEXT
);

CREATE TABLE plan_deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('upi', 'cash', 'card', 'bank-transfer', 'other')),
  received_at TEXT NOT NULL
);

CREATE INDEX idx_plan_deposits_plan ON plan_deposits(plan_id);

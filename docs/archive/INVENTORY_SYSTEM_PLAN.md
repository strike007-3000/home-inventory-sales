# Inventory and Sales System Plan

> Archived original proposal. See `../PRODUCT.md` and `../ARCHITECTURE.md` for the current system.

## 1. Purpose and constraints

Build a generic inventory and sales tool for a Tupperware-style home business.

| Constraint | Target |
|---|---|
| Users | One or two, sharing one password |
| Devices | Phones, iPads, and laptops |
| Catalogue | Approximately 1,000 products |
| Hosting | Online and device-independent |
| Synchronization | Changes visible on another device within 30 seconds |
| Cost | EUR 0 within current free-tier limits |
| Setup | A technical person may perform one-time setup |
| Daily operation | Suitable for basic internet users |

## 2. Navigation and language

Use five large bottom navigation destinations:

1. **Home**
2. **Sell**
3. **Stock**
4. **Products**
5. **More**

Avoid words such as CRUD, ledger, reconciliation, SKU management, or stock transaction in the UI. Use familiar actions instead.

### Home

- A large **Record a sale** button
- Sales today
- Number of low-stock and out-of-stock products
- A short, tappable **Needs attention** list
- Last updated time

Charts are out of scope for the MVP.

### Stock

The Stock screen starts with:

- **Stock arrived** — add quantities for one or more products
- **Count stock** — enter the quantity physically present
- **Fix a mistake** — damaged, lost, sample/personal use, incorrect sale, or other

Users must never calculate a stock difference manually. If the system has 17 and the user counts 15, the application shows and records a change of -2.

### Products

The default form contains only:

- Name
- Product code, optional
- Category, optional
- Selling price
- Current quantity during initial setup
- Low-stock warning quantity
- Active/inactive

Cost, barcode, supplier, and notes belong under **More details**. Initially, each sellable colour or size is a separate product, such as `Lunch Box - Blue`.

### Sell

- Search by product name or code
- Add multiple products and change quantities
- Show subtotal, optional discount, and total
- Choose cash, card, bank transfer, or other
- Complete the sale once, with duplicate submission protection
- Show a clear confirmation and simple receipt

## 3. Data model

Store currency as integer minor units, never floating-point values. Use timestamps in UTC and render them in the user's local timezone.

```sql
CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  sku TEXT UNIQUE,
  name TEXT NOT NULL,
  category TEXT,
  selling_price_minor INTEGER NOT NULL CHECK (selling_price_minor >= 0),
  cost_price_minor INTEGER CHECK (cost_price_minor >= 0),
  stock_quantity INTEGER NOT NULL DEFAULT 0,
  low_stock_level INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sales (
  id INTEGER PRIMARY KEY,
  sale_number TEXT NOT NULL UNIQUE,
  sold_at TEXT NOT NULL,
  subtotal_minor INTEGER NOT NULL,
  discount_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL,
  payment_method TEXT,
  note TEXT,
  status TEXT NOT NULL CHECK (status IN ('completed', 'cancelled', 'partially_returned'))
);

CREATE TABLE sale_items (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  product_name_snapshot TEXT NOT NULL,
  unit_price_minor INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  line_total_minor INTEGER NOT NULL
);

CREATE TABLE stock_entries (
  id INTEGER PRIMARY KEY,
  entry_number TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('delivery', 'count', 'adjustment', 'return')),
  supplier TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE stock_entry_items (
  id INTEGER PRIMARY KEY,
  stock_entry_id INTEGER NOT NULL REFERENCES stock_entries(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity_delta INTEGER NOT NULL,
  unit_cost_minor INTEGER
);

CREATE TABLE stock_movements (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity_delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  sale_id INTEGER REFERENCES sales(id),
  stock_entry_id INTEGER REFERENCES stock_entries(id),
  note TEXT,
  created_at TEXT NOT NULL
);
```

Add indexes for active product name, SKU, sale date, and stock movements by product/date. Migrations remain in Git.

`products.stock_quantity` is the fast current balance. `stock_movements` is the audit trail that explains it. Application transactions must update both together.

## 4. Correctness rules

Completing a sale is one database transaction:

1. Validate all input and require at least one item.
2. Read the current products and prices.
3. Verify sufficient stock.
4. Insert the sale and line items.
5. Reduce product balances conditionally so they cannot become negative.
6. Insert matching stock movements.
7. Commit; otherwise roll everything back.

Further rules:

- Never trust totals or prices sent by the browser; calculate them on the server.
- Never hard-delete a completed sale or stock movement.
- Cancelling or returning creates reversing movements exactly once.
- Deactivate products rather than deleting referenced products.
- Protect write requests against double submission with an idempotency key.

## 5. Synchronization

WebSockets are unnecessary for two users.

- Refresh affected data immediately after a write.
- Poll dashboard and stock summaries every 15–30 seconds while visible.
- Always re-check stock inside the write transaction.
- Show **Updated just now** or the age of the displayed data.

Correctness comes from database transactions; polling only improves freshness.

## 6. Delivery phases

### Phase 0 — Workflow validation, 1–2 days

- Prepare 15–20 representative products.
- Prototype Home, Stock, and Sell on a phone-sized screen.
- Ask the parents to perform five pretend sales, one delivery, and one stock count.
- Confirm currency, fractional-quantity needs, payment methods, and return rules.
- Define the source CSV format for the existing catalogue.

Exit criterion: the parents can complete each workflow without verbal instruction.

### Phase 1 — Hosted MVP, 1–2 weeks

- Shared-password login and logout
- Product CRUD with deactivation, search, and CSV import
- Stock delivery, physical count, and reasoned adjustment
- Multi-item sale with atomic stock deduction
- Sale cancellation and full return
- Product stock history
- Low-stock and out-of-stock lists
- CSV exports
- Responsive PWA shell and Cloudflare deployment

Exit criteria:

- Both devices can work at the same time.
- Another device reflects changes within 30 seconds.
- Concurrent sales cannot make stock negative.
- Corrections preserve a comprehensible history.
- All business data can be exported without database access.

### Phase 1.5 — Real-use pilot, 2–4 weeks

- Load only 20–50 products.
- Observe real sales, deliveries, counts, and corrections.
- Record confusing labels, missed taps, and frequent support questions.
- Fix the highest-impact usability problems.
- Download a weekly backup and rehearse restoration once.

Exit criterion: the parents operate the application for a week without routine developer assistance.

### Phase 2 — Proven convenience needs

Choose only items supported by pilot evidence:

- Camera barcode scanning
- Recent and favourite products
- Printable or shareable receipt
- Partial returns
- Payment-method and date-range summaries
- Bulk price and stock editing
- Restock suggestions
- Supplier and purchase-cost details

### Phase 3 — Business extensions

- Customer balances
- Product variants if separate products become unmanageable
- Supplier purchasing records
- Gross-margin reporting
- Tax fields required by the relevant jurisdiction
- Operator PINs if action attribution becomes necessary

## 7. Deliberately deferred

- Registration, roles, permissions, and password reset
- Multiple shops or warehouses
- Native mobile applications
- Offline write synchronization and conflict resolution
- Microservices and a separate API server
- Accounting integrations
- Forecasting, AI, and custom report builders
- Realtime sockets

## 8. Usability and accessibility requirements

- Touch targets at least 44 by 44 CSS pixels
- Body text at least 16 CSS pixels
- No hover-only behavior or icon-only primary actions
- One dominant action per screen
- Cards instead of wide tables on phones
- Visible focus states and keyboard support
- Labels associated with every form field
- Sufficient colour contrast; do not communicate status through colour alone
- Clear save state, validation messages, and recovery guidance
- Preserve an in-progress multi-item sale or restock during accidental navigation
- Test portrait phones and landscape iPads

## 9. Success measures

- A normal sale takes under 30 seconds after product selection becomes familiar.
- A delivery or stock count requires no manual arithmetic.
- Users can explain why a product has its current quantity from its history.
- No duplicate sales or negative stock during the pilot.
- Initial pages remain responsive with 1,000 products.
- The application can be restored from documented exports and migrations.

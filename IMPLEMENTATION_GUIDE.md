# MVP Implementation Guide

This guide defines build order and correctness boundaries. It intentionally avoids a large framework scaffold before implementation begins.

## 1. Suggested project shape

Keep one application with a few obvious boundaries:

```text
src/
  index.ts          HTTP entry point and route wiring
  auth.ts           login and signed-cookie session
  products.ts       product queries and commands
  stock.ts          deliveries, counts, adjustments, history
  sales.ts          sales, cancellations, and returns
  pages.ts          HTML rendering or UI entry
  validation.ts     request parsing and validation
migrations/
public/
test/
wrangler.jsonc
package.json
```

Start with fewer files if the initial code is small. Split only when a module becomes difficult to navigate.

## 2. Build order

### Step 1 — Validate the interface

Create phone-sized prototypes for:

- Home
- Stock action chooser
- Stock arrived
- Count stock
- Sell

Ask the parents to complete realistic tasks without coaching. Change labels and flow before writing database code.

### Step 2 — Create the database

- Add the tables and constraints from `INVENTORY_SYSTEM_PLAN.md` as migration `0001`.
- Add indexes for product name/SKU, sale date, and product movement history.
- Add a small development seed with variants, low stock, and inactive products.
- Make migrations reproducible against an empty local D1 database.

### Step 3 — Products and import

Implement:

- List and search active products
- Add and edit product
- Deactivate and reactivate product
- Validated CSV preview and import

CSV import must show valid rows, invalid rows, and duplicates before committing. A failed import changes nothing.

### Step 4 — Stock management

Implement in this order:

1. Stock-arrived entry with multiple product lines
2. Product stock history
3. Physical count that derives the delta
4. Reasoned correction for damaged, lost, sample/personal use, incorrect sale, and other

Each command runs in one transaction and updates the product balance plus matching stock movements.

### Step 5 — Sales

Build the sale screen around search and large touch controls. On submission, send product IDs and requested quantities—not trusted totals.

The server:

1. Re-reads active products and current prices.
2. Calculates line and sale totals using integers.
3. Conditionally reduces each stock balance.
4. Inserts the sale, snapshots, and movements.
5. Commits all work together.

Use a client-generated idempotency key with a uniqueness constraint so a retry or double tap returns the existing result instead of creating another sale.

### Step 6 — Corrections and returns

- A completed sale is never deleted.
- Cancellation creates reversing stock movements and changes sale status.
- Reject repeated cancellation.
- Record partial returns as explicit return records when Phase 2 adds them.
- Show the original action and correction together in sale history.

### Step 7 — Authentication

- Accept one shared password.
- Verify it against a deployment-secret hash.
- Issue a signed secure cookie.
- Add logout and session expiry.
- Rate-limit login attempts.
- Require the session on every app and export route.

Do not build users, registration, reset email, roles, JWT refresh logic, or a settings database for authentication.

### Step 8 — Dashboard, sync, and PWA

- Show only actionable counts and recent activity.
- Revalidate data after each change.
- Poll visible summaries every 15–30 seconds.
- Pause polling when the page is hidden.
- Add a web manifest and installable icons.
- Do not implement offline writes or WebSockets.

### Step 9 — Export and restore

- Export individual CSV files.
- Export one versioned JSON package with all restorable business records.
- Implement and test an admin restore procedure.
- Never overwrite production data without an explicit backup and confirmation.

### Step 10 — Deploy and pilot

- Deploy to the Cloudflare-generated address.
- Install shortcuts on the parents' phone and iPad.
- Pilot with 20–50 products for two weeks.
- Fix observed usability problems before loading approximately 1,000 products.

## 3. Validation rules

At the server boundary:

- Names are trimmed and required.
- SKU is optional but unique when present.
- Money is a non-negative integer in minor units.
- Sale and stock quantities are positive integers unless fractional units are confirmed in Phase 0.
- Discounts cannot make totals negative.
- Adjustment reasons come from a small allow-list, with a note for `other`.
- Unknown, inactive, or duplicate product IDs are rejected.
- Empty sales and stock entries are rejected.
- Imported files have row and size limits.

Use database checks and uniqueness constraints as the final safety net.

## 4. Minimum test suite

Focus tests on money, stock, security, and data recovery:

- Sale totals and discounts
- Successful multi-item sale
- Insufficient stock rolls back the entire sale
- Two competing sales cannot make stock negative
- Duplicate idempotency key creates one sale
- Cancellation restores stock once
- Physical count records the correct positive or negative delta
- Multi-item delivery is all-or-nothing
- CSV preview detects invalid and duplicate rows
- Protected routes reject missing or invalid sessions
- Session expiry and logout
- Export/restore round trip preserves balances and history

Add a small browser smoke test for the core phone workflow. Avoid a large end-to-end suite until the interface stabilizes during the pilot.

## 5. Usability verification

Test on an actual phone and iPad, not only resized desktop windows.

- A new user can sell an item without instruction.
- A user can enter a delivery without inventory terminology.
- Count stock does not require arithmetic.
- Back navigation does not silently lose a draft.
- Double tapping Complete Sale produces one sale.
- Errors say what happened and what to do next.
- Every primary action has text, not only an icon.
- Zoom and large text do not hide controls.

## 6. MVP completion definition

The MVP is complete when:

- Product import and search work with approximately 1,000 products.
- Both devices can record changes safely.
- Sales, deliveries, counts, adjustments, and cancellations have clear history.
- No tested sequence creates negative or unexplained stock.
- The parents complete routine tasks without developer assistance.
- A complete export has been restored successfully.
- The application is hosted at no monetary cost under the configured free plan.

Barcode scanning, charts, customers, suppliers, operator PINs, and accounting integration are not MVP completion requirements.

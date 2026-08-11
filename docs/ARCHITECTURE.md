# Architecture

## Runtime

Home Inventory is one TypeScript deployment:

```text
Browser
  ├─ static Preact/Vite assets
  └─ /api/* requests
          ↓
Cloudflare Worker (server/index.ts)
          ↓
Cloudflare D1 (binding: DB)
```

`wrangler.jsonc` binds the Worker, static assets, production D1 database, allowed origin, and runtime settings. Requests outside `/api/*` are served from `dist/` with SPA fallback. API requests pass through the Worker router.

## Main code areas

- `src/` — Preact screens, components, browser API client, presentation helpers, and client state
- `server/` — Worker routing, authentication, validation, products, stock, sales, and LIDS handlers
- `shared/contracts.ts` — request and response contracts shared by browser and Worker
- `migrations/` — schema-only D1 migrations safe for GitHub
- `test/unit/` — pure domain tests
- `test/worker/` — authenticated API and real local-D1 integration tests
- `test/e2e/` — browser-level local authentication tests

## Data model

- `products` holds the catalogue and authoritative individual QTY.
- `locations` normalizes location labels but production location rows are not stored in Git.
- `sales` and `sale_items` snapshot commercial details.
- `sale_payments` is append-only and supports unpaid, partial, and later payments.
- `stock_movements` explains every stock mutation, including individual-QTY and Stock/set deltas.
- `sale_cancellations` records reversals instead of deleting history.
- `lid_references` is isolated from inventory tables and exposes a lookup view that falls back to MRP when SP is zero.

## Correctness boundaries

- Money crosses API boundaries as integer paise.
- QTY is a non-negative integer; Stock/set count may be fractional.
- Mutations require authentication, approved origin, and CSRF token.
- Sales use idempotency keys and guarded D1 batches to prevent duplicate or partial stock changes.
- Product edits do not silently rewrite stock; stock-specific endpoints own stock changes.
- Unified stock corrections update QTY and Stock/set atomically, use optimistic product versions, and append both deltas to stock history.
- Sale metadata updates are limited to customer name and sale date; sale items, totals, payments, stock, status, and the original `sold_at` timestamp remain unchanged.
- Normal business mistakes are cancelled or corrected with audit records, not deleted.

## Intentional privacy boundary

Schema is versioned in Git. Business rows are not. Private inventory/LIDS seeds, exports, local databases, real locations, customer records, payments, and credentials remain outside the repository.

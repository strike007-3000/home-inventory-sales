# Home Inventory

A private, touch-friendly inventory and sales application for a small home business. It runs as one Cloudflare Worker, serves a Preact interface, and stores production records in Cloudflare D1.

## Current capabilities

- Inventory catalogue with colour, optional size, QTY, Stock/set count, MRP, SRP/SP, consultant price, location, and self-use indication
- Product search, editing, activation/deactivation, stock delivery, stock counts, and reasoned corrections
- Sales with customer name, editable sale date, price overrides, discounts, payment method, partial/unpaid balances, later payments, and cancellation
- Searchable sales history with payment-status filtering
- Separate LIDS market-price lookup that never participates in inventory stock
- Visual 7-day sales trend summary chart, top category breakdown, and status-highlighted stock alerts on the operational Dashboard
- Metric summary cards with visual icon badges for revenue, sales count, and stock alerts
- Clean navigation shell featuring an application logo icon (`AppLogo`), top-right mobile logout, and desktop sidebar footer logout
- Shared-password authentication with signed cookies and CSRF protection
- Responsive desktop, phone, and iPad layouts with parent-friendly high-contrast indicators
- Automatic production builds and deployments from GitHub `main`

## Technology

- Preact, TypeScript, and Vite
- Cloudflare Workers Static Assets and Worker API routes
- Cloudflare D1 with committed schema migrations
- Vitest, Cloudflare Workers test pool, and Playwright

## Local development

Requirements: Node.js and npm.

```bash
npm install
cp .dev.vars.example .dev.vars
node scripts/generate-password-hash.mjs
```

Put the generated hash and a random session secret in `.dev.vars`, then run two terminals:

```bash
npx wrangler dev --local --port 8787
npm run dev
```

Open the Vite URL shown in the second terminal. The browser frontend calls the local Worker on port 8787.

Run the full required validation:

```bash
npm run check
```

## Data boundary

GitHub contains application code, schema migrations, and synthetic test fixtures only. It must never contain production D1 rows, customer or payment records, inventory/LIDS exports, real storage locations, credentials, `.dev.vars`, local SQLite files, or one-time business-data seeds.

Local-only business files belong under `.private/`, which is ignored by Git. Production data remains in Cloudflare D1.

## Documentation

- [Product](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Operations and deployment](docs/OPERATIONS.md)
- [Contributing and local development](docs/CONTRIBUTING.md)
- [Security](docs/SECURITY.md)
- [Design system](docs/DESIGN.md)

## Known gaps

- User-facing export/restore is not implemented yet.
- There is one shared application password rather than individual accounts or roles.
- Product CSV import remains server-side legacy code; its UI has been intentionally removed.
- Returns are handled by cancellation/correction workflows rather than a dedicated partial-return feature.

## License

MIT. See [LICENSE](LICENSE).

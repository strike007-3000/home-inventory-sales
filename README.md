# Home Inventory

A private, touch-friendly inventory and sales application for a small home business. It runs as one Cloudflare Worker, serves a Preact interface, and stores production records in Cloudflare D1.

## Current capabilities

- Inventory catalogue with colour, optional size, QTY, Stock/set count, MRP, SRP/SP, consultant price, location, and self-use indication
- Product discovery with instant Active / Inactive / All / Personal / Needs setup filters, search integration, and truthful status summaries
- Responsive product cards with colour/size details, selected state styling for items in draft sales, and labelled actions for editing, activation, and audited stock changes
- Password visibility toggle with accessible show/hide control on the login screen
- Stock delivery, physical counts, and reasoned corrections that update both individual QTY and fractional Stock/set values
- Sales with editable customer name and sale date, set and loose-piece selection, proportional set pricing, discounts, payment method, partial/unpaid balances, later payments, and cancellation
- Draft-safe sale flow with Back to items and explicit Discard sale actions
- Searchable sales history with instant horizontal payment-status filter pills (`All sales`, `Paid`, `Unpaid`, `Partial`, `Cancelled`) and status chips (`Paid`, `Partially paid`, `Unpaid`, `Cancelled`)
- Unified 50/50 side-by-side search bars with Deep Midnight Navy Blue (`#0f2b5c`) search buttons across Sales, Products, and LIDS
- Separate LIDS market-price lookup that never participates in inventory stock
- Dashboard attention items with direct product navigation, auto-scrolling, neutral "Opened from Home" product badges, and quiet fallback notice on refresh failure
- Metric summary cards with visual icon badges for Today's revenue, Total revenue, Out of stock, legacy Stock/set valuations, and sale-aware individual-QTY valuations (CP, SRP, MRP)
- Clean navigation shell with refreshed SVG line icons, application logo icon (`AppLogo`), top-right mobile logout, and desktop sidebar footer logout
- Shared-password authentication with signed cookies and CSRF protection
- Responsive desktop, phone, and iPad layouts with parent-friendly high-contrast indicators and stacked mobile page headers
- Automatic production builds and deployments from GitHub `main`
- Dependabot version checks for npm dependencies every 15 days, alongside vulnerability alerts and security-update pull requests

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

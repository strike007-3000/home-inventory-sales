# Home Inventory

A lightweight, hosted inventory and sales application for a home business with approximately 1,000 products and one or two non-technical users.

The application is designed for phones and iPads. It lets users manage products, receive and count stock, record sales, correct mistakes, and understand every stock change without installing software on a specific device.

> [!WARNING]
> This repository currently contains a Phase 0 usability prototype with sample, in-memory data. It has not been approved for production use and must not be trusted with real customer, payment, inventory, or business records.

## Current status

- Public project name: **Home Inventory**
- Suggested repository name: `home-inventory-sales`
- Stage: Phase 0 prototype and parent usability testing
- Currency: INR, stored as integer paise
- Default payment method: UPI
- Persistence and authentication: not implemented yet

## Run locally

Requirements: a current Node.js LTS release and npm.

```bash
npm install
npm run dev
```

Run the build and unit checks with:

```bash
npm run check
```

The checks must pass before publishing a release. See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidance and [SECURITY.md](./SECURITY.md) for responsible vulnerability reporting.

## Product principles

- Use everyday actions: **Sell**, **Stock arrived**, **Count stock**, and **Fix a mistake**.
- Keep one shared password; do not build registration, roles, or user administration.
- Preserve history. Cancel or reverse transactions instead of deleting them.
- Make stock and money updates transactional so partial sales cannot occur.
- Start small, pilot with real users, and add features only after a demonstrated need.
- Remain usable on narrow phone screens and touch-first devices.

## Recommended stack

| Concern | Choice |
|---|---|
| Application | One TypeScript Cloudflare Worker |
| Web UI | Server-rendered HTML or a lightweight React/Preact client |
| Database | Cloudflare D1 |
| Authentication | Shared password and signed secure cookie |
| Hosting | Cloudflare Workers with static assets |
| Address | Free `*.workers.dev` subdomain |
| Source and deployment | GitHub with automatic Cloudflare deployment |

This is intended to cost INR 0 within Cloudflare's free limits. No provider can guarantee that a hosted tier will remain free forever, so the system must support portable data exports and committed database migrations.

## MVP workflows

1. Add, edit, search, import, and deactivate products.
2. Receive several products in one stock delivery.
3. Enter a physical count without calculating the adjustment manually.
4. Record damage, loss, samples, and other corrections with a reason.
5. Record a multi-item sale and deduct stock atomically.
6. Cancel a sale or record a return without deleting history.
7. View low-stock products and plain-language stock history.
8. Export products, sales, and stock movements.

## Documentation

- [INVENTORY_SYSTEM_PLAN.md](./INVENTORY_SYSTEM_PLAN.md) — product scope, phases, data model, and acceptance criteria
- [IMPLEMENTATION_GUIDE.md](./IMPLEMENTATION_GUIDE.md) — recommended build order and technical rules
- [CLOUD_DEPLOYMENT_SUMMARY.md](./CLOUD_DEPLOYMENT_SUMMARY.md) — hosting, authentication, deployment, and backup approach
- [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) — concise implementation checklist
- [DELIVERY_SUMMARY.md](./DELIVERY_SUMMARY.md) — decisions made and intentionally deferred work

## Development order

1. Validate two mobile wireframes with the parents.
2. Build product setup and CSV import.
3. Build stock arrival, physical count, and corrections.
4. Build sale recording and returns.
5. Add dashboard, exports, authentication, and deployment.
6. Pilot with 20–50 products for two weeks.
7. Fix usability issues, then import the full catalogue.
8. Add barcode scanning only if search is too slow.

## Existing projects worth studying

- [Open Source Point of Sale](https://github.com/opensourcepos/opensourcepos) for checkout, receipts, and reporting flows
- [Grocy](https://github.com/grocy/grocy) for barcode and stock-taking workflows
- [InvenTree](https://github.com/inventree/InvenTree) for stock-ledger discipline
- [Frappe Books](https://github.com/frappe/books) for receipts and accounting concepts

These are references, not recommended foundations. Their scope and hosting requirements are larger than this application needs.

## License

Licensed under the [MIT License](./LICENSE).

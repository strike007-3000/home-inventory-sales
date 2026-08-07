# Planning Delivery Summary

## Outcome

The plan now describes a small hosted inventory and sales application for one or two parents using phones and iPads. Stock management is a primary daily workflow alongside sales, not an advanced admin feature.

## Architecture decision

Use one TypeScript Cloudflare Worker, Cloudflare D1, and a free `workers.dev` address.

This replaces the earlier multi-part Next.js, FastAPI, Vercel, Supabase, custom JWT, and Supabase Auth proposal. One application reduces deployment work, duplicated validation, cross-origin configuration, authentication surface, and ongoing maintenance.

## Product decisions

- Bottom navigation: Home, Sell, Stock, Products, More
- One shared password and secure cookie
- Stock actions named Stock arrived, Count stock, and Fix a mistake
- Multi-product stock deliveries
- Physical counts derive adjustments automatically
- Sales deduct stock atomically
- Completed transactions are reversed, not deleted
- Stock movements explain every current balance
- Polling provides near-real-time freshness without WebSockets
- PWA shortcut provides an app-like phone and iPad experience

## Delivery phases

| Phase | Purpose | Estimated duration |
|---|---|---|
| 0 | Validate workflows with the parents | 1–2 days |
| 1 | Hosted products, stock, sales, corrections, export | 1–2 weeks |
| 1.5 | Real-use pilot with 20–50 products | 2–4 weeks |
| 2 | Add convenience features supported by evidence | As needed |
| 3 | Add business extensions only after demand | As needed |

## MVP acceptance outcomes

- Both devices can operate simultaneously.
- Changes appear on another active device within 30 seconds.
- Sales and stock entries cannot be partially committed.
- Duplicate taps cannot create duplicate sales.
- Concurrent sales cannot make stock negative.
- Parents can receive and count stock without arithmetic.
- Corrections leave understandable history.
- Search remains usable with approximately 1,000 products.
- A complete backup export can be restored.
- Hosting remains within the configured free plan.

## Deferred intentionally

- Full user management and roles
- Multiple locations
- Native mobile applications
- Offline write synchronization
- WebSockets
- Separate frontend and backend services
- Customers, suppliers, advanced analytics, and accounting integrations
- Barcode scanning until normal search is tested

## Documentation map

- `README.md` — project overview and starting point
- `INVENTORY_SYSTEM_PLAN.md` — product behavior, phases, schema, and acceptance criteria
- `IMPLEMENTATION_GUIDE.md` — build order, validation, testing, and completion definition
- `CLOUD_DEPLOYMENT_SUMMARY.md` — deployment, security, backups, monitoring, and portability
- `QUICK_REFERENCE.md` — compact build and release checklist

## Next action

Create and test low-fidelity mobile wireframes for Sell, Stock arrived, and Count stock before scaffolding the application.

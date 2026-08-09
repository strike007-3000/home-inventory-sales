# Inventory MVP Quick Reference

> Archived pre-production checklist. It is not a release or operations guide.

## One-minute overview

```text
Users:       1–2 parents, one shared password
Devices:     Phone, iPad, laptop
Catalogue:   About 1,000 products
Stack:       TypeScript + Cloudflare Worker + D1
Hosting:     Free workers.dev address
Sync:        Refresh after writes + 15–30 second polling
Navigation:  Home | Sell | Stock | Products | More
```

## Essential workflows

### Sell

`Search → add items → review total → payment method → complete sale`

### Stock arrived

`Search → add received quantities → review → save`

### Count stock

`System quantity → enter counted quantity → review difference → save`

### Fix a mistake

`Select product → enter correction → choose reason → save`

### Cancel a sale

`Open sale → cancel → confirm → stock restored with history`

## Non-negotiable technical rules

- Store money as integer minor units.
- Complete each sale or grouped stock entry in one database transaction.
- Re-check stock on the server and prevent negative quantities.
- Calculate prices and totals on the server.
- Use idempotency keys to prevent duplicate submissions.
- Reverse history; do not delete completed business transactions.
- Keep schema migrations in Git.
- Export and restore data before full rollout.

## Authentication

- One password hash in a deployment secret
- One session-signing secret
- Signed `HttpOnly`, `Secure`, `SameSite=Lax` cookie
- Login rate limiting
- No users table, registration, roles, password reset, or `localStorage` token

## Parent-friendly UI checklist

- [ ] 44–48 px minimum touch targets
- [ ] 16 px minimum body text
- [ ] Text labels with icons
- [ ] No hover-only controls
- [ ] One main action per screen
- [ ] Cards instead of wide phone tables
- [ ] Clear Saved and Updated status
- [ ] Draft sale/restock survives accidental navigation
- [ ] Tested on a real phone and iPad
- [ ] Low-stock status is not conveyed by colour alone

## Phase checklist

### Phase 0

- [ ] Validate workflows with 15–20 sample products
- [ ] Confirm currency, quantities, payments, and returns
- [ ] Define import CSV

### Phase 1

- [ ] Shared login
- [ ] Product search, edit, deactivation, and CSV import
- [ ] Stock arrival
- [ ] Physical count
- [ ] Reasoned adjustment
- [ ] Multi-item sale
- [ ] Cancellation/full return
- [ ] Stock history and low-stock list
- [ ] CSV and complete JSON export
- [ ] Cloudflare deployment and PWA shortcut

### Pilot

- [ ] Use 20–50 real products for two weeks
- [ ] Fix the highest-impact usability issues
- [ ] Restore one backup successfully
- [ ] Import the full catalogue only after the pilot

### Later, only if proven useful

- [ ] Barcode camera scanning
- [ ] Receipt sharing/printing
- [ ] Partial returns
- [ ] Bulk editing
- [ ] Suppliers and costs
- [ ] Customers and balances
- [ ] Operator PINs

## Release smoke test

1. Log in and log out.
2. Add and find a product.
3. Receive stock.
4. Count stock above and below the displayed balance.
5. Record a multi-item sale.
6. Double tap completion and verify only one sale exists.
7. Attempt to oversell and verify nothing is partially saved.
8. Cancel the sale and verify stock is restored once.
9. Check the product's plain-language movement history.
10. Export and restore representative data.

## Official service references

- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [D1 pricing and limits](https://developers.cloudflare.com/d1/platform/pricing/)
- [D1 documentation](https://developers.cloudflare.com/d1/)

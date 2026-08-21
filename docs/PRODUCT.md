# Product

## Purpose

Home Inventory helps one or two family members run a small home inventory business without spreadsheet formulas or enterprise retail terminology. The interface prioritizes quick recognition, large touch targets, and safe corrections.

## Users and environment

- Primary users are non-technical adults using phones, iPads, and a desktop browser.
- Currency is INR and money is stored as integer paise.
- Internet connectivity is expected; the production system of record is Cloudflare D1.
- The application uses one shared household password.

## Core concepts

- **QTY** is the authoritative count of individual pieces.
- **Stock/set** is the workbook's set count and may be fractional.
- **Pieces in one set** is explicit product packaging data. Products with missing packaging or Stock/set that does not equal QTY divided by Pieces in one set appear under **Needs setup**, but remain sellable.
- **MRP** is maximum retail price; **SRP/SP** is the special selling price; **CP** is consultant price.
- Products flagged for self-use remain sellable; the flag is guidance, not a restriction.
- Colour and size are descriptions, not identity keys. Size may be absent.
- LIDS prices are reference-only and never alter stock.

## Supported workflows

1. Find and edit products.
   Products missing Pieces in one set can be found through the **Needs setup** filter and updated with **Edit details**.
2. Change a product's individual QTY and Stock/set together with an audit reason and optional note.
3. Receive, physically count, or correct stock through dedicated stock tasks.
4. Record a sale in whole sets, loose pieces, or both. Set-priced CP, SRP, and MRP values are divided proportionally by Pieces in one set. Option to mark as explicit Gift sale (no payment due, stock deducted, recipient name).
   Record a sale displays both saved stock values and subtracts sold pieces proportionally from each, clamping Stock/set at zero; it warns about setup issues without blocking the sale or silently replacing the saved value.
5. Go back to adjust a draft sale or explicitly discard it before stock changes.
6. Correct a recorded sale's customer/recipient name or sale date without changing its items, money, payments, stock, or original recorded time. Explicitly mark an existing ₹0/no-payment completed sale as Gift.
7. Correct individual payment methods independently (`PUT /api/sales/:saleId/payments/:paymentId`) with audit records saved in `sale_payment_corrections`.
8. Leave a sale unpaid or partially paid and record later payments.
9. Search older sales and cancel an incorrect sale, reversing stock (including gift sales).
10. Print or save PDF for any sale details page (`window.print()`) with clean layouts for ordinary and gift sales.
11. Look up LIDS market prices separately.

## Product principles

- Prefer one obvious primary action per screen.
- Use plain language and visible consequences.
- Never silently change stock or financial history.
- Keep product details and stock changes as separate, clearly labelled actions.
- Keep routine workflows usable with touch and without training.
- Add features only when they solve a demonstrated operating need.

## Deferred

Individual accounts, roles, barcode scanning, supplier purchase orders, accounting integration, dedicated returns, offline-first sync, and customer messaging are outside the current scope.

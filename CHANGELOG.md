# Changelog

Versions follow [SemVer](https://semver.org/) while pre-1.0: new features bump the minor version, fixes bump the patch.

## Unreleased

### Changed
- Invoice PDF: the invoice number reads `INV-<year>-<sequence>` (e.g. `INV-2026-0042`), derived from the sale date and sale id. The on-screen receipt and search still use the stored `SALE-…` number.
- Invoice PDF: removed the Rate column; items show name, quantity and amount.
- Sale details: "Print / Save PDF" is now "Save PDF". It builds an A4 invoice PDF in the app (`Invoice.pdf`) instead of using the browser print dialog, so no browser URL footer is added (notably on iPhone Safari). The invoice shows the seller ("Neeta Gore", the `SELLER` constant in `src/invoice-pdf.ts`), a status pill, and the app's blue. The ₹ symbol is drawn as vector strokes because the built-in PDF font has no ₹ glyph.
- Plans: the copied reminder now reads "Hello <first name>, just a gentle reminder that your Tupperware kitty payment of ₹<amount> for <month> <year> is due. Thank you!"

### Added
- Invoice PDF: seller phone number and a UPI QR code for the balance due (amount pre-filled; shown only on completed sales with a balance). Seller name, phone and UPI ID are constants at the top of `src/invoice-pdf.ts`.
- Dependencies: `jspdf` (loaded only when saving a PDF) and `qrcode-generator` (same chunk).

## 0.1.0

### Added
- Light/dark theme with a two-way toggle (top header on phones, sidebar on desktop). The first visit follows the system setting; a manual choice is saved in the browser.
- Reports: "Export data" section with Excel exports for sales, sale items, sale payments, stock movements, plans, plan deposits, seller transfers and seller payments, plus a full JSON backup (`GET /api/export/all`).
- Plans: "Due this month" list with a copyable reminder message per customer.

### Changed
- Sellers: the stock transfer product dropdown is now a type-to-search list (same style as product creation), with a small "+ New" button for products not in stock.

### Notes
- The JSON backup is for safekeeping only; there is no in-app restore yet.

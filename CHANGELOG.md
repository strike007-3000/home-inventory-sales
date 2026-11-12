# Changelog

Versions follow [SemVer](https://semver.org/) while pre-1.0: new features bump the minor version, fixes bump the patch.

## Unreleased

### Changed
- Sale details: "Print / Save PDF" is now "Save PDF". It builds an A4 invoice PDF in the app (`Invoice.pdf`) instead of using the browser print dialog, so no browser URL footer is added (notably on iPhone Safari). Amounts in the PDF read "Rs." because the built-in PDF font has no ₹ glyph.
- Plans: the copied reminder now reads "Hello <first name> a gentle reminder that ₹<amount> is due on your Tupperware kitty for <month> <year>. Thank you!"

### Added
- Dependency: `jspdf` (loaded only when saving a PDF).

## 0.1.0

### Added
- Light/dark theme with a two-way toggle (top header on phones, sidebar on desktop). The first visit follows the system setting; a manual choice is saved in the browser.
- Reports: "Export data" section with Excel exports for sales, sale items, sale payments, stock movements, plans, plan deposits, seller transfers and seller payments, plus a full JSON backup (`GET /api/export/all`).
- Plans: "Due this month" list with a copyable reminder message per customer.

### Changed
- Sellers: the stock transfer product dropdown is now a type-to-search list (same style as product creation), with a small "+ New" button for products not in stock.

### Notes
- The JSON backup is for safekeeping only; there is no in-app restore yet.

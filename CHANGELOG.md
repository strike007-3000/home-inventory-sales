# Changelog

Versions follow [SemVer](https://semver.org/) while pre-1.0: new features bump the minor version, fixes bump the patch.

## 0.1.0

### Added
- Light/dark theme with a two-way toggle (top header on phones, sidebar on desktop). The first visit follows the system setting; a manual choice is saved in the browser.
- Reports: "Export data" section with Excel exports for sales, sale items, sale payments, stock movements, plans, plan deposits, seller transfers and seller payments, plus a full JSON backup (`GET /api/export/all`).
- Plans: "Due this month" list with a copyable reminder message per customer.

### Changed
- Sellers: the stock transfer product dropdown is now a type-to-search list (same style as product creation), with a small "+ New" button for products not in stock.

### Notes
- The JSON backup is for safekeeping only; there is no in-app restore yet.

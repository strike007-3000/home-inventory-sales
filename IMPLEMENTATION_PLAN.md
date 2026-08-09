# Phase 1 M2 Implementation Plan

## Baseline Verification (Complete ✓)

**Repository:** `/Users/shrey/Code/Inventory`
**Branch:** `codex/phase-1-m2-product-crud-csv-import` (clean, from main)
**Upstream:** `origin/main` (synced)
**Current Tests:** 49 unit tests passing
**Test Framework:** Vitest with @cloudflare/vitest-pool-workers

### M1 Authentication Preserved
- PBKDF2 password verification
- HMAC-SHA256 signed session cookies (__Host-session / dev-session)
- CSRF double-submit cookie protection
- Origin validation (configurable allowlist)
- Rate limiting (D1 + in-memory burst guard)
- Login throttling (15 attempts/15min)

### D1 Schema Verified
- `products` table with versioning, SKU uniqueness (case-insensitive), validation constraints
- `stock_movements` table with audit trail
- `import_staging` table for CSV preview/commit
- `products_opening_stock` trigger for automatic audit entry

### API Router Verified
- `/api/products` - GET, POST
- `/api/products/:id` - PUT, /deactivate, /activate
- `/api/import/products/preview` - POST (stub)
- `/api/import/products/commit` - POST (stub)

---

## Milestone 1: Product API and D1 CRUD

### Implementation Order
1. Create `server/products.ts` with D1 CRUD operations
2. Implement route handlers in `server/index.ts`
3. Add comprehensive Worker/D1 integration tests

### Product API Contract
**GET /api/products**
- Query params: `q` (search), `active` (active|inactive|all), `limit` (100), `offset` (0)
- Response: `{ items: ProductDTO[], total: number }`
- 200 on success, 401 unauthenticated, 403 disallowed origin, 403 invalid CSRF

**POST /api/products**
- Body: CreateProductRequest (sku, name, category, pricePaise, lowStockLevel, quantity, active)
- Response: ProductDTO, 201 created, 400 validation error, 409 duplicate SKU or version conflict
- Opens stock movement with reason='opening' if quantity > 0

**PUT /api/products/:id**
- Body: UpdateProductRequest (same as CreateProductRequest)
- Response: ProductDTO, 200 updated, 400 validation, 404 missing, 409 version conflict
- Requires version field for optimistic concurrency

**POST /api/products/:id/deactivate**
- Response: ProductDTO (active=false), 200, 401/403, 404
- Preserves history, updates `active=0`

**POST /api/products/:id/activate**
- Response: ProductDTO (active=true), 200, 401/403, 404
- Preserves history, updates `active=1`

### Validation Rules
- Name: required, trimmed, non-empty
- SKU: optional, trimmed, case-insensitive uniqueness when present
- Price: non-negative integer paise
- Quantity: non-negative integer
- Low stock level: non-negative integer
- Version: always present, must match current DB version for updates
- Never physically delete products

### Test Coverage Required
- Create, list, search, edit, deactivate, reactivate
- Zero-price products
- Zero-quantity products
- Duplicate SKU (case-insensitive)
- Invalid inputs (negative prices, missing names, etc.)
- Missing product (404)
- Stale version conflict (409)
- Opening stock movement exactly once
- Authentication (401), Origin (403), CSRF (403)
- Valid authenticated requests

---

## Milestone 2: Product UI Integration

### Requirements
- Replace in-memory data path with Worker API calls
- Use existing CSRF handling in `src/api.ts`
- Implement list, search, add, edit, deactivate, reactivate
- Loading, empty, validation-error, conflict, retry states
- Preserve visual language and touch-friendly controls
- Verify keyboard access, focus, mobile navigation
- Test at 390×844 (iPhone) and 1440×900 (desktop)

### States to Implement
- Loading state: spinner/progress indicator
- Empty state: "No products yet" message
- Validation error: inline error messages
- Conflict error: "Version conflict, refresh and retry"
- Retry capability: reload button for conflicts

### UI Components
- Product list with search bar
- Add/Edit form (modal or inline)
- Deactivate/Activate confirmation dialogs
- Search with active/inactive filter toggle

---

## Milestone 3: Safe CSV Preview

### Endpoint
**POST /api/import/products/preview**
- Content-Type: multipart/form-data with `file` field
- Request limits: 10MB file size, 1000 rows

### CSV Schema
**Required columns (exact match):**
```
name,category,selling_price_minor,quantity,low_stock,sku
```

**Optional columns:**
None (strict schema)

**Header rules:**
- Must match exactly (case-sensitive)
- Reject unexpected or duplicate headers
- Reject missing headers

**Row rules:**
- UTF-8 BOM support
- CRLF and LF line endings
- Quoted fields with escaped quotes (`""`)
- Empty SKU is allowed

**Validation:**
- Apply same rules as Product CRUD (trimmed names, non-negative paise, etc.)
- Detect duplicate SKUs within file (case-insensitive)
- Detect SKU conflicts with existing D1 products
- Detect exact repeated rows
- Identify possible duplicates (near matches) for review

### Response Format
```typescript
{
  requestId: string;        // short-lived UUID
  totals: { total: number; valid: number; invalid: number; duplicate: number };
  validRows: { rowNumber: number; data: ProductDTO }[];
  invalidRows: { rowNumber: number; errors: string[] }[];
  duplicateRows: { rowNumber: number; reason: string; existingSku?: string }[];
  possibleDuplicates: { rowNumber: number; comparison: string }[];
}
```

### Test Coverage
- RFC 4180 parsing (quoted fields, escaped quotes, CRLF/LF)
- UTF-8 BOM handling
- Header validation (exact match, missing, duplicate)
- Row limits and file size limits
- Invalid rows detection
- Duplicate detection within file and with D1
- Exact duplicate row detection
- Authentication, Origin, CSRF protection
- Preview must not mutate products

---

## Milestone 4: Atomic CSV Commit

### Endpoint
**POST /api/import/products/commit**
- Body: ImportCommitRequest `{ requestId: string }`
- Short-lived preview (1 hour expiry)
- One-time use only

### Transaction Rules
- Reject unknown, expired, changed, or already-consumed request IDs
- Commit only when ALL rows are valid and no SKU conflicts
- If ANY row is invalid or has SKU conflict, reject entire commit
- Insert every accepted product AND opening stock movement atomically
- Use D1 transactions (if available) or ensure atomicity via error handling
- If any statement fails, zero products or movements remain

### Request ID Tracking
- Add `created_at`, `consumed` flag to `import_staging`
- Reject if already consumed
- Reject if created_at is expired (>1 hour)

### Response Format
```typescript
{
  success: boolean;
  inserted: number;
  failures: { rowNumber: number; reason: string }[];
}
```

### Test Coverage
- Successful multi-row import (all rows inserted)
- Opening stock movements occur exactly once
- Forced constraint failure leaves zero imports
- Invalid previews cannot be committed
- Expired requests fail
- Unknown requests fail
- Request cannot be committed twice
- Authentication, Origin, CSRF remain intact

---

## Milestone 5: CSV Import UI

### Workflow
1. Select `.csv` file
2. Preview file (show valid/invalid/duplicates)
3. Display preview results clearly
4. Require explicit "Import" confirmation
5. Show final inserted count
6. Never imply success when Worker rejects

### Requirements
- Downloadable example/template CSV
- Mobile-friendly file picker
- Clear error messages
- Success/failure visual feedback
- No XLSX support

### Features
- Drag-and-drop file upload
- Preview before import
- File type validation (must be .csv)
- File size validation (max 10MB)

---

## Final Verification Checklist

Before completion:
- [ ] Formatting: `npm run build` passes
- [ ] Type checking: `npm run build` passes
- [ ] Unit tests: 49 tests still passing
- [ ] Worker tests: All new Worker/D1 tests passing
- [ ] Search for bypasses: auth, CSRF, naive CSV splitting, floating-point money, physical deletion
- [ ] Git status: Clean, no staged changes
- [ ] Migrations: Document any new migrations added
- [ ] Endpoints: Document all new endpoints
- [ ] CSV contract: Document schema and validation
- [ ] Exact validation commands and results

---

## Commands to Run

```bash
# Format and type check
npm run build

# Unit tests
npm run test:unit

# Worker/D1 integration tests
npm run test:worker

# Complete suite
npm run check

# Test with dev server
npm run dev:wrangler
```

---

## Risk Mitigation

- Do NOT deploy
- Do NOT commit or open PR without review
- Keep existing tests green (baseline 49)
- Use real D1 integration tests, not mocks
- Preserve M1 middleware (auth, CSRF, origin)

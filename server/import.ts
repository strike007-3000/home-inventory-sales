// Import management with CSV preview and atomic commit support.
// Preview validates a CSV and stages rows. Commit atomically inserts all products
// using D1 batch (all-or-nothing). The products_opening_stock trigger creates
// opening stock movements, so commit does not insert them manually.

import {
  jsonResponse,
  errorResponse,
  requireJsonBody,
} from './validation';

import type { ImportCommitRequest } from '../shared/contracts';

// ============================================================================
// Constants
// ============================================================================

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_ROWS = 1000;
const REQUIRED_HEADERS = ['name', 'category', 'selling_price_minor', 'quantity', 'low_stock', 'sku'];

// ============================================================================
// RFC 4180-compatible CSV parser
// ============================================================================

type ParsedCsv = {
  rows: string[][];
  rowErrors: Map<number, string[]>;
};

function parseCsv(text: string): ParsedCsv {
  const rows: string[][] = [];
  const rowErrors = new Map<number, string[]>();
  let current: string[] = [];
  let field = '';
  let inQuotes = false;
  let afterClosingQuote = false;
  let rowNumber = 1;

  const addError = (message: string) => {
    const errors = rowErrors.get(rowNumber) ?? [];
    if (!errors.includes(message)) errors.push(message);
    rowErrors.set(rowNumber, errors);
  };

  const endField = () => {
    current.push(field);
    field = '';
    afterClosingQuote = false;
  };

  const endRow = () => {
    endField();
    rows.push(current);
    current = [];
    rowNumber++;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++; // skip escaped quote
      } else if (ch === '"') {
        inQuotes = false;
        afterClosingQuote = true;
      } else {
        field += ch;
      }
    } else {
      if (afterClosingQuote) {
        if (ch === ',') {
          endField();
        } else if (ch === '\r' && next === '\n') {
          endRow();
          i++;
        } else if (ch === '\n') {
          endRow();
        } else {
          addError('Unexpected character after closing quote');
        }
      } else if (ch === '"') {
        if (field.length > 0) {
          addError('Quote is not allowed inside an unquoted field');
        }
        inQuotes = true;
      } else if (ch === ',') {
        endField();
      } else if (ch === '\r' && next === '\n') {
        endRow();
        i++; // skip LF after CR
      } else if (ch === '\n') {
        endRow();
      } else {
        field += ch;
      }
    }
  }

  if (inQuotes) {
    addError('Unterminated quoted field');
  }

  // Flush last field / row, but do not invent a blank row after a final newline.
  if (field !== '' || current.length > 0 || afterClosingQuote) {
    endRow();
  }

  return { rows, rowErrors };
}

// ============================================================================
// Helpers
// ============================================================================

function normalizeSku(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// Strict non-negative integer parser (Requirement 8):
// Only accepts decimal integers. Rejects: empty, whitespace-only, decimals,
// scientific notation (1e3), hex (0x10), leading plus (+10), negative (-1),
// NaN, Infinity, values above MAX_SAFE_INTEGER.
function parseStrictPositiveInteger(raw: string | undefined): number {
  if (raw === undefined) return NaN;
  const trimmed = raw.trim();
  if (trimmed === '') return NaN;
  // Only allow: "0" or positive decimal integer (no leading zeros beyond "0" itself)
  const isValidDecimalInteger = /^(0|[1-9]\d*)$/.test(trimmed);
  if (!isValidDecimalInteger) return NaN;
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n) || n < 0) return NaN;
  return n;
}

// ============================================================================
// Import Preview
// ============================================================================

async function handleImportPreview(
  request: Request,
  env: Env,
): Promise<Response> {
  // ---- Parse multipart form data ----
  const contentType = request.headers.get('Content-Type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return errorResponse('Request must be multipart/form-data with a "file" field');
  }

  const formData = await request.formData();
  const file = formData.get('file');
  if (!file || !(file instanceof File)) {
    return errorResponse('A CSV file is required');
  }

  if (file.size > MAX_FILE_BYTES) {
    return errorResponse(`File exceeds the ${(MAX_FILE_BYTES / 1024 / 1024)}MB limit`);
  }

  const text = await file.text();

  // ---- Strip UTF-8 BOM ----
  const content = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;

  // ---- Parse CSV ----
  const parsed = parseCsv(content);
  const allRows = parsed.rows;

  if (allRows.length === 0) {
    return errorResponse('CSV file is empty');
  }

  const headerErrors = parsed.rowErrors.get(1);
  if (headerErrors && headerErrors.length > 0) {
    return errorResponse(`Invalid CSV header: ${headerErrors.join('; ')}`);
  }

  // ---- Validate headers (exact match, exact order) ----
  const headers = allRows[0];
  if (
    !headers ||
    headers.length !== REQUIRED_HEADERS.length ||
    !headers.every((h, i) => h === REQUIRED_HEADERS[i])
  ) {
    return errorResponse(
      `Invalid headers. Expected exactly: ${REQUIRED_HEADERS.join(',')}`,
    );
  }

  const dataRows = allRows.slice(1);

  if (dataRows.length > MAX_ROWS) {
    return errorResponse(`File exceeds the ${MAX_ROWS}-row limit`);
  }

  if (dataRows.length === 0) {
    return errorResponse('CSV file contains no data rows');
  }

  // ---- Validate rows ----
  const requestId = crypto.randomUUID();
  const now = new Date().toISOString();

  type StagedRow = {
    rowNumber: number;
    sku: string | null;
    name: string;
    category: string | null;
    priceMinor: number;
    quantity: number;
    lowStockLevel: number;
    active: number;
    issueCode: string | null;
  };

  const staged: StagedRow[] = [];

  // Track within-file duplicate SKUs
  const seenSkus = new Map<string, number>(); // normalized sku → first row number

  // Track exact duplicate row signatures
  const seenSigs = new Map<string, number>(); // normalized sig → first row number

  for (let i = 0; i < dataRows.length; i++) {
    const rowNumber = i + 2; // 1-indexed, header is row 1
    const row = dataRows[i];
    if (!row) continue;
    const [nameRaw, categoryRaw, priceRaw, qtyRaw, lowStockRaw, skuRaw] = row;

    const issues: string[] = [];

    issues.push(...(parsed.rowErrors.get(rowNumber) ?? []));
    if (row.length !== REQUIRED_HEADERS.length) {
      issues.push(`Expected ${REQUIRED_HEADERS.length} columns but found ${row.length}`);
    }

    // Name — required, trimmed
    const name = (nameRaw ?? '').trim();
    if (!name) {
      issues.push('Name is required');
    }

    // Price — non-negative integer
    const priceMinor = parseStrictPositiveInteger(priceRaw);
    if (!Number.isFinite(priceMinor) || priceMinor < 0 || !Number.isInteger(priceMinor)) {
      issues.push('Price must be a non-negative integer');
    }

    // Quantity — non-negative integer
    const quantity = parseStrictPositiveInteger(qtyRaw);
    if (!Number.isFinite(quantity) || quantity < 0 || !Number.isInteger(quantity)) {
      issues.push('Quantity must be a non-negative integer');
    }

    // Low stock — non-negative integer
    const lowStockLevel = parseStrictPositiveInteger(lowStockRaw);
    if (!Number.isFinite(lowStockLevel) || lowStockLevel < 0 || !Number.isInteger(lowStockLevel)) {
      issues.push('Low stock level must be a non-negative integer');
    }

    // After validation, NaN values should be replaced with 0
    const finalPriceMinor = Number.isFinite(priceMinor) ? priceMinor : 0;
    const finalQuantity = Number.isFinite(quantity) && quantity >= 0 ? quantity : 0;
    const finalLowStockLevel = Number.isFinite(lowStockLevel) && lowStockLevel >= 0 ? lowStockLevel : 0;

    const category = (categoryRaw ?? '').trim() || null;
    const sku = normalizeSku(skuRaw ?? '');
    const skuKey = sku?.toLowerCase() ?? null;

    // Track within-file duplicate SKUs case-insensitively
    if (skuKey) {
      if (!seenSkus.has(skuKey)) {
        seenSkus.set(skuKey, rowNumber);
      } else {
        const firstRow = seenSkus.get(skuKey)!;
        issues.push(`Duplicate SKU — first seen in row ${firstRow}`);
      }
    }

    // Exact duplicate row
    const sig = [
      name.toLowerCase(),
      (category ?? '').toLowerCase(),
      priceMinor,
      quantity,
      lowStockLevel,
      sku ?? '',
    ].join('|');
    const prevSig = seenSigs.get(sig);
    if (prevSig !== undefined) {
      issues.push(`Exact duplicate of row ${prevSig}`);
    } else {
      seenSigs.set(sig, rowNumber);
    }

    // SKU conflict against D1 (only if no field errors — we still want to detect conflicts for clean rows)
    if (sku && issues.length === 0) {
      const conflict = await env.DB.prepare(
        'SELECT id FROM products WHERE sku = ? COLLATE NOCASE LIMIT 1',
      )
        .bind(sku)
        .first();
      if (conflict) {
        issues.push(`SKU "${sku}" already exists in the database`);
      }
    }

    staged.push({
      rowNumber,
      sku,
      name,
      category,
      priceMinor: finalPriceMinor,
      quantity: finalQuantity,
      lowStockLevel: finalLowStockLevel,
      active: 1,
      issueCode: issues.length > 0 ? issues.join('; ') : null,
    });
  }

  // ---- Persist staging rows ----
  const batch = staged.map((row) =>
    env.DB.prepare(
      `INSERT INTO import_staging
         (request_id, row_number, sku, name, category, price_minor,
          quantity, low_stock_level, active, created_at, issue_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      requestId,
      row.rowNumber,
      row.sku,
      row.name,
      row.category,
      row.priceMinor,
      row.quantity,
      row.lowStockLevel,
      row.active,
      now,
      row.issueCode,
    ),
  );

  if (batch.length > 0) {
    await env.DB.batch(batch);
  }

  // ---- Build response ----
  const validRows = staged
    .filter((r) => r.issueCode === null)
    .map((r) => ({
      rowNumber: r.rowNumber,
      data: {
        name: r.name,
        category: r.category,
        pricePaise: r.priceMinor,
        quantity: r.quantity,
        lowStockLevel: r.lowStockLevel,
        sku: r.sku,
      },
    }));

  const invalidRows = staged
    .filter((r) => r.issueCode !== null)
    .map((r) => ({
      rowNumber: r.rowNumber,
      errors: r.issueCode!.split('; '),
    }));

  // Duplicate SKUs (folded into invalidRows for now)
  const duplicateRows = staged
    .filter((r) => {
      const sku = r.sku;
      if (!sku) return false;
      const prev = seenSkus.get(sku.toLowerCase());
      return prev !== undefined && prev !== r.rowNumber;
    })
    .map((r) => ({
      rowNumber: r.rowNumber,
      sku: r.sku,
      firstSeenRow: seenSkus.get(r.sku!.toLowerCase()),
      reason: `Duplicate SKU — first seen in row ${seenSkus.get(r.sku!.toLowerCase())}`,
    }));

  return jsonResponse({
    requestId,
    totals: {
      total: dataRows.length,
      valid: validRows.length,
      invalid: invalidRows.length,
      duplicate: duplicateRows.length,
    },
    validRows,
    invalidRows,
    duplicateRows,
    possibleDuplicates: [],
  });
}

// ============================================================================
// Import Commit
// ============================================================================

async function handleImportCommit(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = await requireJsonBody<ImportCommitRequest>(request);
  if (body instanceof Response) return body;

  // Validate request ID
  if (!body.requestId || typeof body.requestId !== 'string' || body.requestId.trim() === '') {
    return errorResponse('Request ID is required', 400);
  }

  const requestId = body.requestId;

  // ---- Fetch staging metadata ----
  const meta = await env.DB.prepare(
    'SELECT consumed, created_at, COUNT(*) as total FROM import_staging WHERE request_id = ? GROUP BY request_id',
  )
    .bind(requestId)
    .first<{ consumed: number; created_at: string; total: number }>();

  if (!meta) {
    return errorResponse('Request not found', 404);
  }

  // Already consumed
  if (meta.consumed === 1) {
    return errorResponse('Request has already been consumed', 409);
  }

  // Expired (> 1 hour)
  const createdAtMs = new Date(meta.created_at).getTime();
  if (Date.now() - createdAtMs > 60 * 60 * 1000) {
    return errorResponse('Request has expired', 410);
  }

  // ---- Reject if ANY row had issues (duplicate SKUs, etc) ----
  const issueCount = await env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM import_staging WHERE request_id = ? AND issue_code IS NOT NULL',
  )
    .bind(requestId)
    .first<{ cnt: number }>();

  if ((issueCount?.cnt ?? 0) > 0) {
    // Separate validation errors from fatal constraints (duplicate SKUs)
    const validationCount = await env.DB.prepare(
      'SELECT COUNT(*) as cnt FROM import_staging WHERE request_id = ? AND issue_code IS NOT NULL AND issue_code NOT LIKE "%Duplicate SKU%"',
    )
      .bind(requestId)
      .first<{ cnt: number }>();

    if ((validationCount?.cnt ?? 0) > 0) {
      return errorResponse('Preview contains rows with validation errors — please fix and re-preview', 400);
    }

    // Only within-file duplicate SKUs or database conflicts - fatal, return 409
    return errorResponse('Preview contains duplicate SKUs or conflicts — please fix and re-preview', 409);
  }

  // ---- Fetch clean rows ----
  const staged = await env.DB.prepare(
    `SELECT row_number, sku, name, category, price_minor, quantity, low_stock_level, active
     FROM import_staging
     WHERE request_id = ? AND issue_code IS NULL
     ORDER BY row_number ASC`,
  )
    .bind(requestId)
    .all<{ row_number: number; sku: string; name: string; category: string | null; price_minor: number; quantity: number; low_stock_level: number; active: number }>();

  if (!staged.results || staged.results.length === 0) {
    return errorResponse('No valid rows to import', 400);
  }

  // ---- Re-check SKU conflicts against D1 (race-safe) ----
  const skuValues = staged.results
    .map((r) => (r.sku as string | null)?.toLowerCase() ?? null)
    .filter((s): s is string => s !== null);

  if (skuValues.length > 0) {
    const placeholders = skuValues.map(() => '?').join(',');
    const conflicts = await env.DB.prepare(
      `SELECT sku FROM products WHERE LOWER(sku) IN (${placeholders})`,
    )
      .bind(...skuValues)
      .all<{ sku: string }>();

    if (conflicts.results && conflicts.results.length > 0) {
      const conflictSkus = conflicts.results.map((r) => r.sku);
      return jsonResponse(
        {
          success: false,
          inserted: 0,
          failures: [{ rowNumber: 0, reason: `SKU conflicts with existing products: ${conflictSkus.join(', ')}` }],
        },
        409,
      );
    }
  }

  // ---- Re-check within-file duplicate SKUs (race-safe) ----
  const skuSet = new Set<string>();
  for (const row of staged.results) {
    const rowNumber = row.row_number as number;
    const sku = (row.sku as string | null)?.toLowerCase();
    if (sku) {
      if (skuSet.has(sku)) {
        return jsonResponse(
          {
            success: false,
            inserted: 0,
            failures: [{ rowNumber: rowNumber, reason: `Duplicate SKU in import: ${sku}` }],
          },
          409,
        );
      }
      skuSet.add(sku);
    }
  }

  // ---- Build atomic batch ----
  const now = new Date().toISOString();
  const claimToken = crypto.randomUUID();
  const batch: D1PreparedStatement[] = [
    env.DB.prepare(
      `UPDATE import_staging
       SET consumed = 1, claim_token = ?
       WHERE request_id = ? AND consumed = 0
         AND NOT EXISTS (
           SELECT 1 FROM import_staging claimed
           WHERE claimed.request_id = ? AND claimed.consumed = 1
         )`,
    ).bind(claimToken, requestId, requestId),
  ];

  for (const row of staged.results) {
    const sku = row.sku ? (row.sku as string).trim() : null;
    const name = (row.name as string).trim();
    const category = row.category ? (row.category as string).trim() : null;
    const priceMinor = row.price_minor as number;
    const quantity = row.quantity as number;
    const lowStockLevel = row.low_stock_level as number;
    const active = (row.active as number) === 1;

    // The products_opening_stock trigger (migration 0001) creates an opening
    // stock_movement automatically when stock_quantity > 0, so we do NOT
    // insert a movement here.
    batch.push(
      env.DB.prepare(
        `INSERT INTO products
           (sku, name, category, selling_price_minor, cost_price_minor,
            stock_quantity, low_stock_level, active, version, created_at, updated_at)
         SELECT ?, ?, ?, ?, NULL, ?, ?, ?, 1, ?, ?
         WHERE (
           SELECT COUNT(*) FROM import_staging
           WHERE request_id = ? AND consumed = 1 AND claim_token = ?
         ) = ?`,
      ).bind(
        sku, name, category, priceMinor, quantity, lowStockLevel,
        active ? 1 : 0, now, now,
        requestId, claimToken, staged.results.length,
      ),
    );
  }

  // ---- Execute atomically ----
  try {
    const results = await env.DB.batch(batch);

    // Another commit may have claimed this request after our preflight read.
    // Its token cannot satisfy the guarded INSERT statements above.
    if ((results[0]?.meta.changes ?? 0) !== staged.results.length) {
      return errorResponse('Request has already been consumed', 409);
    }

    // D1 batch is atomic — if any statement fails, the entire batch rolls back.
    // Verify each result for safety.
    for (const result of results) {
      if (!result.success) {
        return jsonResponse(
          {
            success: false,
            inserted: 0,
            failures: [{ rowNumber: 0, reason: 'Atomic commit failed — no products were inserted' }],
          },
          500,
        );
      }
    }

    return jsonResponse({
      success: true,
      inserted: staged.results.length,
      failures: [],
    });
  } catch (_error) {
    return jsonResponse(
      {
        success: false,
        inserted: 0,
        failures: [{ rowNumber: 0, reason: 'Import commit failed; no products were inserted' }],
      },
      500,
    );
  }
}

// ============================================================================
// Exports
// ============================================================================

export { handleImportPreview, handleImportCommit };

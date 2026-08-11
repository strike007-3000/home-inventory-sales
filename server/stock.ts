// Stock management operations with D1
// Atomic database operations for stock deliveries, counts, and adjustments

import {
  jsonResponse,
  errorResponse,
  requireJsonBody,
} from './validation';
import type {
  StockDeliveryRequest,
  StockCountRequest,
  StockAdjustmentRequest,
  StockChangeRequest,
  ProductDTO,
} from '../shared/contracts';

const STOCK_CHANGE_REASONS = new Set([
  'delivery', 'count', 'damaged', 'lost', 'sample', 'personal-use',
  'incorrect-entry', 'other',
]);
const STOCK_INCREASE_ONLY_REASONS = new Set(['delivery']);
const STOCK_DECREASE_ONLY_REASONS = new Set([
  'damaged', 'lost', 'sample', 'personal-use',
]);
const MAX_STOCK_NOTE_LENGTH = 500;

// ============================================================================
// Stock Delivery Handler (atomic with D1 batch)
// ============================================================================

async function handleStockDelivery(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = await requireJsonBody<StockDeliveryRequest>(request);
  if (body instanceof Response) return body;

  if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
    return errorResponse('Items array is required and must not be empty');
  }

  const now = new Date().toISOString();

  // Validate all items
  for (const item of body.items) {
    if (!Number.isSafeInteger(item.productId) || item.productId <= 0) {
      return errorResponse('Product ID is required and must be a positive integer within the safe range', 400, 'productId');
    }
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      return errorResponse('Quantity must be a positive integer within the safe range', 400, 'quantity');
    }
  }

  // Aggregate repeated product IDs: total quantity per product
  const aggregated = new Map<number, number>();
  for (const item of body.items) {
    const total = (aggregated.get(item.productId) ?? 0) + item.quantity;
    if (!Number.isSafeInteger(total)) {
      return errorResponse('Total quantity must be a safe integer', 400, 'quantity');
    }
    aggregated.set(item.productId, total);
  }

  const productIds = [...aggregated.keys()];
  if (productIds.length === 0) {
    return errorResponse('No valid items to deliver');
  }

  // Fetch current products for validation and response
  const placeholders = productIds.map(() => '?').join(',');
  const products = await env.DB.prepare(
    `SELECT id, name, stock_quantity FROM products WHERE id IN (${placeholders})`,
  )
    .bind(...productIds)
    .all();

  const productsMap = new Map(
    (products.results || []).map((p) => [
      p.id,
      { name: p.name as string, quantity: p.stock_quantity as number },
    ]),
  );

  // Verify all products exist
  for (const pid of productIds) {
    if (!productsMap.has(pid)) {
      return errorResponse(`Product ${pid} not found`, 404, 'productId');
    }
    const resultingQuantity = productsMap.get(pid)!.quantity + aggregated.get(pid)!;
    if (!Number.isSafeInteger(resultingQuantity)) {
      return errorResponse('Stock changed or resulting quantity exceeds the safe integer range', 409, 'quantity');
    }
  }

  // Generate unique entry number
  const entryNumber = crypto.randomUUID();

  // Build atomic batch: header → updates → entry items → movements
  const batch: D1PreparedStatement[] = [];

  // 1. Claim this delivery by inserting its header only if every affected
  // product still fits within the safe integer range at batch execution time.
  // This is the decisive concurrency guard; the earlier read is only prevalidation.
  const guardClauses = productIds.map(
    () => 'EXISTS (SELECT 1 FROM products WHERE id = ? AND stock_quantity <= ?)',
  ).join(' AND ');
  const guardBindings = productIds.flatMap((pid) => [
    pid,
    Number.MAX_SAFE_INTEGER - aggregated.get(pid)!,
  ]);
  batch.push(
    env.DB.prepare(
      `INSERT INTO stock_entries (entry_number, type, supplier, note, created_at)
       SELECT ?, 'delivery', NULL, ?, ?
       WHERE ${guardClauses}`,
    ).bind(entryNumber, null, now, ...guardBindings),
  );

  // 2. Update product quantities (atomic increment)
  for (const pid of productIds) {
    const qty = aggregated.get(pid)!;
    batch.push(
      env.DB.prepare(
        `UPDATE products
         SET stock_quantity = stock_quantity + ?, updated_at = ?, version = version + 1
         WHERE id = ?
           AND EXISTS (SELECT 1 FROM stock_entries WHERE entry_number = ?)`,
      ).bind(qty, now, pid, entryNumber),
    );
  }

  // 3. Insert stock_entry_items (resolve stock_entry_id via subquery)
  for (const pid of productIds) {
    const qty = aggregated.get(pid)!;
    batch.push(
      env.DB.prepare(
        `INSERT INTO stock_entry_items (stock_entry_id, product_id, quantity_delta)
         SELECT id, ?, ? FROM stock_entries WHERE entry_number = ?`,
      ).bind(pid, qty, entryNumber),
    );
  }

  // 4. Insert stock_movements (resolve stock_entry_id via subquery)
  for (const pid of productIds) {
    const qty = aggregated.get(pid)!;
    batch.push(
      env.DB.prepare(
        `INSERT INTO stock_movements (product_id, quantity_delta, reason, stock_entry_id, note, created_at)
         SELECT ?, ?, 'delivery', id, ?, ? FROM stock_entries WHERE entry_number = ?`,
      ).bind(pid, qty, `Received ${qty} units`, now, entryNumber),
    );
  }

  // Execute atomically — any failure rolls back everything
  try {
    const results = await env.DB.batch(batch);

    if ((results[0]?.meta.changes ?? 0) !== 1) {
      return errorResponse('Stock changed or resulting quantity exceeds the safe integer range', 409, 'quantity');
    }

    for (const result of results) {
      if (!result || !result.success) {
        return errorResponse('Stock delivery failed; no changes were made', 500);
      }
    }

    // Query actual stored quantities from D1
    const updatedProducts = await env.DB.prepare(
      `SELECT id, name, stock_quantity FROM products WHERE id IN (${placeholders})`,
    )
      .bind(...productIds)
      .all<{ id: number; name: string; stock_quantity: number }>();

    const entries = (updatedProducts.results || []).map((row) => {
      return {
        productId: row.id,
        productName: row.name,
        quantityReceived: aggregated.get(row.id)!,
        newQuantity: row.stock_quantity,
      };
    });

    // Query header for response
    const header = await env.DB.prepare(
      `SELECT id FROM stock_entries WHERE entry_number = ?`,
    )
      .bind(entryNumber)
      .first<{ id: number }>();

    return jsonResponse({
      ok: true,
      entries,
      entryNumber,
      stockEntryId: header?.id ?? 0,
    });
  } catch (_error) {
    return errorResponse('Stock delivery failed; no changes were made', 500);
  }
}

// ============================================================================
// Stock Count Handler (sequential with version guard)
// ============================================================================

async function handleStockCount(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = await requireJsonBody<StockCountRequest>(request);
  if (body instanceof Response) return body;

  if (!Number.isSafeInteger(body.productId) || body.productId <= 0) {
    return errorResponse('Product ID is required and must be a positive integer within the safe range', 400, 'productId');
  }
  if (!Number.isSafeInteger(body.countedQuantity) || body.countedQuantity < 0) {
    return errorResponse('Counted quantity must be a non-negative integer within the safe range', 400, 'countedQuantity');
  }

  const now = new Date().toISOString();

  // Get current product with version for concurrency control
  const product = await env.DB.prepare(
    `SELECT id, name, stock_quantity, version FROM products WHERE id = ?`,
  )
    .bind(body.productId)
    .first();

  if (!product) {
    return errorResponse('Product not found', 404, 'productId');
  }

  const productName = product.name as string;
  const oldQuantity = product.stock_quantity as number;
  const expectedVersion = product.version as number;

  if (oldQuantity === body.countedQuantity) {
    return errorResponse('No change detected — counted quantity matches current stock', 400);
  }

  const delta = body.countedQuantity - oldQuantity;

  // The movement is conditionally inserted only when the immediately preceding
  // guarded UPDATE changed one row. D1 executes batch statements sequentially
  // in one transaction, so quantity and audit history commit or roll back together.
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE products SET stock_quantity = stock_quantity + ?, updated_at = ?, version = version + 1
       WHERE id = ? AND version = ?`,
    ).bind(delta, now, body.productId, expectedVersion),
    env.DB.prepare(
      `INSERT INTO stock_movements (product_id, quantity_delta, reason, note, created_at)
       SELECT ?, ?, 'count', ?, ? WHERE changes() = 1`,
    ).bind(body.productId, delta, body.note || null, now),
  ]);

  if ((results[0]?.meta.changes ?? 0) !== 1) {
    return errorResponse('Conflict: stock changed since read; please retry', 409);
  }

  return jsonResponse({
    ok: true,
    productId: body.productId,
    productName,
    oldQuantity,
    newQuantity: body.countedQuantity,
    delta,
    note: body.note,
  });
}

// ============================================================================
// Stock Adjustment Handler (sequential with version guard)
// ============================================================================

async function handleStockAdjustment(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = await requireJsonBody<StockAdjustmentRequest>(request);
  if (body instanceof Response) return body;

  if (!Number.isSafeInteger(body.productId) || body.productId <= 0) {
    return errorResponse('Product ID is required and must be a positive integer within the safe range', 400, 'productId');
  }

  if (!body.reason || !body.reason.trim()) {
    return errorResponse('Reason is required', 400, 'reason');
  }

  const validReasons = [
    'damaged', 'lost', 'sample', 'personal-use',
    'incorrect-entry', 'other',
  ];

  if (!validReasons.includes(body.reason)) {
    return errorResponse(
      `Reason must be one of: ${validReasons.join(', ')}`,
      400,
      'reason',
    );
  }

  if (!Number.isSafeInteger(body.quantity) || body.quantity <= 0) {
    return errorResponse('Quantity must be a positive integer within the safe range', 400, 'quantity');
  }

  const now = new Date().toISOString();

  // Get current product with version for concurrency control
  const product = await env.DB.prepare(
    `SELECT id, name, stock_quantity, version FROM products WHERE id = ?`,
  )
    .bind(body.productId)
    .first();

  if (!product) {
    return errorResponse('Product not found', 404, 'productId');
  }

  const oldQuantity = product.stock_quantity as number;
  const productName = product.name as string;
  const expectedVersion = product.version as number;
  const isSubtractive = ['damaged', 'lost', 'sample', 'personal-use'].includes(body.reason);

  // Calculate new quantity (clamp at 0 for subtractive)
  const newQuantity = isSubtractive
    ? Math.max(0, oldQuantity - body.quantity)
    : oldQuantity + body.quantity;

  if (!Number.isSafeInteger(newQuantity)) {
    return errorResponse('Resulting stock quantity exceeds the safe integer range', 400, 'quantity');
  }

  // appliedDelta = actual change to stock (handles clamping)
  const appliedDelta = newQuantity - oldQuantity;

  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE products SET stock_quantity = ?, updated_at = ?, version = version + 1
       WHERE id = ? AND version = ?`,
    ).bind(newQuantity, now, body.productId, expectedVersion),
    env.DB.prepare(
      `INSERT INTO stock_movements (product_id, quantity_delta, reason, note, created_at)
       SELECT ?, ?, ?, ?, ? WHERE changes() = 1`,
    ).bind(body.productId, appliedDelta, body.reason, body.note || null, now),
  ]);

  if ((results[0]?.meta.changes ?? 0) !== 1) {
    return errorResponse('Conflict: stock changed since read; please retry', 409);
  }

  return jsonResponse({
    ok: true,
    productId: body.productId,
    productName,
    oldQuantity,
    newQuantity,
    delta: appliedDelta,
    reason: body.reason,
    note: body.note,
  });
}

// ============================================================================
// Unified stock change (absolute quantities, atomically audited)
// ============================================================================

async function handleStockChange(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = await requireJsonBody<StockChangeRequest>(request);
  if (body instanceof Response) return body;

  if (!Number.isSafeInteger(body.productId) || body.productId <= 0) {
    return errorResponse('Product ID must be a positive integer within the safe range', 400, 'productId');
  }
  if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion <= 0) {
    return errorResponse('Expected version must be a positive integer within the safe range', 400, 'expectedVersion');
  }
  if (!Number.isSafeInteger(body.quantity) || body.quantity < 0) {
    return errorResponse('Quantity must be a non-negative integer within the safe range', 400, 'quantity');
  }
  if (!Number.isFinite(body.setStockQuantity) || body.setStockQuantity < 0) {
    return errorResponse('Set stock must be a non-negative finite number', 400, 'setStockQuantity');
  }
  if (typeof body.reason !== 'string' || !STOCK_CHANGE_REASONS.has(body.reason)) {
    return errorResponse(`Reason must be one of: ${[...STOCK_CHANGE_REASONS].join(', ')}`, 400, 'reason');
  }
  if (body.note !== undefined && body.note !== null && typeof body.note !== 'string') {
    return errorResponse('Note must be text', 400, 'note');
  }
  const note = body.note?.trim() || null;
  if (note && note.length > MAX_STOCK_NOTE_LENGTH) {
    return errorResponse(`Note must be at most ${MAX_STOCK_NOTE_LENGTH} characters`, 400, 'note');
  }

  const current = await env.DB.prepare(
    `SELECT id, stock_quantity, set_stock_quantity, version
     FROM products WHERE id = ?`,
  ).bind(body.productId).first<{
    id: number;
    stock_quantity: number;
    set_stock_quantity: number;
    version: number;
  }>();

  if (!current) {
    return errorResponse('Product not found', 404, 'productId');
  }
  if (current.version !== body.expectedVersion) {
    return errorResponse('Conflict: product changed since it was loaded; please retry', 409, 'expectedVersion');
  }

  const quantityDelta = body.quantity - current.stock_quantity;
  const setStockDelta = body.setStockQuantity - current.set_stock_quantity;
  if (quantityDelta === 0 && setStockDelta === 0) {
    return errorResponse('At least one stock value must change', 400);
  }
  if (STOCK_INCREASE_ONLY_REASONS.has(body.reason) && (quantityDelta < 0 || setStockDelta < 0)) {
    return errorResponse('Delivery cannot decrease stock values', 400, 'reason');
  }
  if (STOCK_DECREASE_ONLY_REASONS.has(body.reason) && (quantityDelta > 0 || setStockDelta > 0)) {
    return errorResponse(`${body.reason} cannot increase stock values`, 400, 'reason');
  }

  const now = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE products
       SET stock_quantity = ?, set_stock_quantity = ?, updated_at = ?, version = version + 1
       WHERE id = ? AND version = ?`,
    ).bind(body.quantity, body.setStockQuantity, now, body.productId, body.expectedVersion),
    env.DB.prepare(
      `INSERT INTO stock_movements
         (product_id, quantity_delta, set_stock_delta, reason, note, created_at)
       SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1`,
    ).bind(body.productId, quantityDelta, setStockDelta, body.reason, note, now),
  ]);

  if ((results[0]?.meta.changes ?? 0) !== 1) {
    return errorResponse('Conflict: product changed since it was loaded; please retry', 409, 'expectedVersion');
  }

  const updated = await env.DB.prepare(
    `SELECT products.*,
            (SELECT name FROM locations WHERE id = products.location_id) AS location_name
     FROM products WHERE products.id = ?`,
  ).bind(body.productId).first<Record<string, unknown>>();

  if (!updated) {
    return errorResponse('Product not found', 404, 'productId');
  }

  const product: ProductDTO = {
    id: updated.id as number,
    sku: updated.sku as string | null,
    name: updated.name as string,
    category: updated.category as string | null,
    colour: updated.colour as string | null,
    size: updated.size as string | null,
    pricePaise: updated.selling_price_minor as number,
    mrpPaise: updated.mrp_minor as number | null,
    consultantPricePaise: updated.cost_price_minor as number | null,
    quantity: updated.stock_quantity as number,
    setStockQuantity: updated.set_stock_quantity as number,
    lowStockLevel: updated.low_stock_level as number,
    locationId: updated.location_id as number | null,
    locationName: updated.location_name as string | null,
    personalUse: (updated.personal_use as number) === 1,
    active: (updated.active as number) === 1,
    version: updated.version as number,
    createdAt: updated.created_at as string,
    updatedAt: updated.updated_at as string,
  };

  return jsonResponse({ ok: true, product, quantityDelta, setStockDelta });
}

// ============================================================================

export { handleStockDelivery, handleStockCount, handleStockAdjustment, handleStockChange };

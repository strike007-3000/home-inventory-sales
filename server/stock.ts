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
} from '../shared/contracts';

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

export { handleStockDelivery, handleStockCount, handleStockAdjustment };

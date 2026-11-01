import type {
  CreateSellerRequest, SellerDTO, SellerLedgerEntryDTO, SellerPaymentRequest, SellerSummaryDTO, SellerTransferRequest,
} from '../shared/contracts';
import { errorResponse, jsonResponse, requireJsonBody } from './validation';

const PAYMENT_METHODS = new Set(['upi', 'cash', 'card', 'bank-transfer', 'other']);
const MAX_ITEMS = 50;

// Balance > 0: seller owes us. Stock we gave counts for us, stock we got and cash we paid against us.
const SELLER_SELECT = `SELECT s.id, s.name,
    COALESCE((SELECT SUM(CASE t.direction WHEN 'out' THEN 1 ELSE -1 END * i.quantity * i.unit_value_minor)
      FROM seller_transfers t JOIN seller_transfer_items i ON i.transfer_id = t.id WHERE t.seller_id = s.id), 0)
    + COALESCE((SELECT SUM(CASE p.direction WHEN 'paid' THEN 1 ELSE -1 END * p.amount_minor)
      FROM seller_payments p WHERE p.seller_id = s.id), 0) AS balance_minor
  FROM sellers s`;

type SellerRow = { id: number; name: string; balance_minor: number };

const toSummary = (row: SellerRow): SellerSummaryDTO => ({ id: row.id, name: row.name, balancePaise: row.balance_minor });

async function readSeller(id: number, env: Env): Promise<SellerDTO | null> {
  const row = await env.DB.prepare(`${SELLER_SELECT} WHERE s.id = ?`).bind(id).first<SellerRow>();
  if (!row) return null;
  const transfers = await env.DB.prepare(
    `SELECT t.id, t.direction, t.note, t.sale_id, t.occurred_at, p.name AS product_name, i.quantity, i.unit_value_minor
     FROM seller_transfers t
     JOIN seller_transfer_items i ON i.transfer_id = t.id
     JOIN products p ON p.id = i.product_id
     WHERE t.seller_id = ? ORDER BY t.id, i.id`,
  ).bind(id).all<{
    id: number; direction: 'in' | 'out'; note: string | null; sale_id: number | null; occurred_at: string;
    product_name: string; quantity: number; unit_value_minor: number;
  }>();
  const payments = await env.DB.prepare(
    'SELECT id, direction, amount_minor, payment_method, occurred_at FROM seller_payments WHERE seller_id = ? ORDER BY id',
  ).bind(id).all<{ id: number; direction: 'paid' | 'received'; amount_minor: number; payment_method: string; occurred_at: string }>();

  const byTransfer = new Map<number, Extract<SellerLedgerEntryDTO, { type: 'transfer' }>>();
  for (const r of transfers.results) {
    let entry = byTransfer.get(r.id);
    if (!entry) {
      entry = { type: 'transfer', id: r.id, direction: r.direction, occurredAt: r.occurred_at, note: r.note, saleId: r.sale_id, valuePaise: 0, items: [] };
      byTransfer.set(r.id, entry);
    }
    byTransfer.set(r.id, {
      ...entry,
      valuePaise: entry.valuePaise + r.quantity * r.unit_value_minor,
      items: [...entry.items, { productName: r.product_name, quantity: r.quantity, unitValuePaise: r.unit_value_minor }],
    });
  }
  const entries: SellerLedgerEntryDTO[] = [
    ...byTransfer.values(),
    ...payments.results.map((p): SellerLedgerEntryDTO => ({
      type: 'payment', id: p.id, direction: p.direction, occurredAt: p.occurred_at, amountPaise: p.amount_minor, paymentMethod: p.payment_method,
    })),
  ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id - a.id);
  return { ...toSummary(row), entries };
}

export async function handleListSellers(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(`${SELLER_SELECT} ORDER BY s.name COLLATE NOCASE LIMIT 500`).all<SellerRow>();
  return jsonResponse({ items: rows.results.map(toSummary) });
}

export async function handleGetSeller(id: number, env: Env): Promise<Response> {
  const seller = await readSeller(id, env);
  return seller ? jsonResponse(seller) : errorResponse('Seller not found', 404);
}

export async function handleCreateSeller(request: Request, env: Env): Promise<Response> {
  const body = await requireJsonBody<CreateSellerRequest>(request);
  if (body instanceof Response) return body;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 200) return errorResponse('Seller name is required and must be at most 200 characters', 400, 'name');
  try {
    const result = await env.DB.prepare('INSERT INTO sellers (name, created_at) VALUES (?, ?)')
      .bind(name, new Date().toISOString()).run();
    return jsonResponse(await readSeller(result.meta.last_row_id, env), 201);
  } catch (e) {
    if (e instanceof Error && e.message.includes('sellers.name')) return errorResponse('A seller with this name already exists', 409, 'name');
    throw e;
  }
}

export async function handleSellerTransfer(id: number, request: Request, env: Env): Promise<Response> {
  const body = await requireJsonBody<SellerTransferRequest>(request);
  if (body instanceof Response) return body;
  if (body.direction !== 'in' && body.direction !== 'out') return errorResponse('Direction must be in or out', 400, 'direction');
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > MAX_ITEMS) {
    return errorResponse(`Add between 1 and ${MAX_ITEMS} products`, 400, 'items');
  }
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (note.length > 500) return errorResponse('Note must be at most 500 characters', 400, 'note');

  const totals = new Map<number, number>();
  for (const item of body.items) {
    if (!Number.isSafeInteger(item.productId) || item.productId <= 0) return errorResponse('Invalid product', 400, 'productId');
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) return errorResponse('Quantity must be a positive whole number', 400, 'quantity');
    if (!Number.isSafeInteger(item.unitValuePaise) || item.unitValuePaise < 0) return errorResponse('Value must be zero or more', 400, 'unitValuePaise');
    totals.set(item.productId, (totals.get(item.productId) ?? 0) + item.quantity);
  }
  const seller = await env.DB.prepare('SELECT name FROM sellers WHERE id = ?').bind(id).first<{ name: string }>();
  if (!seller) return errorResponse('Seller not found', 404);

  const ids = [...totals.keys()];
  const stock = await env.DB.prepare(
    `SELECT id, name, stock_quantity FROM products WHERE id IN (${ids.map(() => '?').join(',')})`,
  ).bind(...ids).all<{ id: number; name: string; stock_quantity: number }>();
  if (stock.results.length !== ids.length) return errorResponse('Product not found', 404, 'productId');
  const sign = body.direction === 'in' ? 1 : -1;
  for (const p of stock.results) {
    const next = p.stock_quantity + sign * totals.get(p.id)!;
    if (next < 0) return errorResponse(`Only ${p.stock_quantity} of ${p.name} in stock`, 400, 'quantity');
    if (!Number.isSafeInteger(next)) return errorResponse('Resulting quantity is too large', 400, 'quantity');
  }

  const now = new Date().toISOString();
  const movementNote = `Seller: ${seller.name}`;
  const batch: D1PreparedStatement[] = [
    env.DB.prepare('INSERT INTO seller_transfers (seller_id, direction, note, occurred_at) VALUES (?, ?, ?, ?)')
      .bind(id, body.direction, note || null, now),
    ...body.items.map((item) => env.DB.prepare(
      `INSERT INTO seller_transfer_items (transfer_id, product_id, quantity, unit_value_minor)
       VALUES ((SELECT MAX(id) FROM seller_transfers), ?, ?, ?)`,
    ).bind(item.productId, item.quantity, item.unitValuePaise)),
    ...[...totals].flatMap(([productId, qty]) => [
      // The stock_quantity >= 0 CHECK rolls the whole batch back if stock changed since the read above.
      env.DB.prepare('UPDATE products SET stock_quantity = stock_quantity + ?, updated_at = ?, version = version + 1 WHERE id = ?')
        .bind(sign * qty, now, productId),
      // Existing movement reasons are reused: 'delivery' for stock in, 'other' for stock out.
      env.DB.prepare(
        `INSERT INTO stock_movements (product_id, quantity_delta, reason, note, created_at) VALUES (?, ?, ?, ?, ?)`,
      ).bind(productId, sign * qty, body.direction === 'in' ? 'delivery' : 'other', movementNote, now),
    ]),
  ];
  try {
    await env.DB.batch(batch);
  } catch {
    return errorResponse('Stock changed while saving; please retry', 409, 'quantity');
  }
  return jsonResponse(await readSeller(id, env), 201);
}

export async function handleSellerPayment(id: number, request: Request, env: Env): Promise<Response> {
  const body = await requireJsonBody<SellerPaymentRequest>(request);
  if (body instanceof Response) return body;
  if (body.direction !== 'paid' && body.direction !== 'received') return errorResponse('Direction must be paid or received', 400, 'direction');
  if (!Number.isSafeInteger(body.amountPaise) || body.amountPaise <= 0) return errorResponse('Amount must be a positive safe integer', 400, 'amountPaise');
  if (!PAYMENT_METHODS.has(body.paymentMethod)) return errorResponse('Invalid payment method', 400, 'paymentMethod');
  const inserted = await env.DB.prepare(
    `INSERT INTO seller_payments (seller_id, direction, amount_minor, payment_method, occurred_at)
     SELECT id, ?, ?, ?, ? FROM sellers WHERE id = ?`,
  ).bind(body.direction, body.amountPaise, body.paymentMethod, new Date().toISOString(), id).run();
  if ((inserted.meta.changes ?? 0) !== 1) return errorResponse('Seller not found', 404);
  return jsonResponse(await readSeller(id, env), 201);
}

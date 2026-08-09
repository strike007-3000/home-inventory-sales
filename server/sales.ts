import type { CancelSaleRequest, CreateSaleRequest, PaymentDTO, RecordPaymentRequest, SaleDTO, SaleSummaryDTO } from '../shared/contracts';
import { errorResponse, jsonResponse, requireJsonBody } from './validation';

type ProductRow = {
  id: number;
  name: string;
  stock_quantity: number;
  set_stock_quantity: number;
  version: number;
  active: number;
};

type SaleRow = {
  id: number;
  sale_number: string;
  sold_at: string;
  sale_date: string;
  customer_name: string | null;
  subtotal_minor: number;
  discount_minor: number;
  total_minor: number;
  payment_method: string;
  status: 'completed' | 'cancelled';
  cancelled_at: string | null;
  cancellation_reason: string | null;
};

type SaleItemRow = {
  product_id: number;
  product_name_snapshot: string;
  unit_price_minor: number;
  quantity: number;
  line_total_minor: number;
  set_stock_before: number;
  set_stock_after: number;
};

type PaymentRow = {
  id: number;
  amount_minor: number;
  payment_method: string;
  received_at: string;
};

const PAYMENT_METHODS = new Set(['upi', 'cash', 'card', 'bank-transfer', 'other']);

export async function handleListSales(url: URL, env: Env): Promise<Response> {
  const query = url.searchParams.get('q')?.trim() ?? '';
  const limitValue = Number(url.searchParams.get('limit') ?? 250);
  const limit = Number.isSafeInteger(limitValue) ? Math.min(Math.max(limitValue, 1), 500) : 250;
  const pattern = `%${query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
  const rows = await env.DB.prepare(
    `SELECT s.id, s.sale_number, s.sale_date, s.customer_name, s.total_minor, s.status,
            COALESCE(SUM(p.amount_minor), 0) AS paid_minor
     FROM sales s
     LEFT JOIN sale_payments p ON p.sale_id = s.id
     WHERE (? = '' OR s.sale_number LIKE ? ESCAPE '\\' COLLATE NOCASE
       OR COALESCE(s.customer_name, '') LIKE ? ESCAPE '\\' COLLATE NOCASE)
     GROUP BY s.id
     ORDER BY s.sale_date DESC, s.id DESC
     LIMIT ?`,
  ).bind(query, pattern, pattern, limit).all<{
    id: number; sale_number: string; sale_date: string; customer_name: string | null;
    total_minor: number; status: 'completed' | 'cancelled'; paid_minor: number;
  }>();
  const items: SaleSummaryDTO[] = rows.results.map((row) => {
    const balancePaise = Math.max(0, row.total_minor - row.paid_minor);
    return {
      id: row.id,
      saleNumber: row.sale_number,
      saleDate: row.sale_date,
      customerName: row.customer_name,
      totalPaise: row.total_minor,
      paidPaise: row.paid_minor,
      balancePaise,
      paymentStatus: row.paid_minor === 0 ? 'unpaid' : balancePaise === 0 ? 'paid' : 'partial',
      status: row.status,
    };
  });
  return jsonResponse({ items });
}

function isNonNegativeMoney(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

async function readSale(id: number, env: Env): Promise<SaleDTO | null> {
  const sale = await env.DB.prepare(
    `SELECT id, sale_number, sold_at, sale_date, customer_name, subtotal_minor, discount_minor, total_minor,
            payment_method, status, cancelled_at, cancellation_reason
     FROM sales WHERE id = ?`,
  ).bind(id).first<SaleRow>();
  if (!sale) return null;

  const items = await env.DB.prepare(
    `SELECT product_id, product_name_snapshot, unit_price_minor, quantity,
            line_total_minor, set_stock_before, set_stock_after
     FROM sale_items WHERE sale_id = ? ORDER BY id`,
  ).bind(id).all<SaleItemRow>();
  const paymentRows = await env.DB.prepare(
    `SELECT id, amount_minor, payment_method, received_at
     FROM sale_payments WHERE sale_id = ? ORDER BY id`,
  ).bind(id).all<PaymentRow>();
  const payments: PaymentDTO[] = paymentRows.results.map((payment) => ({
    id: payment.id,
    amountPaise: payment.amount_minor,
    paymentMethod: payment.payment_method,
    receivedAt: payment.received_at,
  }));
  const paidPaise = payments.reduce((sum, payment) => sum + payment.amountPaise, 0);
  const balancePaise = Math.max(0, sale.total_minor - paidPaise);

  return {
    id: sale.id,
    saleNumber: sale.sale_number,
    soldAt: sale.sold_at,
    saleDate: sale.sale_date,
    customerName: sale.customer_name,
    lines: items.results.map((item) => ({
      productId: item.product_id,
      productName: item.product_name_snapshot,
      quantity: item.quantity,
      unitPricePaise: item.unit_price_minor,
      lineTotalPaise: item.line_total_minor,
      setStockBefore: item.set_stock_before,
      setStockAfter: item.set_stock_after,
    })),
    subtotalPaise: sale.subtotal_minor,
    discountPaise: sale.discount_minor,
    totalPaise: sale.total_minor,
    paymentMethod: sale.payment_method,
    paidPaise,
    balancePaise,
    paymentStatus: paidPaise === 0 ? 'unpaid' : balancePaise === 0 ? 'paid' : 'partial',
    payments,
    status: sale.status,
    ...(sale.cancelled_at ? { cancelledAt: sale.cancelled_at } : {}),
    ...(sale.cancellation_reason ? { cancellationReason: sale.cancellation_reason } : {}),
  };
}

export async function handleCreateSale(request: Request, env: Env): Promise<Response> {
  const body = await requireJsonBody<CreateSaleRequest>(request);
  if (body instanceof Response) return body;
  if (!body.idempotencyKey?.trim() || body.idempotencyKey.length > 100) {
    return errorResponse('Idempotency key is required and must be at most 100 characters', 400, 'idempotencyKey');
  }
  if (!Array.isArray(body.lines) || body.lines.length === 0 || body.lines.length > 100) {
    return errorResponse('Sale must contain between 1 and 100 lines', 400, 'lines');
  }
  if (!isNonNegativeMoney(body.discountPaise)) {
    return errorResponse('Discount must be a non-negative safe integer', 400, 'discountPaise');
  }
  if (!PAYMENT_METHODS.has(body.paymentMethod)) {
    return errorResponse('Invalid payment method', 400, 'paymentMethod');
  }
  if (!isNonNegativeMoney(body.receivedPaise)) {
    return errorResponse('Amount received must be a non-negative safe integer', 400, 'receivedPaise');
  }
  if (typeof body.saleDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.saleDate)) {
    return errorResponse('Sale date must be a valid date', 400, 'saleDate');
  }
  const parsedSaleDate = new Date(`${body.saleDate}T00:00:00Z`);
  if (Number.isNaN(parsedSaleDate.getTime()) || parsedSaleDate.toISOString().slice(0, 10) !== body.saleDate) {
    return errorResponse('Sale date must be a valid date', 400, 'saleDate');
  }
  const customerName = body.customerName?.trim() || null;
  if (customerName && customerName.length > 200) {
    return errorResponse('Customer name must be at most 200 characters', 400, 'customerName');
  }

  const existing = await env.DB.prepare('SELECT id FROM sales WHERE idempotency_key = ?')
    .bind(body.idempotencyKey.trim()).first<{ id: number }>();
  if (existing) return jsonResponse(await readSale(existing.id, env));

  const seen = new Set<number>();
  for (const line of body.lines) {
    if (!Number.isSafeInteger(line.productId) || line.productId <= 0) {
      return errorResponse('Product ID must be a positive safe integer', 400, 'productId');
    }
    if (seen.has(line.productId)) return errorResponse('A product may appear only once per sale', 400, 'lines');
    seen.add(line.productId);
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      return errorResponse('Quantity must be a positive safe integer', 400, 'quantity');
    }
    if (!isNonNegativeMoney(line.unitPricePaise)) {
      return errorResponse('Unit price must be a non-negative safe integer', 400, 'unitPricePaise');
    }
    if (!isNonNegativeFinite(line.setStockAfter)) {
      return errorResponse('Stock/set count must be a non-negative number', 400, 'setStockAfter');
    }
  }

  const ids = [...seen];
  const placeholders = ids.map(() => '?').join(',');
  const rows = await env.DB.prepare(
    `SELECT id, name, stock_quantity, set_stock_quantity, version, active
     FROM products WHERE id IN (${placeholders})`,
  ).bind(...ids).all<ProductRow>();
  const products = new Map(rows.results.map((row) => [row.id, row]));

  let subtotal = 0;
  for (const line of body.lines) {
    const product = products.get(line.productId);
    if (!product || !product.active) return errorResponse(`Product ${line.productId} is not available`, 404, 'productId');
    if (line.quantity > product.stock_quantity) return errorResponse(`Not enough stock for ${product.name}`, 409, 'quantity');
    const lineTotal = line.unitPricePaise * line.quantity;
    if (!Number.isSafeInteger(lineTotal) || !Number.isSafeInteger(subtotal + lineTotal)) {
      return errorResponse('Sale total exceeds the safe integer range', 400, 'unitPricePaise');
    }
    subtotal += lineTotal;
  }
  if (body.discountPaise > subtotal) return errorResponse('Discount cannot exceed subtotal', 400, 'discountPaise');
  const total = subtotal - body.discountPaise;
  if (body.receivedPaise > total) return errorResponse('Amount received cannot exceed sale total', 400, 'receivedPaise');

  const now = new Date().toISOString();
  const saleNumber = `SALE-${now.slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const key = body.idempotencyKey.trim();
  const guards = body.lines.map(() =>
    `EXISTS (SELECT 1 FROM products WHERE id = ? AND active = 1 AND stock_quantity = ? AND set_stock_quantity = ? AND version = ?)`,
  ).join(' AND ');
  const guardValues = body.lines.flatMap((line) => {
    const product = products.get(line.productId)!;
    return [line.productId, product.stock_quantity, product.set_stock_quantity, product.version];
  });
  const batch: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO sales (sale_number, sold_at, sale_date, customer_name, subtotal_minor, discount_minor, total_minor, status, payment_method, idempotency_key)
       SELECT ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ? WHERE ${guards}`,
    ).bind(saleNumber, now, body.saleDate, customerName, subtotal, body.discountPaise, subtotal - body.discountPaise, body.paymentMethod, key, ...guardValues),
  ];
  if (body.receivedPaise > 0) {
    batch.push(env.DB.prepare(
      `INSERT INTO sale_payments (sale_id, amount_minor, payment_method, received_at)
       SELECT id, ?, ?, ? FROM sales WHERE idempotency_key = ?`,
    ).bind(body.receivedPaise, body.paymentMethod, now, key));
  }

  for (const line of body.lines) {
    const product = products.get(line.productId)!;
    batch.push(env.DB.prepare(
      `UPDATE products SET stock_quantity = stock_quantity - ?, set_stock_quantity = ?, updated_at = ?, version = version + 1
       WHERE id = ? AND version = ? AND EXISTS (SELECT 1 FROM sales WHERE idempotency_key = ?)`,
    ).bind(line.quantity, line.setStockAfter, now, line.productId, product.version, key));
    batch.push(env.DB.prepare(
      `INSERT INTO sale_items (sale_id, product_id, product_name_snapshot, unit_price_minor, quantity, line_total_minor, set_stock_before, set_stock_after)
       SELECT id, ?, ?, ?, ?, ?, ?, ? FROM sales WHERE idempotency_key = ?`,
    ).bind(line.productId, product.name, line.unitPricePaise, line.quantity, line.unitPricePaise * line.quantity,
      product.set_stock_quantity, line.setStockAfter, key));
    batch.push(env.DB.prepare(
      `INSERT INTO stock_movements (product_id, quantity_delta, set_stock_delta, reason, sale_id, note, created_at)
       SELECT ?, ?, ?, 'sale', id, ?, ? FROM sales WHERE idempotency_key = ?`,
    ).bind(line.productId, -line.quantity, line.setStockAfter - product.set_stock_quantity,
      `Sold ${line.quantity} unit${line.quantity === 1 ? '' : 's'}`, now, key));
  }

  try {
    const results = await env.DB.batch(batch);
    if ((results[0]?.meta.changes ?? 0) !== 1) return errorResponse('Stock changed while completing the sale; please review and retry', 409);
  } catch {
    const duplicate = await env.DB.prepare('SELECT id FROM sales WHERE idempotency_key = ?').bind(key).first<{ id: number }>();
    if (duplicate) return jsonResponse(await readSale(duplicate.id, env));
    return errorResponse('Sale failed; no changes were made', 500);
  }
  const created = await env.DB.prepare('SELECT id FROM sales WHERE idempotency_key = ?').bind(key).first<{ id: number }>();
  return jsonResponse(await readSale(created!.id, env), 201);
}

export async function handleGetSale(id: number, env: Env): Promise<Response> {
  const sale = await readSale(id, env);
  return sale ? jsonResponse(sale) : errorResponse('Sale not found', 404);
}

export async function handleRecordPayment(id: number, request: Request, env: Env): Promise<Response> {
  const body = await requireJsonBody<RecordPaymentRequest>(request);
  if (body instanceof Response) return body;
  if (!Number.isSafeInteger(body.amountPaise) || body.amountPaise <= 0) {
    return errorResponse('Payment amount must be a positive safe integer', 400, 'amountPaise');
  }
  if (!PAYMENT_METHODS.has(body.paymentMethod)) {
    return errorResponse('Invalid payment method', 400, 'paymentMethod');
  }

  const sale = await readSale(id, env);
  if (!sale) return errorResponse('Sale not found', 404);
  if (sale.status === 'cancelled') return errorResponse('Cannot add payment to a cancelled sale', 409);
  if (body.amountPaise > sale.balancePaise) return errorResponse('Payment cannot exceed the outstanding balance', 400, 'amountPaise');

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO sale_payments (sale_id, amount_minor, payment_method, received_at)
     SELECT ?, ?, ?, ?
     WHERE ? <= (
       SELECT total_minor - COALESCE((SELECT SUM(amount_minor) FROM sale_payments WHERE sale_id = sales.id), 0)
       FROM sales WHERE id = ? AND status = 'completed'
     )`,
  ).bind(id, body.amountPaise, body.paymentMethod, now, body.amountPaise, id).run();

  const updated = await readSale(id, env);
  if (!updated || updated.paidPaise === sale.paidPaise) {
    return errorResponse('Payment balance changed; please review and retry', 409);
  }
  return jsonResponse(updated, 201);
}

export async function handleCancelSale(id: number, request: Request, env: Env): Promise<Response> {
  const body = await requireJsonBody<CancelSaleRequest>(request);
  if (body instanceof Response) return body;
  const reason = body.reason?.trim();
  if (!reason || reason.length > 500) return errorResponse('Cancellation reason is required and must be at most 500 characters', 400, 'reason');

  const sale = await env.DB.prepare('SELECT id, status FROM sales WHERE id = ?').bind(id).first<{ id: number; status: string }>();
  if (!sale) return errorResponse('Sale not found', 404);
  if (sale.status === 'cancelled') return errorResponse('Sale is already cancelled', 409);
  const itemRows = await env.DB.prepare(
    `SELECT si.product_id, si.quantity, si.set_stock_before, si.set_stock_after,
            p.set_stock_quantity, p.version
     FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = ? ORDER BY si.id`,
  ).bind(id).all<{ product_id: number; quantity: number; set_stock_before: number; set_stock_after: number; set_stock_quantity: number; version: number }>();
  for (const item of itemRows.results) {
    if (item.set_stock_quantity + item.set_stock_before - item.set_stock_after < 0) {
      return errorResponse('Set stock changed after this sale and cannot be safely reversed; correct stock first', 409);
    }
  }
  const now = new Date().toISOString();
  const batch: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO sale_cancellations (sale_id, reason, cancelled_at)
       SELECT id, ?, ? FROM sales WHERE id = ? AND status = 'completed'`,
    ).bind(reason, now, id),
  ];
  for (const item of itemRows.results) {
    const setDelta = item.set_stock_before - item.set_stock_after;
    batch.push(env.DB.prepare(
      `UPDATE products SET stock_quantity = stock_quantity + ?, set_stock_quantity = set_stock_quantity + ?, updated_at = ?, version = version + 1
       WHERE id = ? AND version = ? AND EXISTS (SELECT 1 FROM sale_cancellations WHERE sale_id = ?)`,
    ).bind(item.quantity, setDelta, now, item.product_id, item.version, id));
    batch.push(env.DB.prepare(
      `INSERT INTO stock_movements (product_id, quantity_delta, set_stock_delta, reason, sale_id, note, created_at)
       SELECT ?, ?, ?, 'cancellation', ?, ?, ? WHERE changes() = 1`,
    ).bind(item.product_id, item.quantity, setDelta, id, reason, now));
  }
  batch.push(env.DB.prepare(
    `UPDATE sales SET status = 'cancelled', cancelled_at = ?, cancellation_reason = ?
     WHERE id = ? AND EXISTS (SELECT 1 FROM sale_cancellations WHERE sale_id = ?)`,
  ).bind(now, reason, id, id));
  try {
    const results = await env.DB.batch(batch);
    if ((results[0]?.meta.changes ?? 0) !== 1) return errorResponse('Sale could not be cancelled', 409);
  } catch {
    return errorResponse('Cancellation failed; no changes were made', 500);
  }
  return jsonResponse(await readSale(id, env));
}

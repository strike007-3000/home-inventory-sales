import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { handleCancelSale } from '../../server/sales';

const ORIGIN = 'https://inventory.example.test';
const PASSWORD = 'worker-test-password';
let session = '';
let csrf = '';
let requestNumber = 0;

function request(path: string, init: RequestInit = {}): Request {
  requestNumber += 1;
  const headers = new Headers(init.headers);
  headers.set('CF-Connecting-IP', `198.51.100.${requestNumber}`);
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
}

async function api(path: string, method = 'GET', body?: unknown): Promise<Response> {
  return exports.default.fetch(request(path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`,
      'X-CSRF-Token': csrf,
      Origin: ORIGIN,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}

async function addProduct(quantity = 8, setStock = 2, unitsPerSet: number | null = 4): Promise<number> {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO products (name, selling_price_minor, stock_quantity, set_stock_quantity,
      units_per_set, low_stock_level, active, version, created_at, updated_at)
     VALUES ('Demo Set', 15000, ?, ?, ?, 1, 1, 1, ?, ?)`,
  ).bind(quantity, setStock, unitsPerSet, now, now).run();
  return Number(result.meta.last_row_id);
}

async function addConfiguredBottle(quantity = 14): Promise<number> {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO products (name, selling_price_minor, mrp_minor, cost_price_minor,
      stock_quantity, set_stock_quantity, units_per_set, low_stock_level, active, version, created_at, updated_at)
     VALUES ('310 ML Bottles', 66000, 88000, 50160, ?, 3.5, 4, 1, 1, 1, ?, ?)`,
  ).bind(quantity, now, now).run();
  return Number(result.meta.last_row_id);
}

beforeEach(async () => {
  const login = await exports.default.fetch(request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ password: PASSWORD }),
  }));
  expect(login.status).toBe(200);
  const cookies = login.headers.getSetCookie();
  session = cookies.find((value) => value.startsWith('__Host-session='))!.split('=')[1]!.split(';')[0]!;
  csrf = cookies.find((value) => value.startsWith('__Host-csrf='))!.split('=')[1]!.split(';')[0]!;
});

describe('Sale API', () => {
  it('prices configured products proportionally and derives Stock/set from QTY', async () => {
    const productId = await addConfiguredBottle();
    const onePiece = await api('/api/sales', 'POST', {
      idempotencyKey: 'configured-one-piece', saleDate: '2026-07-15',
      lines: [{ productId, quantity: 1, setPricePaise: 66000 }],
      discountPaise: 0, paymentMethod: 'cash', receivedPaise: 16500,
    });
    expect(onePiece.status).toBe(201);
    expect(await onePiece.json<any>()).toMatchObject({
      subtotalPaise: 16500,
      lines: [{ quantity: 1, lineTotalPaise: 16500, unitsPerSet: 4, setPricePaise: 66000, setStockAfter: 3.25 }],
    });

    const oneSet = await api('/api/sales', 'POST', {
      idempotencyKey: 'configured-one-set', saleDate: '2026-07-15',
      lines: [{ productId, quantity: 4, setPricePaise: 66000 }],
      discountPaise: 0, paymentMethod: 'upi', receivedPaise: 66000,
    });
    expect(oneSet.status).toBe(201);
    const oneSetSale = await oneSet.json<any>();
    expect(oneSetSale).toMatchObject({ subtotalPaise: 66000, lines: [{ lineTotalPaise: 66000 }] });
    expect(await env.DB.prepare('SELECT stock_quantity, set_stock_quantity FROM products WHERE id = ?')
      .bind(productId).first<any>()).toMatchObject({ stock_quantity: 9, set_stock_quantity: 2.25 });

    const cancelled = await api(`/api/sales/${oneSetSale.id}/cancel`, 'POST', { reason: 'Configured reversal' });
    expect(cancelled.status).toBe(200);
    expect(await env.DB.prepare('SELECT stock_quantity, set_stock_quantity FROM products WHERE id = ?')
      .bind(productId).first<any>()).toMatchObject({ stock_quantity: 13, set_stock_quantity: 3.25 });
  });

  it('sells inconsistent configured stock from the saved Stock/set and clamps at zero', async () => {
    const productId = await addConfiguredBottle(1);
    await env.DB.prepare('UPDATE products SET set_stock_quantity = 0.5, units_per_set = 1 WHERE id = ?').bind(productId).run();
    const response = await api('/api/sales', 'POST', {
      idempotencyKey: 'inconsistent-stock', saleDate: '2026-07-15',
      lines: [{ productId, quantity: 1, setPricePaise: 66000 }],
      discountPaise: 0, paymentMethod: 'cash', receivedPaise: 66000,
    });

    expect(response.status).toBe(201);
    expect(await response.json<any>()).toMatchObject({
      lines: [{ setStockBefore: 0.5, setStockAfter: 0 }],
    });
    expect(await env.DB.prepare('SELECT stock_quantity, set_stock_quantity FROM products WHERE id = ?').bind(productId).first<any>())
      .toMatchObject({ stock_quantity: 0, set_stock_quantity: 0 });
    expect(await env.DB.prepare("SELECT quantity_delta, set_stock_delta FROM stock_movements WHERE product_id = ? AND reason = 'sale'")
      .bind(productId).first<any>()).toMatchObject({ quantity_delta: -1, set_stock_delta: -0.5 });
  });

  it('sells the final piece from a valid half set to exact zero', async () => {
    const productId = await addConfiguredBottle(1);
    await env.DB.prepare('UPDATE products SET set_stock_quantity = 0.5, units_per_set = 2 WHERE id = ?').bind(productId).run();
    const response = await api('/api/sales', 'POST', {
      idempotencyKey: 'valid-half-set', saleDate: '2026-07-15',
      lines: [{ productId, quantity: 1, setPricePaise: 66000 }],
      discountPaise: 0, paymentMethod: 'cash', receivedPaise: 33000,
    });
    expect(response.status).toBe(201);
    expect(await env.DB.prepare('SELECT stock_quantity, set_stock_quantity FROM products WHERE id = ?').bind(productId).first<any>())
      .toMatchObject({ stock_quantity: 0, set_stock_quantity: 0 });
  });

  it('sells missing Pieces per set using the seller-entered resulting Stock/set', async () => {
    const productId = await addProduct(1, 0.5, null);
    const response = await api('/api/sales', 'POST', {
      idempotencyKey: 'missing-pieces-per-set', saleDate: '2026-07-15',
      lines: [{ productId, quantity: 1, unitPricePaise: 15000, setStockAfter: 0 }],
      discountPaise: 0, paymentMethod: 'cash', receivedPaise: 15000,
    });
    expect(response.status).toBe(201);
    expect(await env.DB.prepare('SELECT stock_quantity, set_stock_quantity FROM products WHERE id = ?').bind(productId).first<any>())
      .toMatchObject({ stock_quantity: 0, set_stock_quantity: 0 });
  });

  it('completes a sale with an edited price and seller-entered set stock', async () => {
    const productId = await addProduct();
    const response = await api('/api/sales', 'POST', {
      idempotencyKey: 'sale-success',
      saleDate: '2026-07-15',
      customerName: '  Anjali Rao  ',
      lines: [{ productId, quantity: 3, setPricePaise: 56000 }],
      discountPaise: 1000,
      paymentMethod: 'upi',
      receivedPaise: 20000,
    });
    expect(response.status).toBe(201);
    const sale = await response.json<any>();
    expect(sale).toMatchObject({ saleDate: '2026-07-15', customerName: 'Anjali Rao', subtotalPaise: 42000, discountPaise: 1000, totalPaise: 41000, paidPaise: 20000, balancePaise: 21000, paymentStatus: 'partial', status: 'completed' });
    expect(sale.lines[0]).toMatchObject({ unitPricePaise: 14000, setStockBefore: 2, setStockAfter: 1.25 });

    const product = await env.DB.prepare('SELECT stock_quantity, set_stock_quantity FROM products WHERE id = ?')
      .bind(productId).first<any>();
    expect(product).toMatchObject({ stock_quantity: 5, set_stock_quantity: 1.25 });
    const movement = await env.DB.prepare("SELECT quantity_delta, set_stock_delta FROM stock_movements WHERE product_id = ? AND reason = 'sale'")
      .bind(productId).first<any>();
    expect(movement).toMatchObject({ quantity_delta: -3, set_stock_delta: -0.75 });
  });

  it('returns the original sale for a repeated idempotency key without reducing stock twice', async () => {
    const productId = await addProduct();
    const payload = {
      idempotencyKey: 'same-submit',
      saleDate: '2026-07-15',
      lines: [{ productId, quantity: 2, setPricePaise: 60000 }],
      discountPaise: 0,
      paymentMethod: 'cash',
      receivedPaise: 0,
    };
    const first = await api('/api/sales', 'POST', payload);
    const second = await api('/api/sales', 'POST', payload);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect((await first.json<any>()).id).toBe((await second.json<any>()).id);
    const product = await env.DB.prepare('SELECT stock_quantity FROM products WHERE id = ?').bind(productId).first<any>();
    expect(product.stock_quantity).toBe(6);
  });

  it('rejects insufficient quantity and leaves no partial sale', async () => {
    const productId = await addProduct(1, 1, 1);
    const response = await api('/api/sales', 'POST', {
      idempotencyKey: 'too-many',
      saleDate: '2026-07-15',
      lines: [{ productId, quantity: 2, setPricePaise: 15000 }],
      discountPaise: 0,
      paymentMethod: 'upi',
      receivedPaise: 0,
    });
    expect(response.status).toBe(409);
    expect((await env.DB.prepare('SELECT COUNT(*) AS count FROM sales').first<any>()).count).toBe(0);
    expect((await env.DB.prepare('SELECT stock_quantity FROM products WHERE id = ?').bind(productId).first<any>()).stock_quantity).toBe(1);
  });

  it('cancels a sale and reverses QTY and set stock through audit history', async () => {
    const productId = await addProduct();
    const created = await api('/api/sales', 'POST', {
      idempotencyKey: 'cancel-me',
      saleDate: '2026-07-15',
      lines: [{ productId, quantity: 3, setPricePaise: 60000 }],
      discountPaise: 0,
      paymentMethod: 'card',
      receivedPaise: 45000,
    });
    const sale = await created.json<any>();
    const cancelled = await api(`/api/sales/${sale.id}/cancel`, 'POST', { reason: 'Customer changed mind' });
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json<any>()).toMatchObject({ status: 'cancelled', cancellationReason: 'Customer changed mind' });
    const product = await env.DB.prepare('SELECT stock_quantity, set_stock_quantity FROM products WHERE id = ?')
      .bind(productId).first<any>();
    expect(product).toMatchObject({ stock_quantity: 8, set_stock_quantity: 2 });
    const movements = await env.DB.prepare('SELECT reason, quantity_delta, set_stock_delta FROM stock_movements WHERE product_id = ? ORDER BY id')
      .bind(productId).all<any>();
    expect(movements.results.slice(-2)).toEqual([
      { reason: 'sale', quantity_delta: -3, set_stock_delta: -0.75 },
      { reason: 'cancellation', quantity_delta: 3, set_stock_delta: 0.75 },
    ]);
  });

  it('restores consolidated sale lines once in current packaging without rewriting history', async () => {
    const canonical = await addProduct(4, 1, 4);
    const duplicate = await addProduct(2, 2, 1);
    const created = await api('/api/sales', 'POST', {
      idempotencyKey: 'consolidated-history', saleDate: '2026-07-15',
      lines: [
        { productId: canonical, quantity: 4, setPricePaise: 20000 },
        { productId: duplicate, quantity: 2, setPricePaise: 7000 },
      ],
      discountPaise: 0, paymentMethod: 'cash', receivedPaise: 34000,
    });
    expect(created.status).toBe(201);
    const sale = await created.json<any>();
    await env.DB.prepare('UPDATE sale_items SET product_id = ? WHERE product_id = ?')
      .bind(canonical, duplicate).run();
    const before = await env.DB.prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id').bind(sale.id).all();
    const payments = await env.DB.prepare('SELECT * FROM sale_payments WHERE sale_id = ?').bind(sale.id).all();

    expect((await api(`/api/sales/${sale.id}/cancel`, 'POST', { reason: 'Synthetic return' })).status).toBe(200);
    expect(await env.DB.prepare('SELECT stock_quantity, set_stock_quantity, version FROM products WHERE id = ?')
      .bind(canonical).first()).toMatchObject({ stock_quantity: 6, set_stock_quantity: 1.5, version: 3 });
    expect((await env.DB.prepare("SELECT product_id, quantity_delta, set_stock_delta FROM stock_movements WHERE sale_id = ? AND reason = 'cancellation'")
      .bind(sale.id).all()).results).toEqual([{ product_id: canonical, quantity_delta: 6, set_stock_delta: 1.5 }]);
    expect((await env.DB.prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id').bind(sale.id).all()).results).toEqual(before.results);
    expect((await env.DB.prepare('SELECT * FROM sale_payments WHERE sale_id = ?').bind(sale.id).all()).results).toEqual(payments.results);
    expect((await api(`/api/sales/${sale.id}/cancel`, 'POST', { reason: 'Repeated return' })).status).toBe(409);
    expect(await env.DB.prepare('SELECT stock_quantity FROM products WHERE id = ?').bind(canonical).first())
      .toMatchObject({ stock_quantity: 6 });
  });

  it('rolls back all cancellation changes when its stock audit cannot be written', async () => {
    const first = await addProduct();
    const second = await addProduct();
    const created = await api('/api/sales', 'POST', {
      idempotencyKey: 'cancel-audit-rollback', saleDate: '2026-07-15',
      lines: [first, second].map((productId) => ({ productId, quantity: 1, setPricePaise: 4000 })),
      discountPaise: 0, paymentMethod: 'cash', receivedPaise: 2000,
    });
    const sale = await created.json<any>();
    await env.DB.prepare(`CREATE TRIGGER fail_cancellation_audit BEFORE INSERT ON stock_movements
      WHEN NEW.reason = 'cancellation' AND NEW.product_id = ${second}
      BEGIN SELECT RAISE(ABORT, 'Synthetic audit failure'); END;`).run();
    try {
      expect((await api(`/api/sales/${sale.id}/cancel`, 'POST', { reason: 'Rollback probe' })).status).toBe(500);
      expect((await env.DB.prepare('SELECT stock_quantity, set_stock_quantity FROM products ORDER BY id').all()).results)
        .toEqual([{ stock_quantity: 7, set_stock_quantity: 1.75 }, { stock_quantity: 7, set_stock_quantity: 1.75 }]);
      expect(await env.DB.prepare('SELECT status FROM sales WHERE id = ?').bind(sale.id).first()).toEqual({ status: 'completed' });
      expect((await env.DB.prepare('SELECT * FROM sale_cancellations').all()).results).toEqual([]);
      expect((await env.DB.prepare("SELECT * FROM stock_movements WHERE reason = 'cancellation'").all()).results).toEqual([]);
    } finally {
      await env.DB.exec('DROP TRIGGER fail_cancellation_audit');
    }
  });

  it('does not cancel partially when stock changes between the read and transaction', async () => {
    const productId = await addProduct();
    const created = await api('/api/sales', 'POST', {
      idempotencyKey: 'cancel-version-conflict', saleDate: '2026-07-15',
      lines: [{ productId, quantity: 1, setPricePaise: 4000 }],
      discountPaise: 0, paymentMethod: 'cash', receivedPaise: 1000,
    });
    const sale = await created.json<any>();
    const db = new Proxy(env.DB, {
      get(target, property) {
        if (property === 'batch') return async (statements: D1PreparedStatement[]) => {
          await target.prepare('UPDATE products SET stock_quantity = 8, set_stock_quantity = 2, version = version + 1 WHERE id = ?')
            .bind(productId).run();
          return target.batch(statements);
        };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const response = await handleCancelSale(sale.id, request('/cancel', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'Conflict probe' }),
    }), { ...env, DB: db });
    expect(response.status).toBe(500);
    expect(await env.DB.prepare('SELECT stock_quantity, set_stock_quantity FROM products WHERE id = ?').bind(productId).first())
      .toEqual({ stock_quantity: 8, set_stock_quantity: 2 });
    expect(await env.DB.prepare('SELECT status FROM sales WHERE id = ?').bind(sale.id).first()).toEqual({ status: 'completed' });
    expect((await env.DB.prepare('SELECT * FROM sale_cancellations').all()).results).toEqual([]);
    expect((await env.DB.prepare("SELECT * FROM stock_movements WHERE reason = 'cancellation'").all()).results).toEqual([]);
  });

  it.each([49, 100])('cancels a historical sale with %i products within D1 binding limits', async (count) => {
    // Seed historical rows directly: creation has its own request validation/limits.
    const productIds: number[] = [];
    for (let i = 0; i < count; i++) productIds.push(await addProduct(0, 0, 2));
    const inserted = await env.DB.prepare(
      `INSERT INTO sales(sale_number,sold_at,sale_date,subtotal_minor,discount_minor,total_minor,status,payment_method)
       VALUES (?, '2000-01-01', '2000-01-01', ?, 0, ?, 'completed', 'cash')`,
    ).bind(`SYNTHETIC-LARGE-${count}`, count * 100, count * 100).run();
    const saleId = Number(inserted.meta.last_row_id);
    await env.DB.batch(productIds.map((productId) => env.DB.prepare(
      `INSERT INTO sale_items(sale_id,product_id,product_name_snapshot,unit_price_minor,quantity,line_total_minor,
        set_stock_before,set_stock_after,units_per_set_snapshot,set_price_minor_snapshot)
       VALUES (?, ?, 'Synthetic large sale', 100, 1, 100, 0.5, 0, 2, 200)`,
    ).bind(saleId, productId)));
    const db = new Proxy(env.DB, {
      get(target, property) {
        if (property === 'prepare') return (sql: string) => {
          const statement = target.prepare(sql);
          return new Proxy(statement, {
            get(prepared, method) {
              if (method === 'bind') return (...values: unknown[]) => {
                expect(values.length).toBeLessThanOrEqual(100);
                return prepared.bind(...values);
              };
              const value = Reflect.get(prepared, method);
              return typeof value === 'function' ? value.bind(prepared) : value;
            },
          });
        };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const response = await handleCancelSale(saleId, request('/cancel', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'Large historical return' }),
    }), { ...env, DB: db });
    expect(response.status).toBe(200);
    expect((await env.DB.prepare('SELECT stock_quantity,set_stock_quantity FROM products').all()).results)
      .toEqual(productIds.map(() => ({ stock_quantity: 1, set_stock_quantity: 0.5 })));
    expect(await env.DB.prepare("SELECT COUNT(*) AS count, SUM(quantity_delta) AS quantity FROM stock_movements WHERE reason = 'cancellation'").first())
      .toEqual({ count, quantity: count });
    expect(await env.DB.prepare('SELECT status FROM sales WHERE id = ?').bind(saleId).first()).toEqual({ status: 'cancelled' });
  });

  it('records later payments without allowing an overpayment', async () => {
    const productId = await addProduct();
    const created = await api('/api/sales', 'POST', {
      idempotencyKey: 'pay-later', saleDate: '2026-07-15',
      lines: [{ productId, quantity: 1, setPricePaise: 60000 }],
      discountPaise: 0, paymentMethod: 'upi', receivedPaise: 0,
    });
    const sale = await created.json<any>();
    expect(sale).toMatchObject({ paidPaise: 0, balancePaise: 15000, paymentStatus: 'unpaid' });

    const payment = await api(`/api/sales/${sale.id}/payments`, 'POST', { amountPaise: 5000, paymentMethod: 'cash' });
    expect(payment.status).toBe(201);
    expect(await payment.json<any>()).toMatchObject({ paidPaise: 5000, balancePaise: 10000, paymentStatus: 'partial' });

    const overpayment = await api(`/api/sales/${sale.id}/payments`, 'POST', { amountPaise: 10001, paymentMethod: 'cash' });
    expect(overpayment.status).toBe(400);
  });

  it('lists sales newest first and searches by customer name', async () => {
    const productId = await addProduct();
    await api('/api/sales', 'POST', {
      idempotencyKey: 'history-one', saleDate: '2026-07-14', customerName: 'Meera Shah',
      lines: [{ productId, quantity: 1, setPricePaise: 60000 }],
      discountPaise: 0, paymentMethod: 'upi', receivedPaise: 5000,
    });
    const response = await api('/api/sales?q=meera&limit=50');
    expect(response.status).toBe(200);
    const body = await response.json<any>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({
      customerName: 'Meera Shah', saleDate: '2026-07-14', totalPaise: 15000,
      paidPaise: 5000, balancePaise: 10000, paymentStatus: 'partial',
    });

    const dashboard = await api('/api/dashboard?date=2026-07-14');
    expect(dashboard.status).toBe(200);
    expect(await dashboard.json<any>()).toMatchObject({
      today: { count: 1, totalPaise: 15000 },
      total: { count: 1, totalPaise: 15000 },
    });
  });

  it('updates sale customerName and saleDate (PUT /sales/:id)', async () => {
    const productId = await addProduct();
    const createdRes = await api('/api/sales', 'POST', {
      idempotencyKey: 'update-metadata-test',
      saleDate: '2026-07-10',
      customerName: 'Original Name',
      lines: [{ productId, quantity: 2, setPricePaise: 60000 }],
      discountPaise: 1000,
      paymentMethod: 'upi',
      receivedPaise: 29000,
    });
    const created = await createdRes.json<any>();
    const originalSoldAt = created.soldAt;

    // Valid update
    const updateRes = await api(`/api/sales/${created.id}`, 'PUT', {
      customerName: '  New Customer  ',
      saleDate: '2026-07-20',
    });
    expect(updateRes.status).toBe(200);
    const updated = await updateRes.json<any>();

    // Trimming and updated fields
    expect(updated.customerName).toBe('New Customer');
    expect(updated.saleDate).toBe('2026-07-20');

    // Preserved fields
    expect(updated.soldAt).toBe(originalSoldAt);
    expect(updated.lines).toEqual(created.lines);
    expect(updated.subtotalPaise).toBe(created.subtotalPaise);
    expect(updated.discountPaise).toBe(created.discountPaise);
    expect(updated.totalPaise).toBe(created.totalPaise);
    expect(updated.paymentMethod).toBe(created.paymentMethod);
    expect(updated.paidPaise).toBe(created.paidPaise);
    expect(updated.balancePaise).toBe(created.balancePaise);
    expect(updated.paymentStatus).toBe(created.paymentStatus);
    expect(updated.status).toBe(created.status);

    // Empty customer name trims to null
    const emptyCustRes = await api(`/api/sales/${created.id}`, 'PUT', {
      customerName: '   ',
    });
    expect(emptyCustRes.status).toBe(200);
    expect((await emptyCustRes.json<any>()).customerName).toBeNull();

    // Confirm updated date affects dashboard date calculations
    const dashOld = await api('/api/dashboard?date=2026-07-10');
    expect((await dashOld.json<any>()).today.count).toBe(0);
    const dashNew = await api('/api/dashboard?date=2026-07-20');
    expect((await dashNew.json<any>()).today.count).toBe(1);

    // Missing sale (404)
    const notFoundRes = await api('/api/sales/999999', 'PUT', { customerName: 'Test' });
    expect(notFoundRes.status).toBe(404);

    // Malformed input validation (invalid date format)
    const badDateRes = await api(`/api/sales/${created.id}`, 'PUT', { saleDate: '2026-13-45' });
    expect(badDateRes.status).toBe(400);

    // Customer name > 200 chars
    const longNameRes = await api(`/api/sales/${created.id}`, 'PUT', { customerName: 'a'.repeat(201) });
    expect(longNameRes.status).toBe(400);

    for (const customerName of [123, {}, ['Customer']]) {
      const badCustomerRes = await api(`/api/sales/${created.id}`, 'PUT', { customerName });
      expect(badCustomerRes.status).toBe(400);
      expect(await badCustomerRes.json<any>()).toMatchObject({ field: 'customerName' });
    }
  });

  it('handles explicit gift sales creation, stock deduction, and cancellation', async () => {
    const productId = await addProduct();
    const giftRes = await api('/api/sales', 'POST', {
      idempotencyKey: 'gift-sale-1',
      saleDate: '2026-08-20',
      customerName: 'Gift Recipient',
      isGift: true,
      lines: [{ productId, quantity: 2, unitPricePaise: 15000, setStockAfter: 1.5 }],
      discountPaise: 0,
      paymentMethod: 'other',
      receivedPaise: 0,
    });
    expect(giftRes.status).toBe(201);
    const giftSale = await giftRes.json<any>();
    expect(giftSale).toMatchObject({
      isGift: true,
      totalPaise: 0,
      paidPaise: 0,
      balancePaise: 0,
      paymentStatus: 'paid',
      payments: [],
    });

    const product = await env.DB.prepare('SELECT stock_quantity FROM products WHERE id = ?').bind(productId).first<any>();
    expect(product.stock_quantity).toBe(6);

    const listRes = await api('/api/sales');
    const listBody = await listRes.json<any>();
    const summary = listBody.items.find((item: any) => item.id === giftSale.id);
    expect(summary).toMatchObject({ isGift: true, paymentStatus: 'paid', totalPaise: 0, paidPaise: 0, balancePaise: 0 });

    const cancelRes = await api(`/api/sales/${giftSale.id}/cancel`, 'POST', { reason: 'Gift returned' });
    expect(cancelRes.status).toBe(200);
    const restoredProduct = await env.DB.prepare('SELECT stock_quantity FROM products WHERE id = ?').bind(productId).first<any>();
    expect(restoredProduct.stock_quantity).toBe(8);
  });

  it('handles configured Gift products with setPricePaise', async () => {
    const productId = await addConfiguredBottle();
    const giftRes = await api('/api/sales', 'POST', {
      idempotencyKey: 'configured-gift-set-price',
      saleDate: '2026-08-20',
      isGift: true,
      lines: [{ productId, quantity: 4, setPricePaise: 66000 }],
      discountPaise: 0,
      paymentMethod: 'other',
      receivedPaise: 0,
    });
    expect(giftRes.status).toBe(201);
    const giftSale = await giftRes.json<any>();
    expect(giftSale).toMatchObject({
      isGift: true,
      totalPaise: 0,
      paidPaise: 0,
      balancePaise: 0,
      paymentStatus: 'paid',
      payments: [],
      lines: [{ quantity: 4, lineTotalPaise: 66000, unitsPerSet: 4, setPricePaise: 66000, setStockAfter: 2.5 }],
    });
    const product = await env.DB.prepare('SELECT stock_quantity, set_stock_quantity FROM products WHERE id = ?').bind(productId).first<any>();
    expect(product).toMatchObject({ stock_quantity: 10, set_stock_quantity: 2.5 });
  });

  it('handles configured Gift products with unitPricePaise fallback', async () => {
    const productId = await addConfiguredBottle();
    const giftRes = await api('/api/sales', 'POST', {
      idempotencyKey: 'configured-gift-unit-price',
      saleDate: '2026-08-20',
      isGift: true,
      lines: [{ productId, quantity: 4, unitPricePaise: 16500 }],
      discountPaise: 0,
      paymentMethod: 'other',
      receivedPaise: 0,
    });
    expect(giftRes.status).toBe(201);
    const giftSale = await giftRes.json<any>();
    expect(giftSale).toMatchObject({
      isGift: true,
      totalPaise: 0,
      paidPaise: 0,
      balancePaise: 0,
      paymentStatus: 'paid',
      payments: [],
      lines: [{ quantity: 4, lineTotalPaise: 66000, unitsPerSet: 4, setPricePaise: 66000, setStockAfter: 2.5 }],
    });
    const product = await env.DB.prepare('SELECT stock_quantity, set_stock_quantity FROM products WHERE id = ?').bind(productId).first<any>();
    expect(product).toMatchObject({ stock_quantity: 10, set_stock_quantity: 2.5 });
  });

  it('uses a zero price fallback for configured Gift products without price', async () => {
    const productId = await addConfiguredBottle();
    const giftRes = await api('/api/sales', 'POST', {
      idempotencyKey: 'configured-gift-no-price',
      saleDate: '2026-08-20',
      isGift: true,
      lines: [{ productId, quantity: 4 }],
      discountPaise: 0,
      paymentMethod: 'other',
      receivedPaise: 0,
    });
    expect(giftRes.status).toBe(201);
    expect(await giftRes.json<any>()).toMatchObject({
      isGift: true,
      totalPaise: 0,
      lines: [{ quantity: 4, lineTotalPaise: 0, setPricePaise: 0, setStockAfter: 2.5 }],
    });
    expect(await env.DB.prepare('SELECT stock_quantity, set_stock_quantity FROM products WHERE id = ?').bind(productId).first<any>())
      .toMatchObject({ stock_quantity: 10, set_stock_quantity: 2.5 });
  });

  it('allows marking eligible ₹0 completed sales as gift and rejects invalid conversions', async () => {
    const productId = await addProduct();

    const zeroRes = await api('/api/sales', 'POST', {
      idempotencyKey: 'zero-sale-1',
      saleDate: '2026-08-20',
      lines: [{ productId, quantity: 1, unitPricePaise: 0, setStockAfter: 1.75 }],
      discountPaise: 0,
      paymentMethod: 'upi',
      receivedPaise: 0,
    });
    const zeroSale = await zeroRes.json<any>();
    expect(zeroSale.isGift).toBe(false);

    const markRes = await api(`/api/sales/${zeroSale.id}`, 'PUT', { isGift: true });
    expect(markRes.status).toBe(200);
    const markedSale = await markRes.json<any>();
    expect(markedSale.isGift).toBe(true);

    const nonZeroRes = await api('/api/sales', 'POST', {
      idempotencyKey: 'nonzero-sale-1',
      saleDate: '2026-08-20',
      lines: [{ productId, quantity: 1, unitPricePaise: 1000, setStockAfter: 1.5 }],
      discountPaise: 0,
      paymentMethod: 'cash',
      receivedPaise: 1000,
    });
    const nonZeroSale = await nonZeroRes.json<any>();
    const badMarkRes = await api(`/api/sales/${nonZeroSale.id}`, 'PUT', { isGift: true });
    expect(badMarkRes.status).toBe(409);
  });

  it('edits individual payment method and audits the correction', async () => {
    const productId = await addProduct();
    const createdRes = await api('/api/sales', 'POST', {
      idempotencyKey: 'multi-pay-sale',
      saleDate: '2026-08-20',
      lines: [{ productId, quantity: 2, unitPricePaise: 10000, setStockAfter: 1.5 }],
      discountPaise: 0,
      paymentMethod: 'cash',
      receivedPaise: 5000,
    });
    const sale = await createdRes.json<any>();
    const paymentId = sale.payments[0].id;

    const editRes = await api(`/api/sales/${sale.id}/payments/${paymentId}`, 'PUT', { paymentMethod: 'upi' });
    expect(editRes.status).toBe(200);
    const updatedSale = await editRes.json<any>();
    expect(updatedSale.payments[0]).toMatchObject({ id: paymentId, amountPaise: 5000, paymentMethod: 'upi' });

    const auditRow = await env.DB.prepare('SELECT old_payment_method, new_payment_method FROM sale_payment_corrections WHERE payment_id = ?').bind(paymentId).first<any>();
    expect(auditRow).toMatchObject({ old_payment_method: 'cash', new_payment_method: 'upi' });

    // Concurrent modification conflict when expected old method does not match DB state
    const staleEditRes = await api(`/api/sales/${sale.id}/payments/${paymentId}`, 'PUT', { paymentMethod: 'cash' });
    // Sending same method returns early 200 without changes
    expect(staleEditRes.status).toBe(200);
  });

  it('rejects non-boolean isGift values in sale creation', async () => {
    const productId = await addProduct();
    for (const badValue of ['false', 1, {}, [true]]) {
      const response = await api('/api/sales', 'POST', {
        idempotencyKey: `bad-gift-${Math.random()}`,
        saleDate: '2026-08-20',
        isGift: badValue,
        lines: [{ productId, quantity: 1, unitPricePaise: 1000, setStockAfter: 1.5 }],
        discountPaise: 0,
        paymentMethod: 'upi',
        receivedPaise: 1000,
      });
      expect(response.status).toBe(400);
      expect(await response.json<any>()).toMatchObject({ field: 'isGift' });
    }
  });

  it('rolls back a payment method correction when its audit insert fails', async () => {
    const productId = await addProduct();
    const createdRes = await api('/api/sales', 'POST', {
      idempotencyKey: 'atomic-correction-test',
      saleDate: '2026-08-20',
      lines: [{ productId, quantity: 2, unitPricePaise: 10000, setStockAfter: 1.5 }],
      discountPaise: 0,
      paymentMethod: 'cash',
      receivedPaise: 5000,
    });
    const sale = await createdRes.json<any>();
    const paymentId = sale.payments[0].id;

    await env.DB.prepare(
      `CREATE TRIGGER fail_payment_correction
       BEFORE INSERT ON sale_payment_corrections
       BEGIN
         SELECT RAISE(ABORT, 'forced audit failure');
       END`,
    ).run();
    try {
      const editRes = await api(`/api/sales/${sale.id}/payments/${paymentId}`, 'PUT', { paymentMethod: 'upi' });
      expect(editRes.status).toBe(500);
    } finally {
      await env.DB.prepare('DROP TRIGGER fail_payment_correction').run();
    }

    expect(await env.DB.prepare('SELECT payment_method FROM sale_payments WHERE id = ?').bind(paymentId).first<any>())
      .toMatchObject({ payment_method: 'cash' });
    expect(await env.DB.prepare('SELECT id FROM sale_payment_corrections WHERE payment_id = ?').bind(paymentId).first<any>())
      .toBeNull();
  });
});

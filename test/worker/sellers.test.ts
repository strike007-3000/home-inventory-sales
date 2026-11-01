import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

const ORIGIN = 'https://inventory.example.test';
const PASSWORD = 'worker-test-password';
let session = '';
let csrf = '';
let requestNumber = 0;
let productNumber = 0;

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
     VALUES (?, 15000, ?, ?, ?, 1, 1, 1, ?, ?)`,
  ).bind(`Seller Demo ${++productNumber}`, quantity, setStock, unitsPerSet, now, now).run();
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

describe('Seller ledger', () => {
  const stockOf = async (id: number) =>
    (await env.DB.prepare('SELECT stock_quantity AS q FROM products WHERE id = ?').bind(id).first<{ q: number }>())!.q;
  const newSeller = async (name: string) => ((await (await api('/api/sellers', 'POST', { name })).json()) as { id: number }).id;
  const transfer = (id: number, direction: 'in' | 'out', productId: number, quantity: number, unitValuePaise: number) =>
    api(`/api/sellers/${id}/transfers`, 'POST', { direction, items: [{ productId, quantity, unitValuePaise }] });

  it('settles a borrow with a different product and the rest in cash', async () => {
    const seller = await newSeller(`Ravi ${++productNumber}`);
    const a = await addProduct(0, 0, null);
    const b = await addProduct(10, 0, null);

    // They give us 5 of A at ₹100 each: we owe ₹500.
    let res = await transfer(seller, 'in', a, 5, 10000);
    expect(res.status).toBe(201);
    expect(((await res.json()) as { balancePaise: number }).balancePaise).toBe(-50000);
    expect(await stockOf(a)).toBe(5);

    // We hand back 3 of B at ₹140 (₹420): we still owe ₹80.
    res = await transfer(seller, 'out', b, 3, 14000);
    expect(((await res.json()) as { balancePaise: number }).balancePaise).toBe(-8000);
    expect(await stockOf(b)).toBe(7);

    // Cash settles the rest.
    res = await api(`/api/sellers/${seller}/payments`, 'POST', { direction: 'paid', amountPaise: 8000, paymentMethod: 'upi' });
    const final = await res.json() as { balancePaise: number; entries: unknown[] };
    expect(final.balancePaise).toBe(0);
    expect(final.entries).toHaveLength(3);
  });

  it('tracks stock lent out and rejects giving more than we hold', async () => {
    const seller = await newSeller(`Meena ${++productNumber}`);
    const p = await addProduct(4, 0, null);
    expect((await transfer(seller, 'out', p, 5, 10000)).status).toBe(400);
    const res = await transfer(seller, 'out', p, 4, 10000);
    expect(((await res.json()) as { balancePaise: number }).balancePaise).toBe(40000);
    expect(await stockOf(p)).toBe(0);
    const paid = await api(`/api/sellers/${seller}/payments`, 'POST', { direction: 'received', amountPaise: 40000, paymentMethod: 'cash' });
    expect(((await paid.json()) as { balancePaise: number }).balancePaise).toBe(0);
  });

  it('rejects duplicate seller names', async () => {
    const name = `Dup ${++productNumber}`;
    await newSeller(name);
    expect((await api('/api/sellers', 'POST', { name: name.toUpperCase() })).status).toBe(409);
  });

  it('records stock borrowed to fulfil a sale on the seller ledger', async () => {
    const seller = await newSeller(`Sourcing ${++productNumber}`);
    const p = await addProduct(2, 0, null);
    const sale = (quantity: number, sourcedQty: number, key: string) => api('/api/sales', 'POST', {
      idempotencyKey: key, saleDate: '2026-12-01', discountPaise: 0, paymentMethod: 'cash', receivedPaise: quantity * 15000,
      lines: [{ productId: p, quantity, unitPricePaise: 15000, setStockAfter: 0 }],
      sourcing: sourcedQty ? { sellerId: seller, items: [{ productId: p, quantity: sourcedQty, unitValuePaise: 10000 }] } : undefined,
    });

    expect((await sale(5, 0, 'no-sourcing')).status).toBe(409);
    expect((await sale(5, 2, 'too-little')).status).toBe(409);
    expect(await stockOf(p)).toBe(2);

    expect((await sale(5, 3, 'sourced')).status).toBe(201);
    expect(await stockOf(p)).toBe(0);
    const detail = await (await api(`/api/sellers/${seller}`)).json() as { balancePaise: number; entries: { saleId: number | null }[] };
    expect(detail.balancePaise).toBe(-30000);
    expect(detail.entries[0]!.saleId).not.toBeNull();
  });

  it('cancelling a sourced sale restores the borrowed set stock', async () => {
    const seller = await newSeller(`Sets ${++productNumber}`);
    const p = await addProduct(2, 0.5, 4); // 2 pieces, 0.5 set, 4 pieces per set
    const res = await api('/api/sales', 'POST', {
      idempotencyKey: 'sets-sourced', saleDate: '2026-12-01', discountPaise: 0, paymentMethod: 'cash', receivedPaise: 0,
      lines: [{ productId: p, quantity: 5, setPricePaise: 15000 }],
      sourcing: { sellerId: seller, items: [{ productId: p, quantity: 3, unitValuePaise: 3000 }] },
    });
    expect(res.status).toBe(201);
    const { id } = await res.json() as { id: number };
    expect((await api(`/api/sales/${id}/cancel`, 'POST', { reason: 'test' })).status).toBe(200);
    const row = await env.DB.prepare('SELECT stock_quantity AS q, set_stock_quantity AS s FROM products WHERE id = ?').bind(p).first<{ q: number; s: number }>();
    expect(row).toEqual({ q: 5, s: 1.25 });
  });
});

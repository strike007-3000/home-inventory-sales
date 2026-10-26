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
  ).bind(`Demo Set ${++productNumber}`, quantity, setStock, unitsPerSet, now, now).run();
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

describe('Savings plans', () => {
  async function newPlan() {
    const res = await api('/api/plans', 'POST', { customerName: 'Asha', monthlyPaise: 50000, startDate: '2026-06-01', months: 10 });
    expect(res.status).toBe(201);
    return (await res.json()) as { id: number };
  }
  const deposit = (id: number, amountPaise: number, receivedDate?: string) =>
    api(`/api/plans/${id}/deposits`, 'POST', { amountPaise, paymentMethod: 'upi', receivedDate });
  const redeem = (planId: number, productId: number, key: string, discountPaise = 0) => api('/api/sales', 'POST', {
    idempotencyKey: key, saleDate: '2026-12-01', planId,
    lines: [{ productId, quantity: 4, setPricePaise: 15000 }], discountPaise, paymentMethod: 'upi', receivedPaise: 0,
  });

  it('tracks dated deposits and the saved total', async () => {
    const { id } = await newPlan();
    expect((await deposit(id, 50000, '2026-06-05')).status).toBe(201);
    const res = await deposit(id, 50000);
    const plan = await res.json() as { savedPaise: number; deposits: { receivedAt: string }[] };
    expect(plan.savedPaise).toBe(100000);
    expect(plan.deposits[0]!.receivedAt.slice(0, 10)).toBe('2026-06-05');
    expect((await deposit(id, 100, '2999-01-01')).status).toBe(400);
    expect((await deposit(id, 100, '2026-13-01')).status).toBe(400);
    expect((await api('/api/plans', 'POST', { customerName: 'X', monthlyPaise: 100, startDate: '2026-13-01' })).status).toBe(400);
  });

  it('redeems into a sale: deposits become payments, stock is deducted, remainder stays as balance', async () => {
    const productId = await addProduct(); // 4 units of a 15000 set = 15000
    const { id } = await newPlan();
    await deposit(id, 10000, '2026-06-05');
    const res = await redeem(id, productId, 'redeem-1');
    expect(res.status).toBe(201);
    const sale = await res.json() as { id: number; customerName: string; paidPaise: number; balancePaise: number; payments: unknown[] };
    expect(sale.customerName).toBe('Asha');
    expect(sale.paidPaise).toBe(10000);
    expect(sale.balancePaise).toBe(5000);
    const plan = await (await api(`/api/plans/${id}`)).json() as { status: string; saleId: number };
    expect(plan).toMatchObject({ status: 'redeemed', saleId: sale.id });
    expect((await deposit(id, 100)).status).toBe(409);
    expect((await redeem(id, productId, 'redeem-2')).status).toBe(409);
    // replaying the same key returns the same sale
    expect(((await (await redeem(id, productId, 'redeem-1')).json()) as { id: number }).id).toBe(sale.id);
  });

  it('refunds the excess when the product costs less than the savings', async () => {
    const productId = await addProduct();
    const { id } = await newPlan();
    await deposit(id, 20000);
    const sale = await (await redeem(id, productId, 'redeem-3')).json() as { paidPaise: number; balancePaise: number };
    expect(sale).toMatchObject({ paidPaise: 15000, balancePaise: 0 });
    const plan = await (await api(`/api/plans/${id}`)).json() as { refundPaise: number };
    expect(plan.refundPaise).toBe(5000);
  });

  it('cancels an open plan and records the full refund', async () => {
    const { id } = await newPlan();
    await deposit(id, 30000);
    expect((await api(`/api/plans/${id}/cancel`, 'POST', {})).status).toBe(400);
    const plan = await (await api(`/api/plans/${id}/cancel`, 'POST', { reason: 'moved away' })).json() as { status: string; refundPaise: number };
    expect(plan).toMatchObject({ status: 'cancelled', refundPaise: 30000 });
    expect((await api(`/api/plans/${id}/cancel`, 'POST', { reason: 'again' })).status).toBe(409);
  });
});

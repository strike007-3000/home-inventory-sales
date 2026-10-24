import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

const ORIGIN = 'https://inventory.example.test';
const PASSWORD = 'worker-test-password';
let session = '';
let csrf = '';
let requestNumber = 0;

function request(path: string, init: RequestInit = {}): Request {
  requestNumber += 1;
  const headers = new Headers(init.headers);
  headers.set('CF-Connecting-IP', `203.0.113.${requestNumber}`);
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

async function addProduct(name: string, createdAt = '2026-01-01T00:00:00.000Z'): Promise<number> {
  const now = createdAt;
  const result = await env.DB.prepare(
    `INSERT INTO products (name, selling_price_minor, stock_quantity, set_stock_quantity,
      units_per_set, low_stock_level, active, version, created_at, updated_at)
     VALUES (?, 10000, 20, 20, 1, 1, 1, 1, ?, ?)`,
  ).bind(name, now, now).run();
  return Number(result.meta.last_row_id);
}

async function sell(key: string, productId: number, saleDate: string, receivedPaise: number, customerName: string) {
  const response = await api('/api/sales', 'POST', {
    idempotencyKey: key, saleDate, customerName,
    lines: [{ productId, quantity: 2, setPricePaise: 10000 }],
    discountPaise: 0, paymentMethod: 'cash', receivedPaise,
  });
  expect(response.status).toBe(201);
}

beforeEach(async () => {
  const login = await exports.default.fetch(request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ password: PASSWORD }),
  }));
  const cookies = login.headers.getSetCookie();
  session = cookies.find((v) => v.startsWith('__Host-session='))!.split('=')[1]!.split(';')[0]!;
  csrf = cookies.find((v) => v.startsWith('__Host-csrf='))!.split('=')[1]!.split(';')[0]!;
});

describe('Reports API', () => {
  it('rejects invalid ranges', async () => {
    expect((await api('/api/reports?from=2026-02-01&to=2026-01-01')).status).toBe(400);
    expect((await api('/api/reports?from=bad&to=2026-01-01')).status).toBe(400);
  });

  it('summarises sales, top products, slow stock and unpaid balances', async () => {
    const sold = await addProduct('Report Sold');
    await addProduct('Report Idle');
    await sell('rep-1', sold, '2026-03-10', 5000, 'Asha'); // partial
    await sell('rep-2', sold, '2026-03-12', 5000, 'Ravi');
    const body = await (await api('/api/reports?from=2026-03-01&to=2026-03-31')).json<any>();

    expect(body.summary.count).toBe(2);
    expect(body.summary.revenuePaise).toBe(body.daily.reduce((s: number, d: any) => s + d.totalPaise, 0));
    expect(body.previous.count).toBe(0);
    expect(body.topProducts[0]).toMatchObject({ productId: sold, units: 4 });
    expect(body.topProducts[0].revenuePaise).toBe(body.summary.revenuePaise);
    expect(body.outstandingTotal.count).toBe(2);
    expect(body.slowProducts.map((p: any) => p.name)).toContain('Report Idle');
    expect(body.slowProducts.map((p: any) => p.name)).not.toContain('Report Sold');
    expect(body.outstanding).toHaveLength(2);
    for (const row of body.outstanding) expect(row.balancePaise).toBe(row.totalPaise - row.paidPaise);
  });

  it('reflects discounts in product revenue, skips future-created stock, and keeps totals', async () => {
    const sold = await addProduct('Discounted Item');
    await addProduct('Created Later', '2026-12-01T00:00:00.000Z');
    const response = await api('/api/sales', 'POST', {
      idempotencyKey: 'rep-disc', saleDate: '2026-04-10',
      lines: [{ productId: sold, quantity: 2, setPricePaise: 10000 }],
      discountPaise: 5000, paymentMethod: 'cash', receivedPaise: 15000,
    });
    expect(response.status).toBe(201);
    const body = await (await api('/api/reports?from=2026-04-01&to=2026-04-30')).json<any>();
    expect(body.summary.revenuePaise).toBe(15000);
    expect(body.topProducts.find((p: any) => p.productId === sold).revenuePaise).toBe(15000);
    expect(body.slowProducts.map((p: any) => p.name)).not.toContain('Created Later');
  });
});

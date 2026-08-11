import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';

const BASE_URL = 'https://inventory.example.test';
let requestNumber = 100;

function request(path: string, init: RequestInit = {}): Request {
  requestNumber += 1;
  const headers = new Headers(init.headers);
  headers.set('CF-Connecting-IP', `198.51.100.${requestNumber}`);
  return new Request(`${BASE_URL}${path}`, { ...init, headers });
}

async function login(): Promise<{ session: string; csrf: string }> {
  const response = await exports.default.fetch(request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
    body: JSON.stringify({ password: 'worker-test-password' }),
  }));
  const cookies = response.headers.getSetCookie();
  return {
    session: cookies.find((value) => value.startsWith('__Host-session='))!.split('=')[1]!.split(';')[0]!,
    csrf: cookies.find((value) => value.startsWith('__Host-csrf='))!.split('=')[1]!.split(';')[0]!,
  };
}

describe('POST /api/stock/change', () => {
  let session: string;
  let csrf: string;
  let product: { id: number; version: number };

  async function post(body: unknown): Promise<Response> {
    return exports.default.fetch(request('/api/stock/change', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`,
        'X-CSRF-Token': csrf,
        Origin: BASE_URL,
      },
      body: JSON.stringify(body),
    }));
  }

  beforeEach(async () => {
    ({ session, csrf } = await login());
    const response = await exports.default.fetch(request('/api/products', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`,
        'X-CSRF-Token': csrf,
        Origin: BASE_URL,
      },
      body: JSON.stringify({
        name: 'Variant Product',
        sku: 'STOCK-CHANGE',
        pricePaise: 12000,
        quantity: 10,
        setStockQuantity: 2.5,
        lowStockLevel: 2,
        active: true,
      }),
    }));
    product = await response.json();
  });

  it('atomically changes both absolute values and records both deltas', async () => {
    const response = await post({
      productId: product.id,
      expectedVersion: product.version,
      quantity: 7,
      setStockQuantity: 1.75,
      reason: 'incorrect-entry',
      note: '  Shelf count correction  ',
    });

    expect(response.status).toBe(200);
    const body = await response.json<any>();
    expect(body).toMatchObject({
      ok: true,
      quantityDelta: -3,
      setStockDelta: -0.75,
      product: { id: product.id, quantity: 7, setStockQuantity: 1.75, version: product.version + 1 },
    });
    const movement = await env.DB.prepare(
      'SELECT quantity_delta, set_stock_delta, reason, note FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 1',
    ).bind(product.id).first();
    expect(movement).toMatchObject({
      quantity_delta: -3,
      set_stock_delta: -0.75,
      reason: 'incorrect-entry',
      note: 'Shelf count correction',
    });
  });

  it('supports changing only one value while auditing a zero delta for the other', async () => {
    const response = await post({
      productId: product.id,
      expectedVersion: product.version,
      quantity: 10,
      setStockQuantity: 3,
      reason: 'other',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ quantityDelta: 0, setStockDelta: 0.5 });
  });

  it('rejects no-op changes', async () => {
    const response = await post({
      productId: product.id, expectedVersion: product.version,
      quantity: 10, setStockQuantity: 2.5, reason: 'other',
    });
    expect(response.status).toBe(400);
    expect((await response.json<any>()).error).toContain('At least one');
    const audit = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM stock_movements WHERE product_id = ? AND reason = 'other'",
    ).bind(product.id).first<{ count: number }>();
    expect(audit?.count).toBe(0);
  });

  it.each([
    ['delivery', 9, 3, 'decrease'],
    ['delivery', 11, 2, 'decrease'],
    ['damaged', 11, 2.5, 'increase'],
    ['lost', 10, 3, 'increase'],
    ['sample', 11, 2, 'increase'],
    ['personal-use', 9, 3, 'increase'],
  ])('rejects %s when either value moves in the wrong direction', async (reason, quantity, setStockQuantity, direction) => {
    const response = await post({
      productId: product.id,
      expectedVersion: product.version,
      quantity,
      setStockQuantity,
      reason,
    });
    expect(response.status).toBe(400);
    expect((await response.json<any>()).error).toContain(direction);
  });

  it.each([
    ['delivery', 11, 3],
    ['damaged', 9, 2],
    ['count', 12, 3],
    ['incorrect-entry', 8, 2],
    ['other', 12, 2],
  ])('accepts a directionally valid %s change', async (reason, quantity, setStockQuantity) => {
    const response = await post({
      productId: product.id,
      expectedVersion: product.version,
      quantity,
      setStockQuantity,
      reason,
    });
    expect(response.status).toBe(200);
  });

  it('accepts safe numeric boundaries', async () => {
    const response = await post({
      productId: product.id,
      expectedVersion: product.version,
      quantity: Number.MAX_SAFE_INTEGER,
      setStockQuantity: Number.MAX_VALUE,
      reason: 'count',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      product: {
        quantity: Number.MAX_SAFE_INTEGER,
        setStockQuantity: Number.MAX_VALUE,
      },
    });
  });

  it.each([
    [{ productId: 0, expectedVersion: 1, quantity: 1, setStockQuantity: 1, reason: 'other' }, 'productId'],
    [{ productId: 1, expectedVersion: 0, quantity: 1, setStockQuantity: 1, reason: 'other' }, 'expectedVersion'],
    [{ productId: 1, expectedVersion: -1, quantity: 1, setStockQuantity: 1, reason: 'other' }, 'expectedVersion'],
    [{ productId: 1, expectedVersion: 1, quantity: -1, setStockQuantity: 1, reason: 'other' }, 'quantity'],
    [{ productId: 1, expectedVersion: 1, quantity: 1.2, setStockQuantity: 1, reason: 'other' }, 'quantity'],
    [{ productId: 1, expectedVersion: 1, quantity: 1, setStockQuantity: -1, reason: 'other' }, 'setStockQuantity'],
    [{ productId: 1, expectedVersion: 1, quantity: 1, setStockQuantity: null, reason: 'other' }, 'setStockQuantity'],
    [{ productId: 1, expectedVersion: 1, quantity: 1, setStockQuantity: '1', reason: 'other' }, 'setStockQuantity'],
    [{ productId: 1, expectedVersion: 1, quantity: 1, setStockQuantity: 1, reason: 'sale' }, 'reason'],
    [{ productId: 1, expectedVersion: 1, quantity: 1, setStockQuantity: 1, reason: 'other', note: 'x'.repeat(501) }, 'note'],
    [{ productId: 1, expectedVersion: 1, quantity: 1, setStockQuantity: 1, reason: 'other', note: 42 }, 'note'],
  ])('validates malformed input %#', async (body, field) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ field });
  });

  it('returns 404 for a missing product', async () => {
    const response = await post({
      productId: 999999, expectedVersion: 1,
      quantity: 1, setStockQuantity: 1, reason: 'other',
    });
    expect(response.status).toBe(404);
  });

  it('returns 409 without a movement for a stale version', async () => {
    const response = await post({
      productId: product.id, expectedVersion: product.version + 1,
      quantity: 8, setStockQuantity: 2, reason: 'other',
    });
    expect(response.status).toBe(409);
    const movements = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM stock_movements WHERE product_id = ? AND reason = 'other'",
    ).bind(product.id).first<{ count: number }>();
    expect(movements?.count).toBe(0);
  });

  it('exposes set stock deltas in product history', async () => {
    await post({
      productId: product.id, expectedVersion: product.version,
      quantity: 9, setStockQuantity: 2, reason: 'damaged',
    });
    const history = await exports.default.fetch(request(`/api/products/${product.id}/history`, {
      headers: { Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`, Origin: BASE_URL },
    }));
    expect(history.status).toBe(200);
    const body = await history.json<any>();
    expect(body.movements[0]).toMatchObject({
      quantityDelta: -1,
      setStockDelta: -0.5,
      reason: 'damaged',
    });
    expect(body.movements[1]).toMatchObject({
      reason: 'opening',
      setStockDelta: 0,
    });
  });
});

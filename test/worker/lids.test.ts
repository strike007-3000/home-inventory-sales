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

async function get(path: string): Promise<Response> {
  return exports.default.fetch(request(path, {
    headers: {
      Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`,
      Origin: ORIGIN,
    },
  }));
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

  const now = new Date().toISOString();
  const insert = `INSERT INTO lid_references
    (order_code, item_code, description, promotion, mrp_minor, special_price_minor,
     consultant_price_minor, import_source, import_row_number, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'test', ?, ?, ?)`;
  await env.DB.batch([
    env.DB.prepare(insert).bind(null, '21016140024', 'MOD MATES OVAL IV BASE-NATURAL', 'Spare Items', 48_000, 0, 36_500, 1, now, now),
    env.DB.prepare(insert).bind('618', '980650003401', 'SS BOWL 600ML', 'Current range', 99_000, 79_000, 60_000, 2, now, now),
  ]);
});

describe('LIDS lookup API', () => {
  it('requires authentication', async () => {
    const response = await exports.default.fetch(request('/api/lids'));
    expect(response.status).toBe(401);
  });

  it('searches descriptions and returns MRP when SP is zero', async () => {
    const response = await get('/api/lids?q=oval');
    expect(response.status).toBe(200);
    const body = await response.json<any>();
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({
      itemCode: '21016140024',
      specialPricePaise: 0,
      displayPricePaise: 48_000,
    });
  });

  it('searches item and order codes and paginates', async () => {
    const itemResponse = await get('/api/lids?q=980650003401&limit=1&offset=0');
    expect((await itemResponse.json<any>()).items[0].orderCode).toBe('618');

    const page = await get('/api/lids?limit=1&offset=1');
    const body = await page.json<any>();
    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(1);
  });

  it('treats SQL wildcard characters as literal search text', async () => {
    const response = await get('/api/lids?q=%25');
    expect(response.status).toBe(200);
    expect((await response.json<any>()).total).toBe(0);
  });
});

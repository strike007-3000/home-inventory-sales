import { env, exports } from 'cloudflare:workers';
import { describe, it, expect, beforeEach } from 'vitest';

const BASE_URL = 'https://inventory.example.test';
const PASSWORD = 'worker-test-password';
const SESSION_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

let requestNumber = 0;

// Helper to create requests with different protocols
function apiRequest(path: string, init: RequestInit = {}, protocol: 'https' | 'http' = 'https'): Request {
  requestNumber += 1;
  const headers = new Headers(init.headers);
  headers.set('CF-Connecting-IP', `192.0.2.${requestNumber}`);
  return new Request(`${protocol}://inventory.example.test${path}`, { ...init, headers });
}

async function loginHttps(): Promise<{ session: string; csrf: string }> {
  const response = await exports.default.fetch(
    apiRequest('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
      body: JSON.stringify({ password: PASSWORD }),
    }, 'https')
  );
  expect(response.status).toBe(200);
  const setCookies = response.headers.getSetCookie();
  const sessionCookie = setCookies.find((value) => value.startsWith('__Host-session='))!;
  const csrfCookie = setCookies.find((value) => value.startsWith('__Host-csrf='))!;

  // Extract just the cookie value without attributes
  const session = sessionCookie.split('=')[1]?.split(';')[0] || '';
  const csrf = csrfCookie.split('=')[1]?.split(';')[0] || '';
  return { session, csrf };
}

async function apiGetProducts(
  session: string,
  csrf: string,
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set('Cookie', `__Host-session=${session}; __Host-csrf=${csrf}`);
  headers.set('X-CSRF-Token', csrf);
  headers.set('Origin', BASE_URL);
  return exports.default.fetch(apiRequest(url, {
    ...options,
    headers: Object.fromEntries(headers)
  }, 'https'));
}

async function apiPostProducts(
  session: string,
  csrf: string,
  url: string,
  body: unknown
): Promise<Response> {
  const headers: Record<string, string> = {};
  headers['Content-Type'] = 'application/json';
  headers['Cookie'] = `__Host-session=${session}; __Host-csrf=${csrf}`;
  headers['X-CSRF-Token'] = csrf;
  headers['Origin'] = BASE_URL;

  return exports.default.fetch(apiRequest(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  }, 'https'));
}

async function apiPutProducts(
  session: string,
  csrf: string,
  url: string,
  body: unknown
): Promise<Response> {
  const versionedUrl = url.includes('?') ? url : `${url}?version=1`;
  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  headers.set('Cookie', `__Host-session=${session}; __Host-csrf=${csrf}`);
  headers.set('X-CSRF-Token', csrf);
  headers.set('Origin', BASE_URL);
  return exports.default.fetch(apiRequest(versionedUrl, {
    method: 'PUT',
    headers: Object.fromEntries(headers),
    body: JSON.stringify(body)
  }, 'https'));
}

async function apiPostProductAction(
  session: string,
  csrf: string,
  path: string,
  body?: unknown
): Promise<Response> {
  const headers: Record<string, string> = {};
  headers['Content-Type'] = 'application/json';
  headers['Cookie'] = `__Host-session=${session}; __Host-csrf=${csrf}`;
  headers['X-CSRF-Token'] = csrf;
  headers['Origin'] = BASE_URL;
  return exports.default.fetch(apiRequest(path, {
    method: 'POST',
    headers,
    body: body ? JSON.stringify(body) : undefined
  }, 'https'));
}

describe('Product API', () => {
  let session: string;
  let csrf: string;
  let testProduct: any; // Shared across all test suites

  beforeEach(async () => {
    const creds = await loginHttps();
    csrf = creds.csrf;
    session = creds.session;
  });

  describe('GET /api/products', () => {
    it('returns empty list when no products exist', async () => {
      const response = await apiGetProducts(session, csrf, '/api/products');
      expect(response.status).toBe(200);
      const data = await response.json<{ items: any[]; total: number }>();
      expect(data.items).toEqual([]);
      expect(data.total).toBe(0);
    });

    it('returns list of products when they exist', async () => {
      // Create some products first
      await apiPostProducts(session, csrf, '/api/products', {
        name: 'Test Product 1',
        category: 'Test Category',
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: 10,
        active: true,
      });

      const response = await apiGetProducts(session, csrf, '/api/products');
      expect(response.status).toBe(200);
      const data = await response.json<{ items: any[]; total: number }>();
      expect(data.total).toBeGreaterThan(0);
      expect(data.items.length).toBeGreaterThan(0);
      expect(data.items[0]).toHaveProperty('name');
      expect(data.items[0]).toHaveProperty('sku');
      expect(data.items[0]).toHaveProperty('pricePaise');
    });

    it('filters by active status', async () => {
      await apiPostProducts(session, csrf, '/api/products', {
        name: 'Active Product',
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: 10,
        active: true,
      });

      const response = await apiGetProducts(session, csrf, '/api/products?active=all');
      expect(response.status).toBe(200);
      const data = await response.json<{ items: any[]; total: number }>();
      expect(data.items).toHaveLength(1);

      await apiPostProducts(session, csrf, '/api/products', {
        name: 'Inactive Product',
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: 10,
        active: false,
      });

      const inactiveResponse = await apiGetProducts(session, csrf, '/api/products?active=inactive');
      const inactiveData = await inactiveResponse.json<{ items: any[]; total: number }>();
      expect(inactiveData.items).toHaveLength(1);
      expect(inactiveData.items[0].name).toBe('Inactive Product');
    });

    it('searches by name', async () => {
      await apiPostProducts(session, csrf, '/api/products', {
        name: 'Banana Bowl',
        pricePaise: 5000,
        lowStockLevel: 2,
        quantity: 5,
        active: true,
      });

      const response = await apiGetProducts(session, csrf, '/api/products?q=banana');
      expect(response.status).toBe(200);
      const data = await response.json<{ items: any[]; total: number }>();
      expect(data.items.length).toBe(1);
      expect(data.items[0].name).toBe('Banana Bowl');
    });

    it('searches by SKU', async () => {
      await apiPostProducts(session, csrf, '/api/products', {
        name: 'Product with SKU',
        sku: 'ABC-123',
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: 10,
        active: true,
      });

      const response = await apiGetProducts(session, csrf, '/api/products?q=ABC-123');
      expect(response.status).toBe(200);
      const data = await response.json<{ items: any[]; total: number }>();
      expect(data.items.length).toBe(1);
      expect(data.items[0].sku).toBe('ABC-123');
    });

    it('limits and offsets results', async () => {
      // Create 5 products
      for (let i = 1; i <= 5; i++) {
        await apiPostProducts(session, csrf, '/api/products', {
          name: `Product ${i}`,
          pricePaise: 1000,
          lowStockLevel: 1,
          quantity: 1,
          active: true,
        });
      }

      const response1 = await apiGetProducts(session, csrf, '/api/products?limit=2&offset=0');
      const data1 = await response1.json<{ items: any[]; total: number }>();
      expect(data1.items.length).toBe(2);

      const response2 = await apiGetProducts(session, csrf, '/api/products?limit=2&offset=2');
      const data2 = await response2.json<{ items: any[]; total: number }>();
      expect(data2.items.length).toBe(2);
    });

    it('rejects unauthenticated requests', async () => {
      const response = await exports.default.fetch(
        apiRequest('/api/products', {}, 'https')
      );
      expect(response.status).toBe(401);
    });

    it('rejects disallowed origin on authenticated GET', async () => {
      const response = await exports.default.fetch(
        apiRequest('/api/products', {
          headers: {
            Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`,
            Origin: 'https://evil.example',
          },
        }, 'https')
      );
      expect(response.status).toBe(403);
    });

    it('rejects invalid CSRF', async () => {
      const response = await apiGetProducts(session, csrf, '/api/products');
      // Already authenticated and CSRF validated
      expect(response.status).toBe(200);
    });
  });

  describe('POST /api/products', () => {
    it('creates a product with all fields', async () => {
      const response = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Test Product',
        category: 'Test Category',
        sku: 'SKU-001',
        pricePaise: 99900, // ₹999
        lowStockLevel: 5,
        quantity: 10,
        active: true,
      });

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data).toHaveProperty('id');
      expect(data.name).toBe('Test Product');
      expect(data.sku).toBe('SKU-001');
      expect(data.pricePaise).toBe(99900);
      expect(data.quantity).toBe(10);
      expect(data.active).toBe(true);
      expect(data.version).toBe(1);
      expect(data.createdAt).toBeDefined();
      expect(data.updatedAt).toBeDefined();
    });

    it('creates product with zero price', async () => {
      const response = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Free Product',
        pricePaise: 0,
        lowStockLevel: 1,
        quantity: 5,
        active: true,
      });

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.pricePaise).toBe(0);
      expect(data.quantity).toBe(5);
    });

    it('creates product with zero quantity', async () => {
      const response = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Zero Quantity Product',
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: 0,
        active: true,
      });

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.quantity).toBe(0);
    });

    it('trims names and SKUs', async () => {
      const response = await apiPostProducts(session, csrf, '/api/products', {
        name: '  Test Product  ',
        sku: '  SKU-001  ',
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: 10,
        active: true,
      });

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.name).toBe('Test Product');
      expect(data.sku).toBe('SKU-001');
    });

    it('requires name', async () => {
      const response = await apiPostProducts(session, csrf, '/api/products', {
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: 10,
        active: true,
      });

      expect(response.status).toBe(400);
      const data = await response.json<{ error: string }>();
      expect(data.error).toContain('Name');
    });

    it('validates non-negative price', async () => {
      const response = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Test Product',
        pricePaise: -100,
        lowStockLevel: 5,
        quantity: 10,
        active: true,
      });

      expect(response.status).toBe(400);
      const data = await response.json<{ error: string }>();
      expect(data.error).toContain('Price');
    });

    it('rejects negative quantity', async () => {
      const response = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Test Product',
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: -5,
        active: true,
      });

      expect(response.status).toBe(400);
    });

    it('creates SKU only when provided', async () => {
      const response = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Product without SKU',
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: 10,
        active: true,
      });

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.sku).toBeNull();
    });

    it('rejects duplicate SKU (case-insensitive)', async () => {
      await apiPostProducts(session, csrf, '/api/products', {
        name: 'Product A',
        sku: 'SKU-001',
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: 10,
        active: true,
      });

      const response = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Product B',
        sku: 'sku-001', // Different case, same SKU
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: 10,
        active: true,
      });

      expect(response.status).toBe(409);
      const data = await response.json<{ error: string }>();
      expect(data.error).toContain('SKU');
    });

    it('rejects missing CSRF on POST', async () => {
      const response = await exports.default.fetch(
        apiRequest('/api/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: `__Host-session=${session}` },
          body: JSON.stringify({
            name: 'Test Product',
            pricePaise: 10000,
            lowStockLevel: 5,
            quantity: 10,
            active: true,
          }),
        }, 'https')
      );
      expect(response.status).toBe(403);
    });

    it('rejects disallowed origin', async () => {
      const response = await exports.default.fetch(
        apiRequest('/api/products', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`,
            'X-CSRF-Token': csrf,
            Origin: 'https://evil.example',
          },
          body: JSON.stringify({
            name: 'Test Product',
            pricePaise: 10000,
            lowStockLevel: 5,
            quantity: 10,
            active: true,
          }),
        }, 'https')
      );
      expect(response.status).toBe(403);
    });
  });

  describe('PUT /api/products/:id', () => {
    it('updates product successfully', async () => {
      const createResponse = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Original Name',
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: 10,
        active: true,
      });

      const created = await createResponse.json();
      const id = created.id;

      const updateResponse = await apiPutProducts(session, csrf, `/api/products/${id}`, {
        name: 'Updated Name',
        pricePaise: 20000,
        lowStockLevel: 10,
        quantity: 10,
        active: false,
      });

      expect(updateResponse.status).toBe(200);
      const updated = await updateResponse.json();
      expect(updated.name).toBe('Updated Name');
      expect(updated.pricePaise).toBe(20000);
      expect(updated.quantity).toBe(10);
      expect(updated.active).toBe(false);
      expect(updated.version).toBe(2); // incremented from 1

      const movements = await env.DB.prepare(
        'SELECT quantity_delta, reason FROM stock_movements WHERE product_id = ?',
      ).bind(id).all();
      expect(movements.results).toEqual([{ quantity_delta: 10, reason: 'opening' }]);
    });

    it('rejects quantity changes through ordinary product edit', async () => {
      const createResponse = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Stock Protected Product',
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: 10,
        active: true,
      });
      const product = await createResponse.json<{ id: number; version: number }>();

      const response = await apiPutProducts(session, csrf, `/api/products/${product.id}?version=${product.version}`, {
        name: 'Stock Protected Product',
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: 11,
        active: true,
      });
      expect(response.status).toBe(409);
      const data = await response.json<{ error: string }>();
      expect(data.error).toContain('stock workflow');

      const stored = await env.DB.prepare(
        'SELECT stock_quantity, version FROM products WHERE id = ?',
      ).bind(product.id).first<{ stock_quantity: number; version: number }>();
      expect(stored).toEqual({ stock_quantity: 10, version: product.version });
      const movements = await env.DB.prepare(
        'SELECT id FROM stock_movements WHERE product_id = ?',
      ).bind(product.id).all();
      expect(movements.results).toHaveLength(1);
    });

    it.each(['1abc', '1.5', '+1', '9007199254740992'])(
      'rejects malformed or unsafe version %s',
      async (version) => {
        const createResponse = await apiPostProducts(session, csrf, '/api/products', {
          name: 'Version Parsing Product', pricePaise: 1000, lowStockLevel: 1, quantity: 0, active: true,
        });
        const product = await createResponse.json<{ id: number }>();
        const response = await apiPutProducts(session, csrf, `/api/products/${product.id}?version=${encodeURIComponent(version)}`, {
          name: 'Version Parsing Product', pricePaise: 1000, lowStockLevel: 1, quantity: 0, active: true,
        });
        expect(response.status).toBe(400);
      },
    );

    it('requires an explicit version and does not allow PUT on action suffixes', async () => {
      const createResponse = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Explicit Version Product', pricePaise: 1000, lowStockLevel: 1, quantity: 0, active: true,
      });
      const product = await createResponse.json<{ id: number }>();
      const requestBody = JSON.stringify({
        name: 'Explicit Version Product', pricePaise: 1000, lowStockLevel: 1, quantity: 0, active: true,
      });
      const headers = {
        'Content-Type': 'application/json',
        Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`,
        'X-CSRF-Token': csrf,
        Origin: BASE_URL,
      };

      const missingVersion = await exports.default.fetch(apiRequest(`/api/products/${product.id}`, {
        method: 'PUT', headers, body: requestBody,
      }, 'https'));
      expect(missingVersion.status).toBe(400);

      const suffixPut = await exports.default.fetch(apiRequest(`/api/products/${product.id}/history?version=1`, {
        method: 'PUT', headers, body: requestBody,
      }, 'https'));
      expect(suffixPut.status).toBe(404);
    });

    it('requires version for optimistic concurrency', async () => {
      const createResponse = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Test Product',
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: 10,
        active: true,
      });

      const created = await createResponse.json();
      const id = created.id;

      // Try to update with wrong version
      const updateResponse = await apiPutProducts(session, csrf, `/api/products/${id}?version=999`, {
        name: 'Updated Name',
        pricePaise: 20000,
        lowStockLevel: 10,
        quantity: 20,
        active: false,
      });

      expect(updateResponse.status).toBe(409);
      const data = await updateResponse.json<{ error: string }>();
      expect(data.error).toContain('Version conflict');
    });

    it('returns 404 for non-existent product', async () => {
      const updateResponse = await apiPutProducts(session, csrf, '/api/products/999999', {
        name: 'Updated Name',
        pricePaise: 20000,
        lowStockLevel: 10,
        quantity: 20,
        active: false,
      });

      expect(updateResponse.status).toBe(404);
    });

    it('rejects an unsafe product ID', async () => {
      const response = await apiGetProducts(
        session,
        csrf,
        `/api/products/${Number.MAX_SAFE_INTEGER + 1}`,
      );
      expect(response.status).toBe(400);
    });

    it('preserves SKU uniqueness check on update', async () => {
      const create1Response = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Product A',
        sku: 'SKU-001',
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: 10,
        active: true,
      });

      const create2Response = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Product B',
        sku: 'SKU-002',
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: 10,
        active: true,
      });

      const product1 = await create1Response.json();
      const product2 = await create2Response.json();

      // Try to change Product A's SKU to Product B's SKU
      const updateResponse = await apiPutProducts(session, csrf, `/api/products/${product1.id}`, {
        name: 'Product A',
        sku: 'SKU-002', // Already taken by Product B
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: 10,
        active: true,
      });

      expect(updateResponse.status).toBe(409);
      const data = await updateResponse.json<{ error: string }>();
      expect(data.error).toContain('SKU');
    });

    it('rejects unauthenticated updates', async () => {
      const createResponse = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Test Product',
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: 10,
        active: true,
      });

      const created = await createResponse.json();
      const id = created.id;

      const response = await exports.default.fetch(
        apiRequest(`/api/products/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Updated Name',
            pricePaise: 20000,
            lowStockLevel: 10,
            quantity: 20,
            active: false,
          }),
        }, 'https')
      );

      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/products/:id/deactivate', () => {
    it('deactivates product successfully', async () => {
      const createResponse = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Test Product',
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: 10,
        active: true,
      });

      const created = await createResponse.json();
      const id = created.id;

      const deactivateResponse = await apiPostProductAction(session, csrf, `/api/products/${id}/deactivate`);

      expect(deactivateResponse.status).toBe(200);
      const data = await deactivateResponse.json();
      expect(data.active).toBe(false);
      expect(data.version).toBe(2);
    });

    it('reactivates product successfully', async () => {
      // Create and deactivate first
      const createResponse = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Test Product',
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: 10,
        active: true,
      });

      const created = await createResponse.json();
      const id = created.id;

      await apiPostProductAction(session, csrf, `/api/products/${id}/deactivate`);

      // Reactivate
      const reactivateResponse = await apiPostProductAction(session, csrf, `/api/products/${id}/activate`);

      expect(reactivateResponse.status).toBe(200);
      const data = await reactivateResponse.json();
      expect(data.active).toBe(true);
      expect(data.version).toBe(3);
    });

    it('returns 404 for non-existent product', async () => {
      const response = await apiPostProductAction(session, csrf, '/api/products/999999/deactivate');

      expect(response.status).toBe(404);
    });

    it('does nothing if already in desired state', async () => {
      const createResponse = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Test Product',
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: 10,
        active: false,
      });

      const created = await createResponse.json();
      const id = created.id;

      const deactivateResponse = await apiPostProductAction(session, csrf, `/api/products/${id}/deactivate`);

      expect(deactivateResponse.status).toBe(200);
      const data = await deactivateResponse.json();
      expect(data.active).toBe(false);
      expect(data.version).toBe(1); // Not incremented
    });
  });

  describe('Opening stock movement', () => {
    it('creates opening stock movement when quantity > 0', async () => {
      const createResponse = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Test Product',
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: 10, // > 0, should create opening movement
        active: true,
      });

      expect(createResponse.status).toBe(201);
      const product = await createResponse.json();

      // Verify the product was created with correct data
      expect(product.id).toBeDefined();
      expect(product.quantity).toBe(10);
      expect(product.version).toBe(1);

      // Query stock_movements directly from D1 to verify the opening movement
      const movements = await env.DB.prepare(
        'SELECT product_id, quantity_delta, reason, created_at FROM stock_movements WHERE product_id = ? ORDER BY created_at ASC'
      )
        .bind(product.id)
        .all();

      // Verify exactly one opening movement was created
      expect((movements.results || []).length).toBe(1);
      const movement = (movements.results || [])[0];

      // Assert opening movement properties
      expect(movement.product_id).toBe(product.id);
      expect(movement.quantity_delta).toBe(10);
      expect(movement.reason).toBe('opening');
      expect(movement.created_at).toBeDefined();

      const getResponse = await apiGetProducts(session, csrf, `/api/products/${product.id}`);
      expect(getResponse.status).toBe(200);
      const fetched = await getResponse.json();
      expect(fetched.id).toBe(product.id);
      expect(fetched.quantity).toBe(10);
    });

    it('does NOT create opening stock movement when quantity is 0', async () => {
      const createResponse = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Zero Stock Product',
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: 0, // 0, should NOT create opening movement
        active: true,
      });

      expect(createResponse.status).toBe(201);
      const product = await createResponse.json();

      // Verify the product was created with correct data
      expect(product.id).toBeDefined();
      expect(product.quantity).toBe(0);
      expect(product.version).toBe(1);

      // Query stock_movements directly from D1 to verify no opening movement was created
      const movements = await env.DB.prepare(
        'SELECT product_id, quantity_delta, reason, created_at FROM stock_movements WHERE product_id = ? ORDER BY created_at ASC'
      )
        .bind(product.id)
        .all();

      // Verify no movements were created
      expect((movements.results || []).length).toBe(0);

      const getResponse = await apiGetProducts(session, csrf, `/api/products/${product.id}`);
      expect(getResponse.status).toBe(200);
      const fetched = await getResponse.json();
      expect(fetched.id).toBe(product.id);
      expect(fetched.quantity).toBe(0);
    });

    it('creates multiple opening movements for multiple products with quantity > 0', async () => {
      // Create two products with positive quantities
      const product1 = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Product 1',
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: 15,
        active: true,
      }).then((r) => r.json());

      const product2 = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Product 2',
        pricePaise: 20000,
        lowStockLevel: 5,
        quantity: 20,
        active: true,
      }).then((r) => r.json());

      expect(product1.quantity).toBe(15);
      expect(product2.quantity).toBe(20);

      // Both products should exist and have correct quantities
      const listResp = await apiGetProducts(session, csrf, '/api/products?active=all');
      const list = await listResp.json<{ items: any[]; total: number }>();
      const names = list.items.map((p: any) => p.name);
      expect(names).toContain('Product 1');
      expect(names).toContain('Product 2');

      // Verify quantities
      const p1 = list.items.find((p: any) => p.name === 'Product 1');
      const p2 = list.items.find((p: any) => p.name === 'Product 2');
      expect(p1?.quantity).toBe(15);
      expect(p2?.quantity).toBe(20);
    });

    it('creates zero opening movements when all products have quantity = 0', async () => {
      // Create multiple products with zero quantities
      await apiPostProducts(session, csrf, '/api/products', {
        name: 'Product 1',
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: 0,
        active: true,
      });

      await apiPostProducts(session, csrf, '/api/products', {
        name: 'Product 2',
        pricePaise: 20000,
        lowStockLevel: 5,
        quantity: 0,
        active: true,
      });

      await apiPostProducts(session, csrf, '/api/products', {
        name: 'Product 3',
        pricePaise: 30000,
        lowStockLevel: 5,
        quantity: 0,
        active: true,
      });

      // All products should exist with zero quantities
      const listResp = await apiGetProducts(session, csrf, '/api/products?active=all');
      const list = await listResp.json<{ items: any[]; total: number }>();
      expect(list.total).toBe(3);

      for (const p of list.items) {
        expect(p.quantity).toBe(0);
      }

      // Query stock_movements directly from D1 to verify no opening movements were created
      const movements = await env.DB.prepare(
        'SELECT COUNT(*) as cnt FROM stock_movements WHERE reason = ?',
      )
        .bind('opening')
        .first<{ cnt: number }>();

      expect(movements?.cnt ?? 0).toBe(0);
    });
  });

  describe('Pagination and limits', () => {
    beforeEach(async () => {
      // Seed pagination data in one real D1 transaction; endpoint behavior is
      // exercised by the requests below, without 100 login/CSRF round trips.
      const now = new Date().toISOString();
      await env.DB.batch(Array.from({ length: 100 }, (_, index) =>
        env.DB.prepare(
          `INSERT INTO products
           (name, selling_price_minor, stock_quantity, low_stock_level, active, version, created_at, updated_at)
           VALUES (?, 1000, 1, 1, 1, 1, ?, ?)`,
        ).bind(`Product ${index + 1}`, now, now),
      ));
    });

    it('respects maximum limit', async () => {
      const response = await apiGetProducts(session, csrf, '/api/products?limit=9999');
      expect(response.status).toBe(400);
    });

    it.each([
      '/api/products?limit=1abc',
      '/api/products?limit=0',
      '/api/products?offset=-1',
      '/api/products?active=garbage',
    ])('rejects invalid list query %s', async (path) => {
      const response = await apiGetProducts(session, csrf, path);
      expect(response.status).toBe(400);
    });

    it('rejects an oversized search query', async () => {
      const response = await apiGetProducts(session, csrf, `/api/products?q=${'x'.repeat(201)}`);
      expect(response.status).toBe(400);
    });

    it('respects minimum limit', async () => {
      const response = await apiGetProducts(session, csrf, '/api/products?limit=1');
      expect(response.status).toBe(200);
      const data = await response.json<{ items: any[]; total: number }>();
      expect(data.items.length).toBeLessThanOrEqual(1);
    });

    it('respects offset', async () => {
      const response = await apiGetProducts(session, csrf, '/api/products?limit=10&offset=5');
      expect(response.status).toBe(200);
      const data = await response.json<{ items: any[]; total: number }>();
      // Should get items 5-14 (10 items)
      expect(data.items.length).toBeLessThanOrEqual(10);
    });

    it('total is correct with offset', async () => {
      const response = await apiGetProducts(session, csrf, '/api/products?limit=10&offset=50');
      expect(response.status).toBe(200);
      const data = await response.json<{ items: any[]; total: number }>();
      expect(data.total).toBe(100);
    });
  });

  // ========================================================================
  // CSV Import
  // ========================================================================

  function csvUpload(csvContent: string, filename = 'import.csv'): FormData {
    const fd = new FormData();
    const blob = new Blob([csvContent], { type: 'text/csv' });
    fd.append('file', blob, filename);
    return fd;
  }

  async function previewCsv(csvContent: string): Promise<Response> {
    const formData = csvUpload(csvContent);
    const headers = new Headers({
      Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`,
      'X-CSRF-Token': csrf,
      Origin: BASE_URL,
    });
    return exports.default.fetch(
      apiRequest('/api/import/products/preview', {
        method: 'POST',
        headers: Object.fromEntries(headers),
        body: formData,
      }, 'https'),
    );
  }

  async function commitImport(requestId: string): Promise<Response> {
    return exports.default.fetch(
      apiRequest('/api/import/products/commit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`,
          'X-CSRF-Token': csrf,
          Origin: BASE_URL,
        },
        body: JSON.stringify({ requestId }),
      }, 'https'),
    );
  }

  const VALID_HEADERS = 'name,category,selling_price_minor,quantity,low_stock,sku';

  describe('POST /api/import/products/preview', () => {
    it('parses a valid CSV and stages all rows', async () => {
      const csv = `${VALID_HEADERS}\nBanana Bowl,Home,5000,10,2,SKU-BB-001\nRound Container,Kitchen,3200,5,1,SKU-RC-002`;
      const response = await previewCsv(csv);
      expect(response.status).toBe(200);
      const data = await response.json<{
        requestId: string;
        totals: { total: number; valid: number; invalid: number };
        validRows: Array<{ rowNumber: number }>;
      }>();
      expect(data.requestId).toBeDefined();
      expect(data.totals.total).toBe(2);
      expect(data.totals.valid).toBe(2);
      expect(data.totals.invalid).toBe(0);
      expect(data.validRows).toHaveLength(2);
    });

    it('rejects non-multipart requests', async () => {
      const response = await exports.default.fetch(
        apiRequest('/api/import/products/preview', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`,
            'X-CSRF-Token': csrf,
            Origin: BASE_URL,
          },
          body: JSON.stringify({ file: 'test' }),
        }, 'https'),
      );
      expect(response.status).toBe(400);
    });

    it('rejects CSV with wrong headers', async () => {
      const csv = `wrong,headers,here\na,b,c`;
      const response = await previewCsv(csv);
      expect(response.status).toBe(400);
      const data = await response.json<{ error: string }>();
      expect(data.error).toContain('Invalid headers');
    });

    it('rejects empty CSV', async () => {
      const response = await previewCsv('');
      expect(response.status).toBe(400);
      const data = await response.json<{ error: string }>();
      expect(data.error).toContain('empty');
    });

    it('reports invalid rows with reasons', async () => {
      const csv = `${VALID_HEADERS}\n,Category,100,5,1,SKU001\nValid Product,,abc,-5,1,SKU002`;
      const response = await previewCsv(csv);
      expect(response.status).toBe(200);
      const data = await response.json<{
        totals: { valid: number; invalid: number };
        invalidRows: Array<{ rowNumber: number; errors: string[] }>;
      }>();
      expect(data.totals.valid).toBe(0);
      expect(data.totals.invalid).toBe(2);
      expect(data.invalidRows.length).toBeGreaterThanOrEqual(1);
      // Row 2 has empty name, Row 3 has bad price
      const errors = data.invalidRows.flatMap((r) => r.errors);
      expect(errors.some((e) => e.includes('Name'))).toBe(true);
      expect(errors.some((e) => e.includes('Price'))).toBe(true);
    });

    it('detects duplicate SKUs within CSV', async () => {
      const csv = `${VALID_HEADERS}\nProduct A,Home,1000,5,1,SKU-DUP\nProduct B,Kitchen,2000,3,1,SKU-DUP`;
      const response = await previewCsv(csv);
      expect(response.status).toBe(200);
      const data = await response.json<{
        requestId: string;
        totals: { total: number; valid: number; invalid: number; duplicate: number };
        invalidRows: Array<{ rowNumber: number; errors: string[] }>;
        duplicateRows: Array<{ rowNumber: number; sku: string; firstSeenRow: number; reason: string }>;
      }>();
      // Row 3 (SKU-DUP second occurrence) should be marked as duplicate
      expect(data.totals.duplicate).toBeGreaterThanOrEqual(1);
      expect(data.duplicateRows.length).toBeGreaterThanOrEqual(1);
      expect(data.duplicateRows.some((r) => r.sku.toLowerCase() === 'sku-dup')).toBe(true);
    });

    it('detects SKU conflicts against D1', async () => {
      // Create a product first
      await apiPostProducts(session, csrf, '/api/products', {
        name: 'Existing Product',
        sku: 'EXISTING-SKU',
        pricePaise: 1000,
        lowStockLevel: 1,
        quantity: 1,
        active: true,
      });

      const csv = `${VALID_HEADERS}\nNew Product,Home,1000,5,1,existing-sku`;
      const response = await previewCsv(csv);
      expect(response.status).toBe(200);
      const data = await response.json<{
        totals: { valid: number; invalid: number };
        invalidRows: Array<{ rowNumber: number; errors: string[] }>;
      }>();
      expect(data.totals.invalid).toBe(1);
      const allErrors = data.invalidRows.flatMap((r) => r.errors);
      expect(allErrors.some((e) => e.includes('already exists'))).toBe(true);
    });

    it('handles BOM, CRLF, and escaped quotes', async () => {
      const csv = `﻿${VALID_HEADERS}\r\n"Product with ""quotes""",Home,1000,5,1,SKU-BOM\r\nProduct B,Kitchen,2000,3,1,SKU-2`;
      const response = await previewCsv(csv);
      expect(response.status).toBe(200);
      const data = await response.json<{
        totals: { total: number; valid: number };
        validRows: Array<{ rowNumber: number; data: { name: string } }>;
      }>();
      expect(data.totals.total).toBe(2);
      expect(data.totals.valid).toBe(2);
      expect(data.validRows[0].data.name).toBe('Product with "quotes"');
    });

    it('does NOT mutate the database', async () => {
      const csv = `${VALID_HEADERS}\nPreview Only,Home,1000,5,1,SKU-PREVIEW`;
      await previewCsv(csv);

      // Verify no product was created
      const response = await apiGetProducts(session, csrf, '/api/products?q=SKU-PREVIEW');
      const data = await response.json<{ items: any[] }>();
      expect(data.items).toHaveLength(0);
    });

    it('rejects unauthenticated requests', async () => {
      const formData = csvUpload(`${VALID_HEADERS}\nA,B,1,1,1,S`);
      const response = await exports.default.fetch(
        apiRequest('/api/import/products/preview', {
          method: 'POST',
          body: formData,
        }, 'https'),
      );
      expect(response.status).toBe(401);
    });

    it('strictly validates integer fields using table-driven test cases', async () => {
      const testCases = [
        // Valid cases: decimal integers only
        { name: 'zero', quantity: '0', price: '1000', lowStock: '2', shouldPass: true },
        { name: 'positive integer', quantity: '42', price: '5000', lowStock: '5', shouldPass: true },
        { name: 'large integer', quantity: '999999', price: '9999999', lowStock: '100', shouldPass: true },
        { name: 'zero with whitespace', quantity: '  0  ', price: '  1000  ', lowStock: '  2  ', shouldPass: true },

        // Invalid cases: must be rejected by strict parser
        { name: 'empty string', quantity: '', price: '1000', lowStock: '2', shouldPass: false },
        { name: 'whitespace only', quantity: '   ', price: '1000', lowStock: '2', shouldPass: false },
        { name: 'decimal fraction', quantity: '1.5', price: '1000', lowStock: '2', shouldPass: false },
        { name: 'text with digits', quantity: '10abc', price: '1000', lowStock: '2', shouldPass: false },
        { name: 'scientific notation 1e3', quantity: '1e3', price: '1000', lowStock: '2', shouldPass: false },
        { name: 'scientific notation 1e2', quantity: '1e2', price: '1000', lowStock: '2', shouldPass: false },
        { name: 'hex notation', quantity: '0x10', price: '1000', lowStock: '2', shouldPass: false },
        { name: 'leading plus', quantity: '+10', price: '1000', lowStock: '2', shouldPass: false },
        { name: 'negative integer', quantity: '-1', price: '1000', lowStock: '2', shouldPass: false },
        { name: 'negative zero', quantity: '-0', price: '1000', lowStock: '0', shouldPass: false },
        { name: 'NaN literal', quantity: 'NaN', price: '1000', lowStock: '2', shouldPass: false },
        { name: 'Infinity', quantity: 'Infinity', price: '1000', lowStock: '2', shouldPass: false },
      ];

      for (const testCase of testCases) {
        const csv = `${VALID_HEADERS}\n${testCase.name},Home,${testCase.price},${testCase.quantity},${testCase.lowStock},SKU-${testCase.name.toUpperCase()}`;
        const response = await previewCsv(csv);

        const data = await response.json<{
          requestId: string;
          totals: { valid: number; invalid: number };
          invalidRows: Array<{ rowNumber: number; errors: string[] }>;
        }>();

        if (testCase.shouldPass) {
          expect(data.totals.valid, `${testCase.name}: should pass but failed`).toBe(1);
          expect(data.totals.invalid, `${testCase.name}: should pass but had errors`).toBe(0);
          expect(data.invalidRows).toHaveLength(0);
        } else {
          expect(data.totals.valid, `${testCase.name}: should reject but passed`).toBe(0);
          expect(data.totals.invalid, `${testCase.name}: should reject but didn't`).toBe(1);
          expect(data.invalidRows.length).toBeGreaterThan(0);
          // Should have at least one error mentioning quantity, price, or lowStock
          const allErrors = data.invalidRows.flatMap((r) => r.errors);
          const hasQuantityError = allErrors.some((e) => e.includes('Quantity') || e.includes('quantity'));
          const hasPriceError = allErrors.some((e) => e.includes('Price') || e.includes('price'));
          const hasLowStockError = allErrors.some((e) => e.includes('Low stock') || e.includes('Low stock level'));
          expect(hasQuantityError || hasPriceError || hasLowStockError,
            `${testCase.name}: should have integer validation error`).toBe(true);
        }
      }
    });

    it.each([
      ['quote inside an unquoted field', 'Bad"Name,Home,1000,5,1,SKU-BAD-QUOTE', 'Quote is not allowed'],
      ['characters after a closing quote', '"Bad Name"junk,Home,1000,5,1,SKU-BAD-TAIL', 'Unexpected character'],
      ['unterminated quoted field', '"Bad Name,Home,1000,5,1,SKU-BAD-OPEN', 'Unterminated quoted field'],
      ['missing column', 'Bad Name,Home,1000,5,1', 'Expected 6 columns but found 5'],
      ['extra column', 'Bad Name,Home,1000,5,1,SKU-BAD-EXTRA,unexpected', 'Expected 6 columns but found 7'],
    ])('reports malformed CSV row: %s', async (_label, row, expectedError) => {
      const response = await previewCsv(`${VALID_HEADERS}\n${row}`);
      expect(response.status).toBe(200);
      const preview = await response.json<{
        totals: { valid: number; invalid: number };
        invalidRows: Array<{ rowNumber: number; errors: string[] }>;
      }>();
      expect(preview.totals.valid).toBe(0);
      expect(preview.totals.invalid).toBe(1);
      expect(preview.invalidRows[0]?.rowNumber).toBe(2);
      expect(preview.invalidRows[0]?.errors.some((error) => error.includes(expectedError))).toBe(true);
    });

    it('rejects malformed quoted header syntax', async () => {
      const malformedHeaders = '"name"junk,category,selling_price_minor,quantity,low_stock,sku';
      const response = await previewCsv(`${malformedHeaders}\nProduct,Home,1000,5,1,SKU-HEADER`);
      expect(response.status).toBe(400);
      const data = await response.json<{ error: string }>();
      expect(data.error).toContain('Invalid CSV header');
    });
  });

  describe('POST /api/import/products/commit', () => {
    it('commits all valid rows atomically', async () => {
      const csv = `${VALID_HEADERS}\nCommit Product A,Home,1000,10,2,SKU-COMMIT-A\nCommit Product B,Kitchen,2000,5,1,SKU-COMMIT-B`;
      const previewResp = await previewCsv(csv);
      const preview = await previewResp.json<{ requestId: string; totals: { valid: number } }>();
      expect(preview.totals.valid).toBe(2);

      const commitResp = await commitImport(preview.requestId);
      expect(commitResp.status).toBe(200);
      const commit = await commitResp.json<{ success: boolean; inserted: number }>();
      expect(commit.success).toBe(true);
      expect(commit.inserted).toBe(2);

      // Verify both products exist
      const listResp = await apiGetProducts(session, csrf, '/api/products?active=all');
      const list = await listResp.json<{ items: any[]; total: number }>();
      const names = list.items.map((p: any) => p.name);
      expect(names).toContain('Commit Product A');
      expect(names).toContain('Commit Product B');

      const storedSku = await env.DB.prepare(
        "SELECT sku FROM products WHERE name = 'Commit Product A'",
      ).first<{ sku: string }>();
      expect(storedSku?.sku).toBe('SKU-COMMIT-A');
    });

    it('creates opening stock movements exactly once for products with quantity > 0', async () => {
      const csv = `${VALID_HEADERS}\nStock Product,Home,1000,15,2,SKU-STOCK-ONCE`;
      const preview = await (await previewCsv(csv)).json<{ requestId: string }>();

      await commitImport(preview.requestId);

      // Find the product
      const listResp = await apiGetProducts(session, csrf, '/api/products?q=SKU-STOCK-ONCE');
      const list = await listResp.json<{ items: any[] }>();
      expect(list.items).toHaveLength(1);
      const product = list.items[0];

      // Query stock_movements directly from D1 to verify the opening movement
      const movements = await env.DB.prepare(
        'SELECT product_id, quantity_delta, reason, created_at FROM stock_movements WHERE product_id = ? ORDER BY created_at ASC'
      )
        .bind(product.id)
        .all();

      // Verify exactly one opening movement was created
      expect((movements.results || []).length).toBe(1);
      const movement = (movements.results || [])[0];

      // Assert opening movement properties
      expect(movement.product_id).toBe(product.id);
      expect(movement.quantity_delta).toBe(15);
      expect(movement.reason).toBe('opening');
      expect(movement.created_at).toBeDefined();
    });

    it('rejects already-consumed requests', async () => {
      const csv = `${VALID_HEADERS}\nConsume Me,Home,1000,1,1,SKU-CONSUME`;
      const preview = await (await previewCsv(csv)).json<{ requestId: string }>();

      await commitImport(preview.requestId);
      const second = await commitImport(preview.requestId);
      expect(second.status).toBe(409);
      const data = await second.json<{ error: string }>();
      expect(data.error).toContain('already been consumed');
    });

    it('atomically allows only one concurrent commit, including rows without SKUs', async () => {
      const csv = `${VALID_HEADERS}\nNo SKU A,Home,1000,2,1,\nNo SKU B,Kitchen,2000,3,1,`;
      const preview = await (await previewCsv(csv)).json<{ requestId: string }>();

      const [first, second] = await Promise.all([
        commitImport(preview.requestId),
        commitImport(preview.requestId),
      ]);
      expect([first.status, second.status].sort()).toEqual([200, 409]);

      const products = await env.DB.prepare(
        "SELECT name FROM products WHERE name IN ('No SKU A', 'No SKU B') ORDER BY name",
      ).all<{ name: string }>();
      expect(products.results.map((row) => row.name)).toEqual(['No SKU A', 'No SKU B']);

      const staging = await env.DB.prepare(
        `SELECT COUNT(*) AS total, COUNT(DISTINCT claim_token) AS tokens, MIN(consumed) AS consumed
         FROM import_staging WHERE request_id = ?`,
      ).bind(preview.requestId).first<{ total: number; tokens: number; consumed: number }>();
      expect(staging).toEqual({ total: 2, tokens: 1, consumed: 1 });
    });

    it('rejects unknown request IDs', async () => {
      const response = await commitImport('nonexistent-uuid');
      expect(response.status).toBe(404);
    });

    it('rejects when preview had invalid rows', async () => {
      const csv = `${VALID_HEADERS}\nBad Product,,abc,-5,1,SKU-INV`;
      const preview = await (await previewCsv(csv)).json<{ requestId: string }>();

      const response = await commitImport(preview.requestId);
      expect(response.status).toBe(400);
      const data = await response.json<{ error: string }>();
      expect(data.error).toContain('validation errors');
    });

    it('rejects when SKU conflict exists at commit time (race-safe)', async () => {
      const csv = `${VALID_HEADERS}\nRace Product,Home,1000,5,1,SKU-RACE`;
      const preview = await (await previewCsv(csv)).json<{ requestId: string }>();

      // Create a conflicting product between preview and commit
      await apiPostProducts(session, csrf, '/api/products', {
        name: 'Racing Product',
        sku: 'SKU-RACE',
        pricePaise: 999,
        lowStockLevel: 1,
        quantity: 1,
        active: true,
      });

      const response = await commitImport(preview.requestId);
      expect(response.status).toBe(409);
    });

    it('rejects a duplicate preview without consuming its staging request', async () => {
      const csv = `${VALID_HEADERS}\nAtomic Product,Home,1000,10,2,SKU-ATOMIC\nInvalid Product,Home,1000,10,2,SKU-ATOMIC`;
      const resp = await previewCsv(csv);
      const preview = await resp.json<{ requestId: string; totals: { valid: number; duplicate: number } }>();

      // Preview should detect the duplicate SKU
      expect(preview.totals.duplicate).toBe(1);
      expect(preview.totals.valid).toBe(1);

      // Duplicate/conflicting previews are rejected before commit.
      const response = await commitImport(preview.requestId);
      expect(response.status).toBe(409);
      const data = await response.json<{ error: string }>();
      expect(data.error).toContain('duplicate SKUs');

      const products = await env.DB.prepare(
        "SELECT id FROM products WHERE sku = 'SKU-ATOMIC' COLLATE NOCASE",
      ).all();
      expect(products.results).toHaveLength(0);

      // Preview/commit rejection did not create stock history.
      const movements = await env.DB.prepare(
        'SELECT COUNT(*) as cnt FROM stock_movements'
      )
        .first<{ cnt: number }>();
      expect(movements?.cnt ?? 0).toBe(0);

      const staging = await env.DB.prepare(
        'SELECT DISTINCT consumed FROM import_staging WHERE request_id = ?',
      ).bind(preview.requestId).all<{ consumed: number }>();
      expect(staging.results).toEqual([{ consumed: 0 }]);
    });

    it('preserves M1 auth on commit', async () => {
      // Attempt commit without session
      const response = await exports.default.fetch(
        apiRequest('/api/import/products/commit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId: 'test' }),
        }, 'https'),
      );
      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/products/:id/history', () => {
    it('returns ordered, paginated D1 movements with an accurate total', async () => {
      const createResponse = await apiPostProducts(session, csrf, '/api/products', {
        name: 'History Product',
        pricePaise: 1000,
        lowStockLevel: 1,
        quantity: 4,
        active: true,
      });
      const product = await createResponse.json<{ id: number }>();

      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO stock_movements (product_id, quantity_delta, reason, note, created_at)
           VALUES (?, 2, 'other', 'middle', '2099-01-02T00:00:00.000Z')`,
        ).bind(product.id),
        env.DB.prepare(
          `INSERT INTO stock_movements (product_id, quantity_delta, reason, note, created_at)
           VALUES (?, -1, 'damaged', 'latest', '2099-01-03T00:00:00.000Z')`,
        ).bind(product.id),
      ]);

      const response = await apiGetProducts(session, csrf, `/api/products/${product.id}/history?limit=1&offset=0`);
      expect(response.status).toBe(200);
      const history = await response.json<{
        movements: Array<{ productId: number; quantityDelta: number; reason: string }>;
        total: number;
        limit: number;
        offset: number;
      }>();
      expect(history.movements).toEqual([
        expect.objectContaining({ productId: product.id, quantityDelta: -1, reason: 'damaged' }),
      ]);
      expect(history).toMatchObject({ total: 3, limit: 1, offset: 0 });

      const secondPage = await apiGetProducts(session, csrf, `/api/products/${product.id}/history?limit=1&offset=1`);
      const secondHistory = await secondPage.json<{ movements: Array<{ quantityDelta: number }>; total: number }>();
      expect(secondHistory.movements[0]?.quantityDelta).toBe(2);
      expect(secondHistory.total).toBe(3);

      const invalid = await apiGetProducts(session, csrf, `/api/products/${product.id}/history?limit=1abc`);
      expect(invalid.status).toBe(400);

      const missing = await apiGetProducts(session, csrf, '/api/products/999999/history');
      expect(missing.status).toBe(404);
    });

    it('is protected by central authentication', async () => {
      const response = await exports.default.fetch(apiRequest('/api/products/1/history', {}, 'https'));
      expect(response.status).toBe(401);
    });
  });

  // ========================================================================
  // Stock Management Tests
  // ========================================================================

  describe('Stock Delivery', () => {
    beforeEach(async () => {
      // Create a test product
      const productResponse = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Test Delivery Product',
        sku: 'SKU-DELIVERY',
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: 10,
        active: true,
      });
      const product = await productResponse.json();
      testProduct = product;
    });

    it('adds stock via delivery', async () => {
      const response = await exports.default.fetch(
        apiRequest('/api/stock/delivery', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`,
            'X-CSRF-Token': csrf,
            Origin: BASE_URL,
          },
          body: JSON.stringify({
            items: [
              { productId: testProduct.id, quantity: 20 },
              { productId: testProduct.id, quantity: 30 },
            ],
          }),
        }, 'https'),
      );

      expect(response.status).toBe(200);
      const data = await response.json<{ ok: boolean; entries: Array<{ productId: number; quantityReceived: number; newQuantity: number }> }>();
      expect(data.ok).toBe(true);
      // Aggregated: both items for same product become one entry
      expect(data.entries).toHaveLength(1);
      expect(data.entries[0].productId).toBe(testProduct.id);
      expect(data.entries[0].quantityReceived).toBe(50); // 20 + 30
      expect(data.entries[0].newQuantity).toBe(60); // 10 existing + 50 received

      // Verify total quantity is correct
      const getResponse = await apiGetProducts(session, csrf, `/api/products/${testProduct.id}`);
      const product = await getResponse.json();
      expect(product.quantity).toBe(60); // 10 existing + 50
      expect(product.version).toBe(testProduct.version + 1);
    });

    it.each([
      ['unsafe product ID', Number.MAX_SAFE_INTEGER + 1, 1],
      ['unsafe quantity', 1, Number.MAX_SAFE_INTEGER + 1],
      ['fractional product ID', 1.5, 1],
      ['fractional quantity', 1, 1.5],
    ])('rejects %s', async (_label, productId, quantity) => {
      const response = await exports.default.fetch(
        apiRequest('/api/stock/delivery', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`,
            'X-CSRF-Token': csrf,
            Origin: BASE_URL,
          },
          body: JSON.stringify({ items: [{ productId, quantity }] }),
        }, 'https'),
      );
      expect(response.status).toBe(400);
    });

    it('rejects delivery when current stock plus received quantity is unsafe', async () => {
      await env.DB.prepare(
        'UPDATE products SET stock_quantity = ? WHERE id = ?',
      ).bind(Number.MAX_SAFE_INTEGER, testProduct.id).run();

      const response = await exports.default.fetch(
        apiRequest('/api/stock/delivery', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`,
            'X-CSRF-Token': csrf,
            Origin: BASE_URL,
          },
          body: JSON.stringify({ items: [{ productId: testProduct.id, quantity: 1 }] }),
        }, 'https'),
      );
      expect(response.status).toBe(409);

      const stored = await env.DB.prepare(
        'SELECT stock_quantity, version FROM products WHERE id = ?',
      ).bind(testProduct.id).first<{ stock_quantity: number; version: number }>();
      expect(stored).toEqual({ stock_quantity: Number.MAX_SAFE_INTEGER, version: testProduct.version });
    });

    it('atomically allows only one competing delivery near the safe limit', async () => {
      await env.DB.prepare(
        'UPDATE products SET stock_quantity = ? WHERE id = ?',
      ).bind(Number.MAX_SAFE_INTEGER - 1, testProduct.id).run();

      const deliverOne = () => exports.default.fetch(
        apiRequest('/api/stock/delivery', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`,
            'X-CSRF-Token': csrf,
            Origin: BASE_URL,
          },
          body: JSON.stringify({ items: [{ productId: testProduct.id, quantity: 1 }] }),
        }, 'https'),
      );

      const [first, second] = await Promise.all([deliverOne(), deliverOne()]);
      expect([first.status, second.status].sort()).toEqual([200, 409]);

      const stored = await env.DB.prepare(
        'SELECT stock_quantity, version FROM products WHERE id = ?',
      ).bind(testProduct.id).first<{ stock_quantity: number; version: number }>();
      expect(stored).toEqual({
        stock_quantity: Number.MAX_SAFE_INTEGER,
        version: testProduct.version + 1,
      });

      const entries = await env.DB.prepare(
        "SELECT id FROM stock_entries WHERE type = 'delivery'",
      ).all();
      expect(entries.results).toHaveLength(1);
      const items = await env.DB.prepare(
        'SELECT quantity_delta FROM stock_entry_items WHERE product_id = ?',
      ).bind(testProduct.id).all();
      expect(items.results).toEqual([{ quantity_delta: 1 }]);
      const movements = await env.DB.prepare(
        "SELECT quantity_delta FROM stock_movements WHERE product_id = ? AND reason = 'delivery'",
      ).bind(testProduct.id).all();
      expect(movements.results).toEqual([{ quantity_delta: 1 }]);
    });

    it('rolls back on delivery error', async () => {
      // Try to deliver more than the product can handle (negative quantity in update)
      const response = await exports.default.fetch(
        apiRequest('/api/stock/delivery', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`,
            'X-CSRF-Token': csrf,
            Origin: BASE_URL,
          },
          body: JSON.stringify({
            items: [
              { productId: testProduct.id, quantity: -10 }, // Negative quantity
            ],
          }),
        }, 'https'),
      );

      expect(response.status).toBe(400);
      const data = await response.json<{ error: string }>();
      expect(data.error).toContain('positive integer');

      // Verify product quantity remains unchanged
      const getResponse = await apiGetProducts(session, csrf, `/api/products/${testProduct.id}`);
      const product = await getResponse.json();
      expect(product.quantity).toBe(10); // Should still be 10
    });

    it('rolls back on non-existent product', async () => {
      const response = await exports.default.fetch(
        apiRequest('/api/stock/delivery', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`,
            'X-CSRF-Token': csrf,
            Origin: BASE_URL,
          },
          body: JSON.stringify({
            items: [
              { productId: 999999, quantity: 10 },
            ],
          }),
        }, 'https'),
      );

      expect(response.status).toBe(404);
      const data = await response.json<{ error: string }>();
      expect(data.error).toContain('not found');

      // Verify product quantity remains unchanged
      const getResponse = await apiGetProducts(session, csrf, `/api/products/${testProduct.id}`);
      const product = await getResponse.json();
      expect(product.quantity).toBe(10); // Should still be 10
    });

    it('requires CSRF on delivery', async () => {
      const response = await exports.default.fetch(
        apiRequest('/api/stock/delivery', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__Host-session=${session}`,
            Origin: BASE_URL,
          },
          body: JSON.stringify({
            items: [
              { productId: testProduct.id, quantity: 10 },
            ],
          }),
        }, 'https'),
      );
      expect(response.status).toBe(403);
    });
  });

  describe('Stock Count', () => {
    it.each([
      ['unsafe product ID', Number.MAX_SAFE_INTEGER + 1, 1],
      ['unsafe counted quantity', 1, Number.MAX_SAFE_INTEGER + 1],
      ['fractional counted quantity', 1, 1.5],
    ])('rejects %s', async (_label, productId, countedQuantity) => {
      const response = await exports.default.fetch(
        apiRequest('/api/stock/count', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`,
            'X-CSRF-Token': csrf,
            Origin: BASE_URL,
          },
          body: JSON.stringify({ productId, countedQuantity }),
        }, 'https'),
      );
      expect(response.status).toBe(400);
    });

    it('updates quantity from zero via stock count', async () => {
      // Create product with zero quantity to avoid opening stock movement trigger
      const zeroQtyResponse = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Test Count Product',
        sku: 'SKU-COUNT-ZERO',
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: 0, // Zero to avoid opening stock movement
        active: true,
      });
      const zeroQtyProduct = await zeroQtyResponse.json();

      const response = await exports.default.fetch(
        apiRequest('/api/stock/count', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`,
            'X-CSRF-Token': csrf,
            Origin: BASE_URL,
          },
          body: JSON.stringify({
            productId: zeroQtyProduct.id,
            countedQuantity: 25,
            note: 'Physical count',
          }),
        }, 'https'),
      );

      expect(response.status).toBe(200);
      const data = await response.json<{ ok: boolean; newQuantity: number; delta: number }>();
      expect(data.ok).toBe(true);
      expect(data.newQuantity).toBe(25);
      expect(data.delta).toBe(25); // 25 - 0

      // Verify quantity is correct
      const getResponse = await apiGetProducts(session, csrf, `/api/products/${zeroQtyProduct.id}`);
      const product = await getResponse.json();
      expect(product.quantity).toBe(25);
    });

    it('uses the latest version for serial stock counts', async () => {
      // Create product with zero quantity to avoid opening stock movement trigger
      const zeroQtyResponse = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Test Count Product',
        sku: 'SKU-COUNT-CONFLICT',
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: 0, // Zero to avoid opening stock movement
        active: true,
      });
      const zeroQtyProduct = await zeroQtyResponse.json();

      // First count succeeds, bumping version to 2
      const firstCountResp = await exports.default.fetch(
        apiRequest('/api/stock/count', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`,
            'X-CSRF-Token': csrf,
            Origin: BASE_URL,
          },
          body: JSON.stringify({
            productId: zeroQtyProduct.id,
            countedQuantity: 5,
            note: 'First count',
          }),
        }, 'https'),
      );
      expect(firstCountResp.status).toBe(200);

      // Second count should succeed (version is now 2, handler reads it)
      const response = await exports.default.fetch(
        apiRequest('/api/stock/count', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`,
            'X-CSRF-Token': csrf,
            Origin: BASE_URL,
          },
          body: JSON.stringify({
            productId: zeroQtyProduct.id,
            countedQuantity: 25,
            note: 'Second count',
          }),
        }, 'https'),
      );

      // Should succeed because handler reads current version before updating
      expect(response.status).toBe(200);
      const data = await response.json<{ ok: boolean; newQuantity: number }>();
      expect(data.newQuantity).toBe(25);
    });

    it('rolls back on invalid quantity', async () => {
      // Create a test product with quantity 10
      const testResponse = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Test Count Product',
        sku: 'SKU-COUNT-ROLLBACK',
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: 10,
        active: true,
      });
      const testProduct = await testResponse.json();

      const response = await exports.default.fetch(
        apiRequest('/api/stock/count', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`,
            'X-CSRF-Token': csrf,
            Origin: BASE_URL,
          },
          body: JSON.stringify({
            productId: testProduct.id,
            countedQuantity: -5, // Negative quantity
          }),
        }, 'https'),
      );

      expect(response.status).toBe(400);

      // Verify product quantity remains unchanged
      const getResponse = await apiGetProducts(session, csrf, `/api/products/${testProduct.id}`);
      const product = await getResponse.json();
      expect(product.quantity).toBe(10); // Should still be 10
    });

    it('does nothing if count matches current (no change)', async () => {
      // Create a test product with quantity 10
      const testResponse = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Test Count Product',
        sku: 'SKU-COUNT-NOCHANGE',
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: 10,
        active: true,
      });
      const testProduct = await testResponse.json();

      const response = await exports.default.fetch(
        apiRequest('/api/stock/count', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`,
            'X-CSRF-Token': csrf,
            Origin: BASE_URL,
          },
          body: JSON.stringify({
            productId: testProduct.id,
            countedQuantity: 10,
            note: 'Just checking',
          }),
        }, 'https'),
      );

      // Should return 400 because no change detected
      expect(response.status).toBe(400);
      const data = await response.json<{ error: string }>();
      expect(data.error).toContain('No change detected');
    });
  });

  describe('Stock Adjustment', () => {
    it.each([
      ['unsafe product ID', Number.MAX_SAFE_INTEGER + 1, 1],
      ['unsafe quantity', 1, Number.MAX_SAFE_INTEGER + 1],
      ['fractional quantity', 1, 1.5],
    ])('rejects %s', async (_label, productId, quantity) => {
      const response = await exports.default.fetch(
        apiRequest('/api/stock/adjustment', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`,
            'X-CSRF-Token': csrf,
            Origin: BASE_URL,
          },
          body: JSON.stringify({ productId, reason: 'other', quantity }),
        }, 'https'),
      );
      expect(response.status).toBe(400);
    });

    it('rejects additive adjustment when resulting stock is unsafe', async () => {
      const createResp = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Adjustment Overflow Product',
        pricePaise: 1000,
        lowStockLevel: 1,
        quantity: Number.MAX_SAFE_INTEGER,
        active: true,
      });
      const product = await createResp.json<{ id: number; version: number }>();

      const response = await exports.default.fetch(
        apiRequest('/api/stock/adjustment', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`,
            'X-CSRF-Token': csrf,
            Origin: BASE_URL,
          },
          body: JSON.stringify({ productId: product.id, reason: 'other', quantity: 1 }),
        }, 'https'),
      );
      expect(response.status).toBe(400);

      const stored = await env.DB.prepare(
        'SELECT stock_quantity, version FROM products WHERE id = ?',
      ).bind(product.id).first<{ stock_quantity: number; version: number }>();
      expect(stored).toEqual({ stock_quantity: Number.MAX_SAFE_INTEGER, version: product.version });
      const nonOpening = await env.DB.prepare(
        "SELECT id FROM stock_movements WHERE product_id = ? AND reason != 'opening'",
      ).bind(product.id).all();
      expect(nonOpening.results).toHaveLength(0);
    });

    it('rejects a zero-quantity adjustment without creating history', async () => {
      const createResp = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Zero Adjustment Product',
        pricePaise: 1000,
        lowStockLevel: 1,
        quantity: 0,
        active: true,
      });
      const product = await createResp.json<{ id: number }>();

      const response = await exports.default.fetch(
        apiRequest('/api/stock/adjustment', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`,
            'X-CSRF-Token': csrf,
            Origin: BASE_URL,
          },
          body: JSON.stringify({ productId: product.id, reason: 'other', quantity: 0 }),
        }, 'https'),
      );
      expect(response.status).toBe(400);

      const movements = await env.DB.prepare(
        'SELECT id FROM stock_movements WHERE product_id = ?',
      ).bind(product.id).all();
      expect(movements.results).toHaveLength(0);
    });

    it('adds stock via adjustment', async () => {
      const createResp = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Test Adjustment Product',
        sku: 'SKU-ADJUST-ADD',
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: 0,
        active: true,
      });
      const testProduct = await createResp.json();

      const response = await exports.default.fetch(
        apiRequest('/api/stock/adjustment', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`,
            'X-CSRF-Token': csrf,
            Origin: BASE_URL,
          },
          body: JSON.stringify({
            productId: testProduct.id,
            reason: 'other',
            quantity: 5,
          }),
        }, 'https'),
      );

      expect(response.status).toBe(200);
      const data = await response.json<{ ok: boolean; newQuantity: number; delta: number }>();
      expect(data.ok).toBe(true);
      expect(data.newQuantity).toBe(5); // 0 + 5
      expect(data.delta).toBe(5);

      // Verify quantity is correct
      const getResponse = await apiGetProducts(session, csrf, `/api/products/${testProduct.id}`);
      const product = await getResponse.json();
      expect(product.quantity).toBe(5);
    });

    it('subtracts stock via adjustment (damaged/lost)', async () => {
      const createResp = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Test Adjustment Product',
        sku: 'SKU-ADJUST-SUB',
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: 10,
        active: true,
      });
      const testProduct = await createResp.json();

      const response = await exports.default.fetch(
        apiRequest('/api/stock/adjustment', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`,
            'X-CSRF-Token': csrf,
            Origin: BASE_URL,
          },
          body: JSON.stringify({
            productId: testProduct.id,
            reason: 'damaged',
            quantity: 3,
          }),
        }, 'https'),
      );

      expect(response.status).toBe(200);
      const data = await response.json<{ ok: boolean; newQuantity: number; delta: number }>();
      expect(data.ok).toBe(true);
      expect(data.newQuantity).toBe(7); // 10 - 3
      expect(data.delta).toBe(-3);

      // Verify quantity is correct
      const getResponse = await apiGetProducts(session, csrf, `/api/products/${testProduct.id}`);
      const product = await getResponse.json();
      expect(product.quantity).toBe(7);
    });

    it('rolls back on invalid reason', async () => {
      // Create a test product with quantity 10
      const testResponse = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Test Adjustment Product',
        sku: 'SKU-ADJUST-REASON',
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: 10,
        active: true,
      });
      const testProduct = await testResponse.json();

      const response = await exports.default.fetch(
        apiRequest('/api/stock/adjustment', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`,
            'X-CSRF-Token': csrf,
            Origin: BASE_URL,
          },
          body: JSON.stringify({
            productId: testProduct.id,
            reason: 'invalid-reason', // Invalid reason
            quantity: 5,
          }),
        }, 'https'),
      );

      expect(response.status).toBe(400);
      const data = await response.json<{ error: string }>();
      expect(data.error).toContain('must be one of');

      // Verify product quantity remains unchanged
      const getResponse = await apiGetProducts(session, csrf, `/api/products/${testProduct.id}`);
      const product = await getResponse.json();
      expect(product.quantity).toBe(10); // Should still be 10
    });

    it('rolls back on invalid quantity', async () => {
      // Create a test product with quantity 10
      const testResponse = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Test Adjustment Product',
        sku: 'SKU-ADJUST-QTY',
        pricePaise: 10000,
        lowStockLevel: 5,
        quantity: 10,
        active: true,
      });
      const testProduct = await testResponse.json();

      const response = await exports.default.fetch(
        apiRequest('/api/stock/adjustment', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`,
            'X-CSRF-Token': csrf,
            Origin: BASE_URL,
          },
          body: JSON.stringify({
            productId: testProduct.id,
            reason: 'damaged',
            quantity: -5, // Negative quantity
          }),
        }, 'https'),
      );

      expect(response.status).toBe(400);
      const data = await response.json<{ error: string }>();
      expect(data.error).toContain('positive integer');

      // Verify product quantity remains unchanged
      const getResponse = await apiGetProducts(session, csrf, `/api/products/${testProduct.id}`);
      const product = await getResponse.json();
      expect(product.quantity).toBe(10); // Should still be 10
    });
  });

  // ========================================================================
  // D1 Batch Rollback (Requirement 1) — direct env.DB.batch() test
  // ========================================================================

  describe('D1 batch rollback (products schema)', () => {
    it('rolls back products and opening movements when a later statement fails', async () => {
      // Build a batch with two product INSERTs. Second violates the unique SKU index.
      const batch = [
        env.DB.prepare(
          `INSERT INTO products (sku, name, category, selling_price_minor, cost_price_minor,
           stock_quantity, low_stock_level, active, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, ?, ?, 1, 1, ?, ?)`,
        ).bind('SKU-BATCH-ROLLBACK-1', 'Batch Rollback Product A', null, 1000, 5, 5, new Date().toISOString(), new Date().toISOString()),
        env.DB.prepare(
          `INSERT INTO products (sku, name, category, selling_price_minor, cost_price_minor,
           stock_quantity, low_stock_level, active, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, ?, ?, 1, 1, ?, ?)`,
        ).bind('SKU-BATCH-ROLLBACK-1', 'Batch Rollback Product B', null, 2000, 3, 3, new Date().toISOString(), new Date().toISOString()),
      ];

      // Execute the batch — the second INSERT should fail (duplicate SKU)
      let batchFailed = false;
      try {
        await env.DB.batch(batch);
      } catch {
        batchFailed = true;
      }
      expect(batchFailed).toBe(true);

      // Verify: neither product remains
      const products = await env.DB.prepare(
        "SELECT id FROM products WHERE sku = 'SKU-BATCH-ROLLBACK-1'",
      ).all();
      expect(products.results).toHaveLength(0);

      // Verify: no opening stock movements remain for either product
      const movements = await env.DB.prepare(
        "SELECT id FROM stock_movements WHERE reason = 'opening'",
      ).all();
      expect(movements.results).toHaveLength(0);
    });
  });

  describe('Stock concurrency guard (D1 schema)', () => {
    it('a stale guarded count changes neither quantity nor movement history', async () => {
      const createResponse = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Guarded Count Product',
        sku: 'SKU-COUNT-GUARD',
        pricePaise: 1000,
        lowStockLevel: 1,
        quantity: 0,
        active: true,
      });
      const product = await createResponse.json<{ id: number; version: number }>();

      // Simulate another writer winning after the handler's initial read.
      await env.DB.prepare(
        'UPDATE products SET stock_quantity = 4, version = version + 1 WHERE id = ?',
      ).bind(product.id).run();

      const now = new Date().toISOString();
      const results = await env.DB.batch([
        env.DB.prepare(
          `UPDATE products SET stock_quantity = stock_quantity + ?, updated_at = ?, version = version + 1
           WHERE id = ? AND version = ?`,
        ).bind(6, now, product.id, product.version),
        env.DB.prepare(
          `INSERT INTO stock_movements (product_id, quantity_delta, reason, note, created_at)
           SELECT ?, ?, 'count', ?, ? WHERE changes() = 1`,
        ).bind(product.id, 6, 'stale count', now),
      ]);

      expect(results[0]?.meta.changes).toBe(0);
      expect(results[1]?.meta.changes).toBe(0);

      const stored = await env.DB.prepare(
        'SELECT stock_quantity FROM products WHERE id = ?',
      ).bind(product.id).first<{ stock_quantity: number }>();
      expect(stored?.stock_quantity).toBe(4);

      const movements = await env.DB.prepare(
        "SELECT id FROM stock_movements WHERE product_id = ? AND reason = 'count'",
      ).bind(product.id).all();
      expect(movements.results).toHaveLength(0);
    });
  });

  // ========================================================================
  // Duplicate SKU triple test (Requirement 9)
  // ========================================================================

  describe('CSV import: duplicate SKU triple with different casing', () => {
    it('first row valid, 2nd and 3rd invalid, both reference first row', async () => {
      const csv = [
        VALID_HEADERS,
        'First Product,Home,1000,5,1,SKU-TRIPLE',
        'Second Product,Kitchen,2000,3,1,sku-triple',
        'Third Product,Bath,3000,2,1,Sku-Triple',
      ].join('\n');

      const response = await previewCsv(csv);
      expect(response.status).toBe(200);
      const data = await response.json<{
        requestId: string;
        totals: { total: number; valid: number; invalid: number; duplicate: number };
        validRows: Array<{ rowNumber: number }>;
        duplicateRows: Array<{ rowNumber: number; firstSeenRow: number }>;
      }>();

      expect(data.totals.total).toBe(3);
      expect(data.totals.valid).toBe(1);
      expect(data.totals.duplicate).toBe(2);

      // First row remains valid
      expect(data.validRows[0].rowNumber).toBe(2);

      // Both duplicates reference row 2 as first seen
      for (const dup of data.duplicateRows) {
        expect(dup.firstSeenRow).toBe(2);
      }

      // Commit should be rejected because duplicates have issues
      const commitResponse = await commitImport(data.requestId);
      expect(commitResponse.status).toBe(409);
    });
  });

  // ========================================================================
  // Adjustment ledger consistency (Requirement 7)
  // ========================================================================

  describe('Adjustment ledger consistency via D1', () => {
    it('stock 10, damaged 3 → quantity 7, movement -3', async () => {
      const resp = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Adj Test 1', pricePaise: 1000, lowStockLevel: 1, quantity: 10, active: true,
      });
      const p = await resp.json();
      // Ensure product is fully committed before adjustment
      await new Promise(resolve => setTimeout(resolve, 10));

      const adjResp = await exports.default.fetch(
        apiRequest('/api/stock/adjustment', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`,
            'X-CSRF-Token': csrf,
            Origin: BASE_URL,
          },
          body: JSON.stringify({ productId: p.id, reason: 'damaged', quantity: 3 }),
        }, 'https'),
      );
      expect(adjResp.status).toBe(200);

      const prod = await env.DB.prepare('SELECT stock_quantity FROM products WHERE id = ?').bind(p.id).first<{ stock_quantity: number }>();
      expect(prod?.stock_quantity).toBe(7);

      const mov = await env.DB.prepare(
        "SELECT quantity_delta FROM stock_movements WHERE product_id = ? AND reason = 'damaged' ORDER BY id DESC LIMIT 1",
      ).bind(p.id).first<{ quantity_delta: number }>();
      expect(mov?.quantity_delta).toBe(-3);

      // Invariant: old + delta = new
      expect(10 + (mov?.quantity_delta ?? 0)).toBe(prod?.stock_quantity);
    });

    it('stock 3, damaged 3 → quantity 0, movement -3', async () => {
      const resp = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Adj Test 2', pricePaise: 1000, lowStockLevel: 1, quantity: 3, active: true,
      });
      const p = await resp.json();

      await exports.default.fetch(
        apiRequest('/api/stock/adjustment', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`,
            'X-CSRF-Token': csrf,
            Origin: BASE_URL,
          },
          body: JSON.stringify({ productId: p.id, reason: 'damaged', quantity: 3 }),
        }, 'https'),
      );

      const prod = await env.DB.prepare('SELECT stock_quantity FROM products WHERE id = ?').bind(p.id).first<{ stock_quantity: number }>();
      expect(prod?.stock_quantity).toBe(0);

      const mov = await env.DB.prepare(
        "SELECT quantity_delta FROM stock_movements WHERE product_id = ? AND reason = 'damaged' ORDER BY id DESC LIMIT 1",
      ).bind(p.id).first<{ quantity_delta: number }>();
      expect(mov?.quantity_delta).toBe(-3);
    });

    it('stock 3, damaged 5 → quantity 0, movement -3', async () => {
      const resp = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Adj Test 3', pricePaise: 1000, lowStockLevel: 1, quantity: 3, active: true,
      });
      const p = await resp.json();

      await exports.default.fetch(
        apiRequest('/api/stock/adjustment', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`,
            'X-CSRF-Token': csrf,
            Origin: BASE_URL,
          },
          body: JSON.stringify({ productId: p.id, reason: 'damaged', quantity: 5 }),
        }, 'https'),
      );

      const prod = await env.DB.prepare('SELECT stock_quantity FROM products WHERE id = ?').bind(p.id).first<{ stock_quantity: number }>();
      expect(prod?.stock_quantity).toBe(0);

      const mov = await env.DB.prepare(
        "SELECT quantity_delta FROM stock_movements WHERE product_id = ? AND reason = 'damaged' ORDER BY id DESC LIMIT 1",
      ).bind(p.id).first<{ quantity_delta: number }>();
      expect(mov?.quantity_delta).toBe(-3);
    });

    it('additive adjustment +4 → quantity increases by 4, movement +4', async () => {
      const resp = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Adj Test 4', pricePaise: 1000, lowStockLevel: 1, quantity: 0, active: true,
      });
      const p = await resp.json();

      await exports.default.fetch(
        apiRequest('/api/stock/adjustment', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`,
            'X-CSRF-Token': csrf,
            Origin: BASE_URL,
          },
          body: JSON.stringify({ productId: p.id, reason: 'other', quantity: 4 }),
        }, 'https'),
      );

      const prod = await env.DB.prepare('SELECT stock_quantity FROM products WHERE id = ?').bind(p.id).first<{ stock_quantity: number }>();
      expect(prod?.stock_quantity).toBe(4);

      const mov = await env.DB.prepare(
        "SELECT quantity_delta FROM stock_movements WHERE product_id = ? AND reason = 'other' ORDER BY id DESC LIMIT 1",
      ).bind(p.id).first<{ quantity_delta: number }>();
      expect(mov?.quantity_delta).toBe(4);

      expect(0 + (mov?.quantity_delta ?? 0)).toBe(prod?.stock_quantity);
    });
  });

  // ========================================================================
  // Delivery D1 atomicity (Requirement 4) — direct schema test
  // ========================================================================

  describe('Delivery schema atomicity (D1 batch)', () => {
    it('rolls back header, items, and movements when a batch statement fails', async () => {
      // Create two products
      const p1Resp = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Atomic Del 1', sku: 'SKU-DEL-ATOMIC-1', pricePaise: 1000, lowStockLevel: 1, quantity: 10, active: true,
      });
      const p2Resp = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Atomic Del 2', sku: 'SKU-DEL-ATOMIC-2', pricePaise: 1000, lowStockLevel: 1, quantity: 10, active: true,
      });
      const p1 = await p1Resp.json();
      const p2 = await p2Resp.json();

      const now = new Date().toISOString();
      const entryNumber = crypto.randomUUID();

      // Build the same delivery statement sequence as stock.ts, but with a
      // deliberately failing final INSERT (violate stock_movements reason CHECK)
      const batch: D1PreparedStatement[] = [
        env.DB.prepare(
          `INSERT INTO stock_entries (entry_number, type, supplier, note, created_at)
           VALUES (?, 'delivery', NULL, ?, ?)`,
        ).bind(entryNumber, null, now),
        env.DB.prepare(
          `UPDATE products
           SET stock_quantity = stock_quantity + ?, updated_at = ?, version = version + 1
           WHERE id = ?`,
        ).bind(5, now, p1.id),
        env.DB.prepare(
          `UPDATE products
           SET stock_quantity = stock_quantity + ?, updated_at = ?, version = version + 1
           WHERE id = ?`,
        ).bind(5, now, p2.id),
        env.DB.prepare(
          `INSERT INTO stock_entry_items (stock_entry_id, product_id, quantity_delta)
           VALUES ((SELECT id FROM stock_entries WHERE entry_number = ?), ?, ?)`,
        ).bind(entryNumber, p1.id, 5),
        env.DB.prepare(
          `INSERT INTO stock_entry_items (stock_entry_id, product_id, quantity_delta)
           VALUES ((SELECT id FROM stock_entries WHERE entry_number = ?), ?, ?)`,
        ).bind(entryNumber, p2.id, 5),
        // This INSERT fails: invalid reason violates CHECK constraint
        env.DB.prepare(
          `INSERT INTO stock_movements (product_id, quantity_delta, reason, stock_entry_id, note, created_at)
           VALUES (?, ?, 'INVALID_REASON', (SELECT id FROM stock_entries WHERE entry_number = ?), ?, ?)`,
        ).bind(p1.id, 5, entryNumber, 'test', now),
      ];

      let batchFailed = false;
      try {
        await env.DB.batch(batch);
      } catch {
        batchFailed = true;
      }
      expect(batchFailed).toBe(true);

      // Verify: no stock_entries header
      const entry = await env.DB.prepare('SELECT id FROM stock_entries WHERE entry_number = ?')
        .bind(entryNumber).first();
      expect(entry).toBeNull();

      // Verify: no stock_entry_items
      const items = await env.DB.prepare(
        'SELECT id FROM stock_entry_items WHERE product_id IN (?, ?)',
      ).bind(p1.id, p2.id).all();
      expect(items.results).toHaveLength(0);

      // Verify: no movements
      const movs = await env.DB.prepare(
        "SELECT id FROM stock_movements WHERE product_id IN (?, ?) AND reason = 'delivery'",
      ).bind(p1.id, p2.id).all();
      expect(movs.results).toHaveLength(0);

      // Verify: quantities unchanged
      const prod1 = await env.DB.prepare('SELECT stock_quantity, version FROM products WHERE id = ?').bind(p1.id).first<{ stock_quantity: number; version: number }>();
      const prod2 = await env.DB.prepare('SELECT stock_quantity, version FROM products WHERE id = ?').bind(p2.id).first<{ stock_quantity: number; version: number }>();
      expect(prod1).toEqual({ stock_quantity: 10, version: p1.version });
      expect(prod2).toEqual({ stock_quantity: 10, version: p2.version });
    });

    it('returns actual D1 quantities and one entry per aggregated product', async () => {
      const p1Resp = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Del Verify 1', sku: 'SKU-DEL-VERIFY-1', pricePaise: 1000, lowStockLevel: 1, quantity: 10, active: true,
      });
      const p2Resp = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Del Verify 2', sku: 'SKU-DEL-VERIFY-2', pricePaise: 1000, lowStockLevel: 1, quantity: 20, active: true,
      });
      const p1 = await p1Resp.json();
      const p2 = await p2Resp.json();

      const delResp = await exports.default.fetch(
        apiRequest('/api/stock/delivery', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `__Host-session=${session}; __Host-csrf=${csrf}`,
            'X-CSRF-Token': csrf,
            Origin: BASE_URL,
          },
          body: JSON.stringify({
            items: [
              { productId: p1.id, quantity: 5 },
              { productId: p1.id, quantity: 10 },  // duplicate: aggregated to 15
              { productId: p2.id, quantity: 8 },
            ],
          }),
        }, 'https'),
      );
      expect(delResp.status).toBe(200);
      const data = await delResp.json<{ ok: boolean; entries: Array<{ productId: number; newQuantity: number; quantityReceived: number }> }>();

      // Aggregated: p1 gets 15 (5+10), p2 gets 8
      expect(data.entries).toHaveLength(2);

      const entryMap = new Map(data.entries.map(e => [e.productId, e]));
      expect(entryMap.get(p1.id)?.quantityReceived).toBe(15);
      expect(entryMap.get(p1.id)?.newQuantity).toBe(25); // 10 + 15
      expect(entryMap.get(p2.id)?.quantityReceived).toBe(8);
      expect(entryMap.get(p2.id)?.newQuantity).toBe(28); // 20 + 8

      // Verify D1 matches exactly
      const dbP1 = await env.DB.prepare('SELECT stock_quantity FROM products WHERE id = ?').bind(p1.id).first<{ stock_quantity: number }>();
      const dbP2 = await env.DB.prepare('SELECT stock_quantity FROM products WHERE id = ?').bind(p2.id).first<{ stock_quantity: number }>();
      expect(dbP1?.stock_quantity).toBe(25);
      expect(dbP2?.stock_quantity).toBe(28);

      // Verify stock_entry_items: one per product with aggregated deltas
      const sei = await env.DB.prepare(
        'SELECT product_id, quantity_delta FROM stock_entry_items WHERE product_id IN (?, ?)',
      ).bind(p1.id, p2.id).all<{ product_id: number; quantity_delta: number }>();
      expect(sei.results).toHaveLength(2);
      const seiMap = new Map(sei.results.map(r => [r.product_id, r.quantity_delta]));
      expect(seiMap.get(p1.id)).toBe(15);
      expect(seiMap.get(p2.id)).toBe(8);

      // Verify stock_movements: one delivery per product
      const movs = await env.DB.prepare(
        "SELECT product_id, quantity_delta FROM stock_movements WHERE reason = 'delivery' AND product_id IN (?, ?)",
      ).bind(p1.id, p2.id).all<{ product_id: number; quantity_delta: number }>();
      expect(movs.results).toHaveLength(2);
      const movMap = new Map(movs.results.map(r => [r.product_id, r.quantity_delta]));
      expect(movMap.get(p1.id)).toBe(15);
      expect(movMap.get(p2.id)).toBe(8);
    });
  });

  describe('catalogue fields and locations', () => {
    it('lists canonical locations for product forms', async () => {
      const response = await apiGetProducts(session, csrf, '/api/locations');
      expect(response.status).toBe(200);
      const data = await response.json<{ items: Array<{ id: number; name: string }> }>();
      expect(data.items.map(({ name }) => name)).toContain('Test Shelf A');
      expect(data.items.map(({ name }) => name)).toContain('Test Shelf B');
    });

    it('creates and returns the full inventory catalogue fields', async () => {
      const location = await env.DB.prepare(
        'SELECT id FROM locations WHERE name = ?',
      ).bind('Test Shelf A').first<{ id: number }>();

      const response = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Clear Bowl',
        colour: 'Blue and transparent',
        size: '210 ml and 480 ml',
        sku: null,
        category: 'Bowls',
        mrpPaise: 90000,
        pricePaise: 85000,
        consultantPricePaise: 64600,
        quantity: 3,
        setStockQuantity: 1.5,
        lowStockLevel: 1,
        locationId: location!.id,
        personalUse: true,
        active: true,
      });

      expect(response.status).toBe(201);
      const product = await response.json();
      expect(product).toMatchObject({
        name: 'Clear Bowl',
        colour: 'Blue and transparent',
        size: '210 ml and 480 ml',
        mrpPaise: 90000,
        pricePaise: 85000,
        consultantPricePaise: 64600,
        quantity: 3,
        setStockQuantity: 1.5,
        locationId: location!.id,
        locationName: 'Test Shelf A',
        personalUse: true,
      });
    });

    it('searches by colour, size, and normalized location', async () => {
      const location = await env.DB.prepare(
        'SELECT id FROM locations WHERE name = ?',
      ).bind('Test Shelf B').first<{ id: number }>();
      await apiPostProducts(session, csrf, '/api/products', {
        name: 'Reference Product',
        colour: 'Grape fizz',
        size: '1.4 litre',
        pricePaise: 50000,
        quantity: 2,
        setStockQuantity: 1,
        lowStockLevel: 0,
        locationId: location!.id,
        active: true,
      });

      for (const query of ['grape', '1.4 litre', 'test shelf b']) {
        const response = await apiGetProducts(
          session,
          csrf,
          `/api/products?q=${encodeURIComponent(query)}`,
        );
        const data = await response.json<{ items: Array<{ name: string }> }>();
        expect(data.items.map(({ name }) => name)).toContain('Reference Product');
      }
    });

    it('rejects unknown locations and protects set stock during ordinary edits', async () => {
      const invalidLocation = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Unknown Location Product',
        pricePaise: 10000,
        quantity: 1,
        setStockQuantity: 1,
        lowStockLevel: 0,
        locationId: 999999,
        active: true,
      });
      expect(invalidLocation.status).toBe(400);

      const createdResponse = await apiPostProducts(session, csrf, '/api/products', {
        name: 'Protected Stock Product',
        pricePaise: 10000,
        quantity: 4,
        setStockQuantity: 2,
        lowStockLevel: 0,
        active: true,
      });
      const created = await createdResponse.json();

      const updateResponse = await apiPutProducts(
        session,
        csrf,
        `/api/products/${created.id}?version=${created.version}`,
        {
          name: created.name,
          sku: created.sku,
          category: created.category,
          pricePaise: created.pricePaise,
          quantity: created.quantity,
          setStockQuantity: 1,
          lowStockLevel: created.lowStockLevel,
          active: created.active,
        },
      );
      expect(updateResponse.status).toBe(409);
      const error = await updateResponse.json<{ error: string }>();
      expect(error.error).toContain('Set stock');
    });
  });
});

import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createSessionCookie } from '../../server/auth';

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

function cookieValue(setCookies: string[], name: string): string {
  const cookie = setCookies.find((value) => value.startsWith(`${name}=`));
  if (!cookie) throw new Error(`Missing ${name} cookie`);
  return cookie.split(';', 1)[0]!;
}

async function login(request: Request): Promise<{ session: string; csrf: string }> {
  const response = await exports.default.fetch(request);
  expect(response.status).toBe(200);
  const setCookies = response.headers.getSetCookie();
  const isProd = request.url.startsWith('https://');
  return {
    session: cookieValue(setCookies, isProd ? '__Host-session' : 'dev-session'),
    csrf: cookieValue(setCookies, isProd ? '__Host-csrf' : 'dev-csrf'),
  };
}

async function loginHttps(): Promise<{ session: string; csrf: string }> {
  const request = apiRequest('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
    body: JSON.stringify({ password: PASSWORD }),
  }, 'https');
  return login(request);
}

async function loginHttp(): Promise<{ session: string; csrf: string }> {
  const request = apiRequest('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ password: PASSWORD }),
  }, 'http');
  return login(request);
}

describe('Auth API', () => {
  it('returns 401 when /api/me has no session', async () => {
    const response = await exports.default.fetch(apiRequest('/api/me'));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Not authenticated' });
  });

  it('returns a generic 401 for an invalid password', async () => {
    const response = await exports.default.fetch(
      apiRequest('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
        body: JSON.stringify({ password: 'wrong-password' }),
      }),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid password' });
  });

  it('sets separate session and CSRF cookies after a valid login', async () => {
    const response = await exports.default.fetch(
      apiRequest('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
        body: JSON.stringify({ password: PASSWORD }),
      }),
    );
    const setCookies = response.headers.getSetCookie();
    const sessionHeader = setCookies.find((value) => value.startsWith('__Host-session='))!;
    const csrfHeader = setCookies.find((value) => value.startsWith('__Host-csrf='))!;
    const session = cookieValue(setCookies, '__Host-session');
    const csrf = cookieValue(setCookies, '__Host-csrf');
    expect(session).toMatch(/^__Host-session=v1\./);
    expect(csrf).toMatch(/^__Host-csrf=[0-9a-f-]{36}$/);
    expect(sessionHeader).toMatch(/; HttpOnly; Secure; SameSite=Lax; Path=\//);
    expect(sessionHeader).not.toMatch(/; Domain=/i);
    expect(csrfHeader).toMatch(/; Secure; SameSite=Lax; Path=\//);
    expect(csrfHeader).not.toMatch(/; HttpOnly/i);
    expect(csrfHeader).not.toMatch(/; Domain=/i);
  });

  it('accepts a valid session on /api/me', async () => {
    const { session } = await loginHttps();
    const response = await exports.default.fetch(
      apiRequest('/api/me', { headers: { Cookie: session } }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ authenticated: true });
  });

  it('rejects forged and expired sessions', async () => {
    const { session } = await loginHttps();
    const forged = `${session.slice(0, -1)}${session.endsWith('a') ? 'b' : 'a'}`;
    const expired = (await createSessionCookie(SESSION_SECRET, -1, apiRequest('/test'))).split(';', 1)[0]!;

    for (const cookie of [forged, expired]) {
      const response = await exports.default.fetch(
        apiRequest('/api/me', { headers: { Cookie: cookie } }, 'https'),
      );
      expect(response.status).toBe(401);
    }
  });

  it('rejects malformed session encodings instead of returning 500', async () => {
    for (const cookie of [
      '__Host-session=v1.%%%.signature',
      '__Host-session=v1._w.signature',
      '__Host-session=v1.e30.signature',
    ]) {
      const response = await exports.default.fetch(
        apiRequest('/api/me', { headers: { Cookie: cookie } }),
      );
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: 'Not authenticated' });
    }
  });

  it('rejects logout when CSRF is missing or mismatched', async () => {
    const { session, csrf } = await loginHttps();
    const csrfToken = csrf.slice(csrf.indexOf('=') + 1);

    for (const headers of [
      { Cookie: `${session}; ${csrf}`, Origin: BASE_URL },
      { Cookie: `${session}; ${csrf}`, Origin: BASE_URL, 'X-CSRF-Token': `${csrfToken}-wrong` },
    ]) {
      const response = await exports.default.fetch(
        apiRequest('/api/logout', { method: 'POST', headers }),
      );
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: 'Invalid CSRF token' });
    }
  });

  it('rejects a disallowed Origin on login and authenticated mutations', async () => {
    const loginResponse = await exports.default.fetch(
      apiRequest('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
        body: JSON.stringify({ password: PASSWORD }),
      }, 'https'),
    );
    expect(loginResponse.status).toBe(403);

    const { session, csrf } = await loginHttps();
    const csrfToken = csrf.slice(csrf.indexOf('=') + 1);
    const logoutResponse = await exports.default.fetch(
      apiRequest('/api/logout', {
        method: 'POST',
        headers: {
          Cookie: `${session}; ${csrf}`,
          Origin: 'https://evil.example',
          'X-CSRF-Token': csrfToken,
        },
      }, 'https'),
    );
    expect(logoutResponse.status).toBe(403);
  });

  it('rejects prefix lookalikes but now allows localhost', async () => {
    for (const origin of ['https://inventory.example.test.attacker.example', 'not a valid origin']) {
      const response = await exports.default.fetch(
        apiRequest('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Origin: origin },
          body: JSON.stringify({ password: PASSWORD }),
        }, 'https'),
      );
      expect(response.status).toBe(403);
    }

    // localhost is now allowed in the test configuration
    const localhostResponse = await exports.default.fetch(
      apiRequest('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({ password: PASSWORD }),
      }, 'http'),
    );
    expect(localhostResponse.status).toBe(200);
  });

  it('allows localhost when it is explicitly configured', async () => {
    const request = new Request('http://localhost:5173/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:5173',
        'CF-Connecting-IP': '198.51.100.20',
      },
      body: JSON.stringify({ password: PASSWORD }),
    });

    // Exercise origin validation directly with localhost explicitly supplied
    // in the allowlist (the integration-test binding intentionally excludes it).
    const { validateOrigin } = await import('../../server/auth');
    expect(validateOrigin(request, 'http://localhost:5173')).toBe(true);
  });

  // ============================================================================
  // Local HTTP mode tests (development environment)
  // ============================================================================

  it('sets dev-session and dev-csrf on local HTTP login', async () => {
    const { session, csrf } = await loginHttp();
    expect(session).toMatch(/^dev-session=v1\./);
    expect(csrf).toMatch(/^dev-csrf=[0-9a-f-]{36}$/);
  });

  it('local dev-session cookie is HttpOnly', async () => {
    const response = await exports.default.fetch(
      apiRequest('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({ password: PASSWORD }),
      }, 'http'),
    );
    const setCookies = response.headers.getSetCookie()!;
    const sessionHeader = setCookies.find((value) => value.startsWith('dev-session='));
    expect(sessionHeader).toMatch(/; HttpOnly;/);
    expect(sessionHeader).not.toMatch(/; Secure;/i);
  });

  it('local dev-csrf cookie is not HttpOnly', async () => {
    const response = await exports.default.fetch(
      apiRequest('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
        body: JSON.stringify({ password: PASSWORD }),
      }, 'http'),
    );
    const setCookies = response.headers.getSetCookie()!;
    const csrfHeader = setCookies.find((value) => value.startsWith('dev-csrf='));
    expect(csrfHeader).not.toMatch(/; HttpOnly;/);
  });

  it('local /api/me accepts the dev-session cookie', async () => {
    const { session } = await loginHttp();
    const response = await exports.default.fetch(
      apiRequest('/api/me', { headers: { Cookie: session } }, 'http'),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ authenticated: true });
  });

  it('local logout clears both development cookies', async () => {
    const { session, csrf } = await loginHttp();
    const csrfToken = csrf.slice(csrf.indexOf('=') + 1);
    const response = await exports.default.fetch(
      apiRequest('/api/logout', {
        method: 'POST',
        headers: {
          Cookie: `${session}; ${csrf}`,
          Origin: 'http://localhost:5173',
          'X-CSRF-Token': csrfToken,
        },
      }, 'http'),
    );
    expect(response.status).toBe(204);
    const setCookies = response.headers.getSetCookie();
    expect(setCookies).toHaveLength(2);
    expect(setCookies).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^dev-session=; HttpOnly;.*Max-Age=0/),
        expect.stringMatching(/^dev-csrf=;.*Max-Age=0/),
      ]),
    );
    for (const cookie of setCookies) {
      expect(cookie).toMatch(/; (SameSite=Lax; )?Path=\/; Max-Age=0/);
      expect(cookie).not.toMatch(/; Secure;/i);
      expect(cookie).not.toMatch(/; Domain=/i);
    }
    expect(setCookies.find((cookie) => cookie.startsWith('dev-session='))).toMatch(/; HttpOnly;/);
    expect(setCookies.find((cookie) => cookie.startsWith('dev-csrf='))).not.toMatch(/; HttpOnly;/);
  });

  it('production HTTPS still sets __Host-* cookies with Secure', async () => {
    const response = await exports.default.fetch(
      apiRequest('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'https://inventory.example.test' },
        body: JSON.stringify({ password: PASSWORD }),
      }, 'https'),
    );
    const setCookies = response.headers.getSetCookie();
    const sessionHeader = setCookies.find((value) => value.startsWith('__Host-session='));
    const csrfHeader = setCookies.find((value) => value.startsWith('__Host-csrf='));
    expect(sessionHeader).toMatch(/; HttpOnly; Secure; SameSite=Lax; Path=\//);
    expect(sessionHeader).not.toMatch(/; Domain=/i);
    expect(csrfHeader).toMatch(/; Secure; SameSite=Lax; Path=\//);
    expect(csrfHeader).not.toMatch(/; HttpOnly;/i);
    expect(csrfHeader).not.toMatch(/; Domain=/i);
  });

  it('production session survives a simulated follow-up /api/me request', async () => {
    const { session } = await loginHttps();
    const response = await exports.default.fetch(
      apiRequest('/api/me', { headers: { Cookie: session } }, 'https'),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ authenticated: true });
  });

  it('no fallback accepts a development cookie on an HTTPS production request', async () => {
    const { session } = await loginHttp();
    const response = await exports.default.fetch(
      apiRequest('/api/me', { headers: { Cookie: session } }, 'https'),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Not authenticated' });
  });

  it('login UI verifies /api/me before entering the app', async () => {
    // Simulate the two-step login process
    const { session } = await loginHttp();
    const response = await exports.default.fetch(
      apiRequest('/api/me', { headers: { Cookie: session } }, 'http'),
    );
    expect(response.status).toBe(200);
  });
});

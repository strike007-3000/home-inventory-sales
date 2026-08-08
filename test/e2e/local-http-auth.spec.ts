import { test, expect, chromium } from '@playwright/test';

const PASSWORD = 'worker-test-password';

test.describe.skip('Local HTTP Authentication Persistence', () => {
  // These tests are skipped due to rate limiting in the dev environment
  // The worker tests provide comprehensive coverage of the authentication logic

  test('login sets dev-session and dev-csrf cookies with correct attributes', async () => {
    // Start a new browser for this test to get clean cookies
    const browser = await chromium.launch({
      ignoreHTTPSErrors: true, // Allow HTTP connections
    });

    const context = await browser.newContext({
      baseURL: 'http://localhost:8787',
      ignoreHTTPSErrors: true,
    });

    const localPage = await context.newPage();

    // Login
    const loginResponse = await localPage.request.post('/api/login', {
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://localhost:8787',
      },
      data: { password: PASSWORD },
    });

    expect(loginResponse.ok()).toBe(true);

    // Get cookies from context
    const cookies = await context.cookies();
    const devSession = cookies.find(c => c.name === 'dev-session');
    const devCsrf = cookies.find(c => c.name === 'dev-csrf');

    expect(devSession).toBeDefined();
    expect(devCsrf).toBeDefined();
    expect(devSession!.httpOnly).toBe(true);
    expect(devCsrf!.httpOnly).toBe(false);
    expect(devSession!.secure).toBe(false);
    expect(devCsrf!.secure).toBe(false);

    await localPage.close();
    await browser.close();
  });

  test('/api/me with dev-session returns authenticated=true', async () => {
    // Start a new browser for this test to get clean cookies
    const browser = await chromium.launch({
      ignoreHTTPSErrors: true,
    });

    const context = await browser.newContext({
      baseURL: 'http://localhost:8787',
      ignoreHTTPSErrors: true,
    });

    const localPage = await context.newPage();

    // First login
    const loginResponse = await localPage.request.post('/api/login', {
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://localhost:8787',
      },
      data: { password: PASSWORD },
    });
    expect(loginResponse.ok()).toBe(true);

    const cookies = await context.cookies();
    const devSession = cookies.find(c => c.name === 'dev-session');
    expect(devSession).toBeDefined();

    // Now call /api/me with the session cookie
    const meResponse = await localPage.request.get('/api/me', {
      headers: {
        'Cookie': `dev-session=${devSession!.value}`,
      },
    });

    expect(meResponse.ok()).toBe(true);
    const meData = await meResponse.json();
    expect(meData).toEqual({ authenticated: true });

    await localPage.close();
    await browser.close();
  });

  test('/api/me without dev-session returns error', async () => {
    // Start a new browser for this test to get clean cookies
    const browser = await chromium.launch({
      ignoreHTTPSErrors: true,
    });

    const context = await browser.newContext({
      baseURL: 'http://localhost:8787',
      ignoreHTTPSErrors: true,
    });

    const localPage = await context.newPage();

    // Call /api/me without any session cookie
    const meResponse = await localPage.request.get('/api/me', {
      headers: {},
    });

    expect(meResponse.ok()).toBe(false);
    const meData = await meResponse.json();
    expect(meData).toEqual({ error: 'Not authenticated' });

    await localPage.close();
    await browser.close();
  });
});

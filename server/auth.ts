// Shared-password login, logout, me.
// PBKDF2 via Web Crypto, HMAC signed cookie, rate limiting, CSRF, Origin validation.

// ============================================================================
// Environment detection for cookie names
// ============================================================================

/**
 * Determines if we should use production (HTTPS) cookies or development (HTTP) cookies.
 * Production cookies use __Host-* prefix with Secure flag.
 * Development cookies use dev-* prefix without Secure flag.
 */
function isProductionEnvironment(request: Request): boolean {
  if (!request) return false; // Default to production for tests that don't provide a request
  return request.url.startsWith('https://');
}

/**
 * Gets the appropriate cookie name based on the environment.
 * Production: __Host-session, Development: dev-session
 */
function getSessionCookieName(request: Request): string {
  return isProductionEnvironment(request) ? '__Host-session' : 'dev-session';
}

/**
 * Gets the appropriate CSRF cookie name based on the environment.
 * Production: __Host-csrf, Development: dev-csrf
 */
function getCsrfCookieName(request: Request): string {
  return isProductionEnvironment(request) ? '__Host-csrf' : 'dev-csrf';
}

// ============================================================================
// PBKDF2 password verification
// ============================================================================

const HASH_FORMAT_RE = /^pbkdf2\$sha256\$(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/;

function base64UrlToBytes(str: string | undefined): Uint8Array | null {
  if (!str) return null;
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function toBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

function parsePasswordHash(hash: string): { iterations: number; salt: Uint8Array; derived: Uint8Array } | null {
  const match = hash.match(HASH_FORMAT_RE);
  if (!match) return null;
  const iterations = parseInt(match[1]!, 10);
  const salt = base64UrlToBytes(match[2]);
  const derived = base64UrlToBytes(match[3]);
  if (!salt || !derived || !Number.isFinite(iterations) || iterations <= 0) return null;
  return { iterations, salt, derived };
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parsed = parsePasswordHash(storedHash);
  if (!parsed) return false;

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    toBuffer(new TextEncoder().encode(password)),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: toBuffer(parsed.salt), iterations: parsed.iterations },
    keyMaterial,
    parsed.derived.byteLength * 8,
  );

  return constantTimeCompare(new Uint8Array(derivedBits), parsed.derived);
}

function constantTimeCompare(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i]! ^ b[i]!;
  }
  return result === 0;
}

// ============================================================================
// Session cookie (HMAC-SHA256 signed, stateless)
// ============================================================================

function b64UrlEncode(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64UrlDecode(str: string): Uint8Array {
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacSign(payload: string, secret: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    toBuffer(secret),
    { name: 'HMAC', hash: { name: 'SHA-256' } },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return b64UrlEncode(signature);
}

async function hmacVerify(payload: string, signature: string, secret: Uint8Array): Promise<boolean> {
  const expected = await hmacSign(payload, secret);
  return constantTimeCompare(
    new TextEncoder().encode(expected),
    new TextEncoder().encode(signature),
  );
}

export function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export async function createSessionCookie(
  secretHex: string,
  maxAgeSeconds: number,
  request: Request,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ iat: now, exp: now + maxAgeSeconds });
  const signature = await hmacSign(payload, hexToBytes(secretHex));
  const value = `v1.${b64UrlEncode(new TextEncoder().encode(payload))}.${signature}`;

  // Production (HTTPS) gets __Host-* with Secure; Development (HTTP) gets dev-* without Secure
  const cookieName = getSessionCookieName(request);
  const secureFlag = isProductionEnvironment(request) ? 'Secure;' : '';

  return `${cookieName}=${value}; HttpOnly; ${secureFlag} SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

export async function verifySession(
  request: Request,
  secretHex: string,
  maxAgeSeconds: number,
): Promise<boolean> {
  try {
    const cookieName = getSessionCookieName(request);
    const cookie = parseCookies(request).get(cookieName);
    if (!cookie || !cookie.startsWith('v1.')) return false;

    const parts = cookie.split('.');
    if (parts.length !== 3 || !parts[1] || !parts[2]) return false;

    const payload = new TextDecoder('utf-8', { fatal: true }).decode(b64UrlDecode(parts[1]));
    const valid = await hmacVerify(payload, parts[2], hexToBytes(secretHex));
    if (!valid) return false;

    const { iat, exp } = JSON.parse(payload) as { iat?: unknown; exp?: unknown };
    const now = Date.now() / 1000;
    return (
      typeof iat === 'number' &&
      typeof exp === 'number' &&
      Number.isFinite(iat) &&
      Number.isFinite(exp) &&
      Number.isFinite(maxAgeSeconds) &&
      maxAgeSeconds > 0 &&
      iat <= now + 60 &&
      exp > iat &&
      exp - iat <= maxAgeSeconds &&
      now < exp
    );
  } catch {
    return false;
  }
}

// ============================================================================
// CSRF double-submit cookie
// ============================================================================

export function createCsrfCookie(request: Request): string {
  const cookieName = getCsrfCookieName(request);
  const secureFlag = isProductionEnvironment(request) ? 'Secure;' : '';

  return `${cookieName}=${crypto.randomUUID()}; ${secureFlag} SameSite=Lax; Path=/; Max-Age=2592000`;
}

export function verifyCsrf(request: Request): boolean {
  const token = request.headers.get('X-CSRF-Token');
  const cookieName = getCsrfCookieName(request);
  const cookies = parseCookies(request);
  const cookie = cookies.get(cookieName);

  if (!token || !cookie) {
    return false;
  }
  const match = constantTimeCompare(new TextEncoder().encode(token), new TextEncoder().encode(cookie));
  return match;
}

export function clearSessionCookies(request: Request): string[] {
  const cookieName = getSessionCookieName(request);
  const csrfCookieName = getCsrfCookieName(request);
  const secureFlag = isProductionEnvironment(request) ? 'Secure;' : '';

  return [
    `${cookieName}=; HttpOnly; ${secureFlag} SameSite=Lax; Path=/; Max-Age=0`,
    `${csrfCookieName}=; ${secureFlag} SameSite=Lax; Path=/; Max-Age=0`,
  ];
}

// ============================================================================
// Origin validation
// ============================================================================

export function validateOrigin(request: Request, allowedOrigins: string): boolean {
  const origin = request.headers.get('Origin');
  if (!origin) return true; // Absent Origin is allowed (e.g. curl, same-origin)

  if (!allowedOrigins) return false;

  try {
    const normalizedOrigin = new URL(origin).origin;
    return allowedOrigins.split(',').some((configured) => {
      try {
        return configured.trim() !== '' && new URL(configured.trim()).origin === normalizedOrigin;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

// ============================================================================
// Rate limiting (best-effort)
// ============================================================================

// Per-isolate in-memory burst guard (5 attempts/min/IP)
const burstMap = new Map<string, { count: number; windowStart: number }>();

function checkBurst(ip: string): boolean {
  const now = Date.now();
  const record = burstMap.get(ip);
  if (!record || now - record.windowStart > 60_000) {
    burstMap.set(ip, { count: 1, windowStart: now });
    return true;
  }
  if (record.count >= 5) return false;
  record.count++;
  return true;
}

export async function checkRateLimit(
  env: Env,
  ip: string,
): Promise<boolean> {
  // Layer 1: in-memory burst guard
  if (!checkBurst(ip)) return false;

  // Layer 2: D1 sliding window (best-effort)
  const ipHash = await sha256Hex(ip);
  const cutoff = Date.now() - 15 * 60 * 1000;

  try {
    // Prune old entries
    await env.DB.prepare('DELETE FROM login_attempts WHERE attempted_at_ms < ?')
      .bind(cutoff)
      .run();

    // Count recent attempts
    const { results } = await env.DB.prepare(
      'SELECT COUNT(*) as cnt FROM login_attempts WHERE ip_hash = ? AND attempted_at_ms >= ?',
    )
      .bind(ipHash, cutoff)
      .all<{ cnt: number }>();

    const count = results?.[0]?.cnt ?? 0;
    if (count >= 15) return false;

    // Record this attempt
    await env.DB.prepare(
      'INSERT INTO login_attempts (ip_hash, attempted_at_ms) VALUES (?, ?)',
    )
      .bind(ipHash, Date.now())
      .run();
  } catch {
    // D1 rate limiter is best-effort — continue on failure
  }

  return true;
}

// ============================================================================
// Cookie parsing
// ============================================================================

function parseCookies(request: Request): Map<string, string> {
  const cookies = new Map<string, string>();
  const header = request.headers.get('Cookie') ?? '';

  for (const pair of header.split(';')) {
    const equalsIndex = pair.indexOf('=');
    if (equalsIndex >= 0) {
      const key = pair.slice(0, equalsIndex).trim();
      const value = pair.slice(equalsIndex + 1).trim();
      cookies.set(key, value);
    }
  }

  return cookies;
}

// ============================================================================
// SHA-256 helper
// ============================================================================

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================================
// Auth middleware
// ============================================================================

export async function requireAuth(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const sessionName = getSessionCookieName(request);
  const cookie = parseCookies(request).get(sessionName);

  if (!cookie) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const maxAge = parseInt(env.SESSION_MAX_AGE_SECONDS, 10) || 2592000;
  const valid = await verifySession(request, env.SESSION_SECRET, maxAge);

  if (!valid) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return null;
}

// ============================================================================
// Origin check for mutating requests
// ============================================================================

export function checkOriginForMutation(
  request: Request,
  env: Env,
): Response | null {
  if (!validateOrigin(request, env.ALLOWED_ORIGINS)) {
    return new Response(JSON.stringify({ error: 'Forbidden: origin not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}

// ============================================================================
// CSRF check for mutating requests (exempt on login)
// ============================================================================

export function checkCsrfForMutation(request: Request): Response | null {
  const method = request.method.toUpperCase();
  if (method !== 'POST' && method !== 'PUT' && method !== 'DELETE') return null;
  if (!verifyCsrf(request)) {
    return new Response(JSON.stringify({ error: 'Invalid CSRF token' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}

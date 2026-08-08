// Typed fetch wrapper for the /api/* backend.

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/**
 * Determines if we're in production (HTTPS) or development (HTTP) mode
 * by checking the current request's protocol.
 * Note: This function uses window.location which is available in browsers.
 */
function isProductionEnvironment(): boolean {
  return window.location.protocol === 'https:';
}

/**
 * Reads the appropriate CSRF token from cookies.
 * In production (HTTPS), it looks for __Host-csrf.
 * In development (HTTP), it looks for dev-csrf.
 */
function readCsrfToken(): string {
  const isProd = isProductionEnvironment();
  const cookieName = isProd ? '__Host-csrf' : 'dev-csrf';
  const match = document.cookie.match(new RegExp(`${cookieName}=([^;]+)`));
  return match?.[1] ?? '';
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);

  // Attach CSRF token on mutating requests
  const method = (options.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    headers.set('X-CSRF-Token', readCsrfToken());
  }

  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: 'same-origin',
  });

  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent('api:signed-out'));
    throw new ApiError('Not authenticated', 401);
  }

  return response;
}

export async function apiGetJson<T>(path: string): Promise<T> {
  const response = await apiFetch(path);
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new ApiError(body?.error ?? `Request failed: ${response.status}`, response.status);
  }
  return response.json() as Promise<T>;
}

export async function apiPostJson<T>(path: string, data: unknown): Promise<T> {
  const response = await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new ApiError(body?.error ?? `Request failed: ${response.status}`, response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function apiPutJson<T>(path: string, data: unknown): Promise<T> {
  const response = await apiFetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new ApiError(body?.error ?? `Request failed: ${response.status}`, response.status);
  }
  return response.json() as Promise<T>;
}

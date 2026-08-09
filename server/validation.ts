// Request parsing, validation, and JSON response helpers.
// Reuses pure validators from src/domain.ts.

import type { ApiErrorResponse } from '../shared/contracts';

// ============================================================================
// JSON helpers
// ============================================================================

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export function errorResponse(error: string, status = 400, field?: string): Response {
  const body: ApiErrorResponse = field ? { error, field } : { error };
  return jsonResponse(body, status);
}

export const OK = jsonResponse.bind(null, undefined, 204);

// ============================================================================
// Request body parsing
// ============================================================================

export async function parseJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get('Content-Type');
  if (!contentType?.includes('application/json')) {
    return null;
  }
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function requireJsonBody<T>(request: Request): Promise<T | Response> {
  const body = await parseJsonBody(request);
  if (body === null) {
    return errorResponse('Request must be JSON with Content-Type: application/json');
  }
  return body as T;
}

// ============================================================================
// Query parameter helpers
// ============================================================================

export function getQueryParam(url: URL, name: string, fallback: string = ''): string {
  return url.searchParams.get(name) ?? fallback;
}

export function getQueryInt(url: URL, name: string, fallback: number): number {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  if (!/^(0|[1-9]\d*)$/.test(raw)) return fallback;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : fallback;
}

// ============================================================================
// ID extraction from URL path
// ============================================================================

export function extractIdFromPath(pathname: string, prefix: string): number | null {
  // e.g., "/api/products/42/deactivate" with prefix "/api/products" → "42"
  const rest = pathname.slice(prefix.length + 1); // +1 for trailing /
  const segment = rest.split('/')[0];
  if (!segment) return null;
  if (!/^[1-9]\d*$/.test(segment)) return null;
  const id = Number(segment);
  return Number.isSafeInteger(id) ? id : null;
}

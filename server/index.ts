// Worker entry point. Routes /api/* to handlers, everything else to ASSETS.

import {
  jsonResponse,
  errorResponse,
  requireJsonBody,
} from './validation';
import {
  requireAuth,
  checkOriginForMutation,
  checkCsrfForMutation,
  verifyPassword,
  createSessionCookie,
  createCsrfCookie,
  clearSessionCookies,
  checkRateLimit,
} from './auth';
import {
  handleListProducts,
  handleCreateProduct,
  handleUpdateProduct,
  handleGetProduct,
  handleDeactivateProduct,
  handleProductHistory,
  handleListLocations,
} from './products';
import { handleStockDelivery, handleStockCount, handleStockAdjustment } from './stock';
import { handleImportPreview, handleImportCommit } from './import';
import { handleCancelSale, handleCreateSale, handleGetSale, handleListSales, handleRecordPayment } from './sales';
import { handleListLids } from './lids';

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Only handle /api/* routes
    if (!url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    // Strip /api prefix for routing
    const path = url.pathname.slice(4); // "/api/products" → "/products"

    try {
      return await routeApi(path, url, request, env);
    } catch (err) {
      console.error('Unhandled API error', err instanceof Error
        ? { name: err.name, message: err.message, stack: err.stack }
        : { valueType: typeof err });
      return errorResponse('Internal server error', 500);
    }
  },
} satisfies ExportedHandler<Env>;

// ============================================================================
// API router
// ============================================================================

async function routeApi(
  path: string,
  url: URL,
  request: Request,
  env: Env,
): Promise<Response> {
  const method = request.method.toUpperCase();

  // --- Auth endpoints (no session required) ---

  if (path === '/login' && method === 'POST') {
    return handleLogin(request, env);
  }

  if (path === '/me' && method === 'GET') {
    const authFail = await requireAuth(request, env);
    if (authFail) return authFail;
    return jsonResponse({ authenticated: true });
  }

  // --- All remaining routes require auth ---

  const authFail = await requireAuth(request, env);
  if (authFail) return authFail;

  // Origin check for all mutating requests
  const originFail = checkOriginForMutation(request, env);
  if (originFail) return originFail;

  // CSRF check for all mutating requests (exempt on login, which is above)
  const csrfFail = checkCsrfForMutation(request);
  if (csrfFail) return csrfFail;

  // --- Mutating + authenticated endpoints ---

  if (path === '/logout' && method === 'POST') {
    return handleLogout(request);
  }

  // Products
  if (path === '/products' && method === 'GET') {
    return handleListProducts(url, env);
  }
  if (path === '/products' && method === 'POST') {
    return handleCreateProduct(request, env);
  }
  if (path === '/locations' && method === 'GET') {
    return handleListLocations(env);
  }
  if (path === '/lids' && method === 'GET') {
    return handleListLids(url, env);
  }
  // /products/:id, /products/:id/history, /products/:id/deactivate, /products/:id/activate
  const productMatch = path.match(/^\/products\/(\d+)(\/(deactivate|activate|history))?$/);
  const productId = productMatch ? Number(productMatch[1]) : null;
  if (productMatch && (!Number.isSafeInteger(productId) || productId! <= 0)) {
    return errorResponse('Invalid product ID', 400);
  }
  if (productMatch && !productMatch[2] && method === 'PUT') {
    return handleUpdateProduct(productId!, request, env);
  }
  if (productMatch && productMatch[3] === 'deactivate' && method === 'POST') {
    return handleDeactivateProduct(productId!, false, env);
  }
  if (productMatch && productMatch[3] === 'activate' && method === 'POST') {
    return handleDeactivateProduct(productId!, true, env);
  }
  if (productMatch && productMatch[3] === 'history' && method === 'GET') {
    return handleProductHistory(productId!, url, env);
  }
  if (productMatch && !productMatch[2] && method === 'GET') {
    return handleGetProduct(productId!, env);
  }

  // Import
  if (path === '/import/products/preview' && method === 'POST') {
    return handleImportPreview(request, env);
  }
  if (path === '/import/products/commit' && method === 'POST') {
    return handleImportCommit(request, env);
  }

  // Stock
  if (path === '/stock/delivery' && method === 'POST') {
    return handleStockDelivery(request, env);
  }
  if (path === '/stock/count' && method === 'POST') {
    return handleStockCount(request, env);
  }
  if (path === '/stock/adjustment' && method === 'POST') {
    return handleStockAdjustment(request, env);
  }

  // Sales
  if (path === '/sales' && method === 'POST') {
    return handleCreateSale(request, env);
  }
  if (path === '/sales' && method === 'GET') {
    return handleListSales(url, env);
  }
  const saleMatch = path.match(/^\/sales\/(\d+)(\/(cancel|payments))?$/);
  const saleId = saleMatch ? Number(saleMatch[1]) : null;
  if (saleMatch && (!Number.isSafeInteger(saleId) || saleId! <= 0)) {
    return errorResponse('Invalid sale ID', 400);
  }
  if (saleMatch && !saleMatch[2] && method === 'GET') {
    return handleGetSale(saleId!, env);
  }
  if (saleMatch && saleMatch[2] === '/cancel' && method === 'POST') {
    return handleCancelSale(saleId!, request, env);
  }
  if (saleMatch && saleMatch[2] === '/payments' && method === 'POST') {
    return handleRecordPayment(saleId!, request, env);
  }

  // Dashboard
  if (path === '/dashboard' && method === 'GET') {
    return handleDashboard(url, env);
  }

  // Export
  if (path === '/export/products.csv' && method === 'GET') {
    return handleExportCsv('products', env);
  }
  if (path === '/export/sales.csv' && method === 'GET') {
    return handleExportCsv('sales', env);
  }
  if (path === '/export/sale-items.csv' && method === 'GET') {
    return handleExportCsv('sale_items', env);
  }
  if (path === '/export/stock-movements.csv' && method === 'GET') {
    return handleExportCsv('stock_movements', env);
  }
  if (path === '/export/all' && method === 'GET') {
    return handleExportAll(env);
  }

  // Unknown /api/* route — JSON 404
  return errorResponse('Not found', 404);
}

// ============================================================================
// Handlers — stub implementations (full logic added in M2–M5)
// ============================================================================

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const body = await requireJsonBody<{ password?: string }>(request);
  if (body instanceof Response) return body;

  if (!body?.password) {
    return errorResponse('Password is required');
  }

  // Origin check for login
  const originFail = checkOriginForMutation(request, env);
  if (originFail) return originFail;

  // Rate limit
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const allowed = await checkRateLimit(env, ip);
  if (!allowed) {
    return errorResponse('Too many attempts. Try again later.', 429);
  }

  const valid = await verifyPassword(body.password, env.PASSWORD_HASH);
  if (!valid) {
    return errorResponse('Invalid password', 401);
  }

  const maxAge = parseInt(env.SESSION_MAX_AGE_SECONDS, 10) || 2592000;
  const sessionCookie = await createSessionCookie(env.SESSION_SECRET, maxAge, request);
  const csrfCookie = createCsrfCookie(request);

  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.append('Set-Cookie', sessionCookie);
  headers.append('Set-Cookie', csrfCookie);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers,
  });
}

function handleLogout(request: Request): Response {
  const cookies = clearSessionCookies(request);
  const headers = new Headers();
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, {
    status: 204,
    headers,
  });
}

// --- Stubs for M2–M5 endpoints ---

async function handleDashboard(url: URL, env: Env): Promise<Response> {
  const requestedDate = url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    return errorResponse('Dashboard date must use YYYY-MM-DD', 400, 'date');
  }
  const today = await env.DB.prepare(
    `SELECT COUNT(*) AS count, COALESCE(SUM(total_minor), 0) AS total_minor
     FROM sales WHERE sale_date = ? AND status = 'completed'`,
  ).bind(requestedDate).first<{ count: number; total_minor: number }>();

  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS count, COALESCE(SUM(total_minor), 0) AS total_minor
     FROM sales WHERE status = 'completed'`,
  ).first<{ count: number; total_minor: number }>();

  return jsonResponse({
    today: { count: today?.count ?? 0, totalPaise: today?.total_minor ?? 0 },
    total: { count: total?.count ?? 0, totalPaise: total?.total_minor ?? 0 },
    lowStock: [],
    outOfStock: [],
    needsAttention: [],
    version: 1,
    lastUpdated: new Date().toISOString(),
  });
}

async function handleExportCsv(_type: string, _env: Env): Promise<Response> {
  return errorResponse('Not implemented yet', 501);
}

async function handleExportAll(_env: Env): Promise<Response> {
  return errorResponse('Not implemented yet', 501);
}

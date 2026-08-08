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
      return await handleApi(path, url, request, env);
    } catch (err) {
      console.error('Unhandled API error:', err);
      return errorResponse('Internal server error', 500);
    }
  },
} satisfies ExportedHandler<Env>;

// ============================================================================
// API router
// ============================================================================

async function handleApi(
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
  // /products/:id, /products/:id/history, /products/:id/deactivate, /products/:id/activate
  const productMatch = path.match(/^\/products\/(\d+)(\/(deactivate|activate|history))?$/);
  if (productMatch && method === 'PUT') {
    return handleUpdateProduct(Number(productMatch[1]), request, env);
  }
  if (productMatch && productMatch[3] === 'deactivate' && method === 'POST') {
    return handleDeactivateProduct(Number(productMatch[1]), false, env);
  }
  if (productMatch && productMatch[3] === 'activate' && method === 'POST') {
    return handleDeactivateProduct(Number(productMatch[1]), true, env);
  }
  if (productMatch && productMatch[3] === 'history' && method === 'GET') {
    return handleProductHistory(Number(productMatch[1]), env);
  }

  // Import
  if (path === '/import/products/preview' && method === 'POST') {
    return handleImportPreview(request, env);
  }
  if (path === '/import/products/commit' && method === 'POST') {
    return handleImportCommit(request, env);
  }

  // Stock
  if (path === '/stock/deliveries' && method === 'POST') {
    return handleStockDelivery(request, env);
  }
  if (path === '/stock/counts' && method === 'POST') {
    return handleStockCount(request, env);
  }
  if (path === '/stock/adjustments' && method === 'POST') {
    return handleStockAdjustment(request, env);
  }

  // Sales
  if (path === '/sales' && method === 'POST') {
    return handleCreateSale(request, env);
  }
  const saleMatch = path.match(/^\/sales\/(\d+)(\/cancel)?$/);
  if (saleMatch && !saleMatch[2] && method === 'GET') {
    return handleGetSale(Number(saleMatch[1]), env);
  }
  if (saleMatch && saleMatch[2] === '/cancel' && method === 'POST') {
    return handleCancelSale(Number(saleMatch[1]), request, env);
  }

  // Dashboard
  if (path === '/dashboard' && method === 'GET') {
    return handleDashboard(env);
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

async function handleListProducts(_url: URL, _env: Env): Promise<Response> {
  return jsonResponse({ items: [], total: 0 });
}

async function handleCreateProduct(_request: Request, _env: Env): Promise<Response> {
  return errorResponse('Not implemented yet', 501);
}

async function handleUpdateProduct(_id: number, _request: Request, _env: Env): Promise<Response> {
  return errorResponse('Not implemented yet', 501);
}

async function handleDeactivateProduct(_id: number, _activate: boolean, _env: Env): Promise<Response> {
  return errorResponse('Not implemented yet', 501);
}

async function handleProductHistory(_id: number, _env: Env): Promise<Response> {
  return jsonResponse({ movements: [] });
}

async function handleImportPreview(_request: Request, _env: Env): Promise<Response> {
  return errorResponse('Not implemented yet', 501);
}

async function handleImportCommit(_request: Request, _env: Env): Promise<Response> {
  return errorResponse('Not implemented yet', 501);
}

async function handleStockDelivery(_request: Request, _env: Env): Promise<Response> {
  return errorResponse('Not implemented yet', 501);
}

async function handleStockCount(_request: Request, _env: Env): Promise<Response> {
  return errorResponse('Not implemented yet', 501);
}

async function handleStockAdjustment(_request: Request, _env: Env): Promise<Response> {
  return errorResponse('Not implemented yet', 501);
}

async function handleCreateSale(_request: Request, _env: Env): Promise<Response> {
  return errorResponse('Not implemented yet', 501);
}

async function handleGetSale(_id: number, _env: Env): Promise<Response> {
  return errorResponse('Not implemented yet', 501);
}

async function handleCancelSale(_id: number, _request: Request, _env: Env): Promise<Response> {
  return errorResponse('Not implemented yet', 501);
}

async function handleDashboard(_env: Env): Promise<Response> {
  return jsonResponse({
    today: { count: 0, totalPaise: 0 },
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

// Product CRUD operations with D1
// Atomic database operations with optimistic concurrency

import {
  jsonResponse,
  errorResponse,
  getQueryParam,
  requireJsonBody,
} from './validation';
import type { ProductDTO, CreateProductRequest, UpdateProductRequest } from '../shared/contracts';

class ProductDomainError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
  }
}

function parseBoundedQueryInteger(
  url: URL,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number | null {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  if (!/^(0|[1-9]\d*)$/.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) return null;
  return value;
}

function isSkuConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return message.includes('UNIQUE constraint failed: products.sku') ||
    message.includes('idx_products_sku');
}

function productErrorResponse(error: unknown): Response {
  if (error instanceof ProductDomainError) {
    return errorResponse(error.message, error.status);
  }
  if (isSkuConstraintError(error)) {
    return errorResponse('A product with this SKU already exists', 409);
  }
  return errorResponse('Internal server error', 500);
}

// ============================================================================
// Product DTO builder
// ============================================================================

function buildProductDTO(
  row: Record<string, unknown>
): ProductDTO {
  return {
    id: row.id as number,
    sku: row.sku as string | null,
    name: row.name as string,
    category: row.category as string | null,
    pricePaise: row.selling_price_minor as number,
    quantity: row.stock_quantity as number,
    lowStockLevel: row.low_stock_level as number,
    active: (row.active as number) === 1,
    version: row.version as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

// ============================================================================
// List products with search and filter
// ============================================================================

async function listProducts(
  env: Env,
  query: string,
  activeFilter: 'active' | 'inactive' | 'all',
  limit: number,
  offset: number
): Promise<{ items: ProductDTO[]; total: number }> {
  const whereClauses: string[] = [];
  const params: (string | number)[] = [];

  // Active filter
  if (activeFilter === 'active') {
    whereClauses.push('active = 1');
  } else if (activeFilter === 'inactive') {
    whereClauses.push('active = 0');
  }

  // Search filter (name or SKU)
  if (query && query.trim()) {
    whereClauses.push('(name LIKE ? OR sku LIKE ?)');
    const searchTerm = `%${query.trim().toLowerCase()}%`;
    params.push(searchTerm, searchTerm);
  }

  const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // Get total count
  const countSql = `SELECT COUNT(*) as total FROM products ${whereClause}`;
  const countResult = await env.DB.prepare(countSql).bind(...params).first<{ total: number }>();
  const total = countResult?.total ?? 0;

  // Get paginated results
  const dataSql = `SELECT * FROM products ${whereClause} ORDER BY name ASC LIMIT ? OFFSET ?`;
  const dataParams = [...params, limit, offset];
  const result = await env.DB.prepare(dataSql).bind(...dataParams).all();

  const items: ProductDTO[] = [];
  for (const row of result.results || []) {
    items.push(buildProductDTO(row));
  }

  return { items, total };
}

// ============================================================================
// Create product
// ============================================================================

async function createProduct(
  env: Env,
  request: CreateProductRequest
): Promise<ProductDTO> {
  const now = new Date().toISOString();

  // Validate name
  if (!request.name || request.name.trim().length === 0) {
    throw new ProductDomainError('Name is required', 400);
  }

  const name = request.name.trim();
  const sku = request.sku?.trim() || null;

  // Validate price
  if (request.pricePaise < 0 || !Number.isSafeInteger(request.pricePaise)) {
    throw new ProductDomainError('Price must be a non-negative integer in paise', 400);
  }

  // Validate quantities
  if (request.quantity < 0 || !Number.isSafeInteger(request.quantity)) {
    throw new ProductDomainError('Quantity must be a non-negative integer', 400);
  }

  if (request.lowStockLevel < 0 || !Number.isSafeInteger(request.lowStockLevel)) {
    throw new ProductDomainError('Low stock level must be a non-negative integer', 400);
  }

  // Check for duplicate SKU (case-insensitive, preserve original casing)
  if (sku) {
    const existing = await env.DB.prepare(
      'SELECT id FROM products WHERE LOWER(sku) = LOWER(?) LIMIT 1'
    )
      .bind(sku)
      .first();

    if (existing) {
      throw new ProductDomainError('A product with this SKU already exists', 409);
    }
  }

  // Insert product
  const result = await env.DB.prepare(
    `INSERT INTO products (sku, name, category, selling_price_minor, stock_quantity, low_stock_level, active, created_at, updated_at, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  )
    .bind(
      sku,
      name,
      request.category?.trim() || null,
      request.pricePaise,
      request.quantity,
      request.lowStockLevel,
      request.active ? 1 : 0,
      now,
      now
    )
    .run();

  if (!result.success) {
    throw new Error('Failed to create product');
  }

  // Get inserted product
  const inserted = await env.DB.prepare(
    'SELECT * FROM products WHERE id = ? ORDER BY id DESC LIMIT 1'
  )
    .bind(result.meta?.last_row_id || 0)
    .first();

  if (!inserted) {
    throw new Error('Failed to retrieve inserted product');
  }

  return buildProductDTO(inserted);
}

// ============================================================================
// Update product
// ============================================================================

async function updateProduct(
  env: Env,
  id: number,
  request: UpdateProductRequest,
  expectedVersion: number
): Promise<ProductDTO> {
  const now = new Date().toISOString();

  // Get current product to verify version
  const current = await env.DB.prepare(
    'SELECT version, name, sku, active, stock_quantity FROM products WHERE id = ?'
  )
    .bind(id)
    .first();

  if (!current) {
    throw new ProductDomainError('Product not found', 404);
  }

  // Check version for optimistic concurrency
  if (current.version !== expectedVersion) {
    throw new ProductDomainError('Version conflict', 409);
  }

  // Validate name
  if (!request.name || request.name.trim().length === 0) {
    throw new ProductDomainError('Name is required', 400);
  }

  const name = request.name.trim();
  const sku = request.sku?.trim() || null;

  // Validate price
  if (request.pricePaise < 0 || !Number.isSafeInteger(request.pricePaise)) {
    throw new ProductDomainError('Price must be a non-negative integer in paise', 400);
  }

  // Validate quantities
  if (request.quantity < 0 || !Number.isSafeInteger(request.quantity)) {
    throw new ProductDomainError('Quantity must be a non-negative integer', 400);
  }

  if (request.lowStockLevel < 0 || !Number.isSafeInteger(request.lowStockLevel)) {
    throw new ProductDomainError('Low stock level must be a non-negative integer', 400);
  }

  if (request.quantity !== current.stock_quantity) {
    throw new ProductDomainError('Stock quantity must be changed through a stock workflow', 409);
  }

  // Check for duplicate SKU (case-insensitive, excluding current product)
  if (sku) {
    const existing = await env.DB.prepare(
      'SELECT id FROM products WHERE LOWER(sku) = LOWER(?) AND id != ? LIMIT 1'
    )
      .bind(sku, id)
      .first();

    if (existing) {
      throw new ProductDomainError('A product with this SKU already exists', 409);
    }
  }

  // Update product
  const result = await env.DB.prepare(
    `UPDATE products
     SET sku = ?, name = ?, category = ?, selling_price_minor = ?, low_stock_level = ?, active = ?, version = version + 1, updated_at = ?
     WHERE id = ? AND version = ?`
  )
    .bind(
      sku,
      name,
      request.category?.trim() || null,
      request.pricePaise,
      request.lowStockLevel,
      request.active ? 1 : 0,
      now,
      id,
      expectedVersion
    )
    .run();

  if (!result.success) {
    throw new Error('Failed to update product');
  }
  if ((result.meta.changes ?? 0) !== 1) {
    throw new ProductDomainError('Version conflict', 409);
  }

  // Get updated product
  const updated = await env.DB.prepare(
    'SELECT * FROM products WHERE id = ?'
  )
    .bind(id)
    .first();

  if (!updated) {
    throw new Error('Failed to retrieve updated product');
  }

  return buildProductDTO(updated);
}

// ============================================================================
// Activate/deactivate product
// ============================================================================

async function toggleProductActive(
  env: Env,
  id: number,
  activate: boolean
): Promise<ProductDTO> {
  const now = new Date().toISOString();

  // Get current product to verify existence
  const current = await env.DB.prepare(
    'SELECT * FROM products WHERE id = ?'
  )
    .bind(id)
    .first();

  if (!current) {
    throw new ProductDomainError('Product not found', 404);
  }

  // If already in desired state, return current product
  if (current.active === (activate ? 1 : 0)) {
    return buildProductDTO(current);
  }

  // Update active status
  const result = await env.DB.prepare(
    `UPDATE products
     SET active = ?, version = version + 1, updated_at = ?
     WHERE id = ?`
  )
    .bind(activate ? 1 : 0, now, id)
    .run();

  if (!result.success) {
    throw new Error('Failed to update product');
  }

  // Get updated product
  const updated = await env.DB.prepare(
    'SELECT * FROM products WHERE id = ?'
  )
    .bind(id)
    .first();

  if (!updated) {
    throw new Error('Failed to retrieve updated product');
  }

  return buildProductDTO(updated);
}

// ============================================================================
// Request handlers
// ============================================================================

export async function handleListProducts(url: URL, env: Env): Promise<Response> {
  try {
    const query = getQueryParam(url, 'q', '');
    if (query.length > 200) {
      return errorResponse('Search query must be 200 characters or fewer', 400);
    }
    const active = getQueryParam(url, 'active', 'active');
    if (!['active', 'inactive', 'all'].includes(active)) {
      return errorResponse('Active filter must be active, inactive, or all', 400);
    }
    const activeFilter = active as 'active' | 'inactive' | 'all';
    const limit = parseBoundedQueryInteger(url, 'limit', 100, 1, 1000);
    const offset = parseBoundedQueryInteger(url, 'offset', 0, 0, Number.MAX_SAFE_INTEGER);
    if (limit === null || offset === null) {
      return errorResponse('Invalid pagination parameters', 400);
    }

    const { items, total } = await listProducts(env, query, activeFilter, limit, offset);

    return jsonResponse({ items, total });
  } catch {
    return errorResponse('Internal server error', 500);
  }
}

export async function handleCreateProduct(request: Request, env: Env): Promise<Response> {
  try {
    const body = await requireJsonBody<CreateProductRequest>(request);
    if (body instanceof Response) return body;

    const product = await createProduct(env, body);

    return jsonResponse(product, 201);
  } catch (error) {
    return productErrorResponse(error);
  }
}

export async function handleUpdateProduct(
  id: number,
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const body = await requireJsonBody<UpdateProductRequest>(request);
    if (body instanceof Response) return body;

    const requestUrl = new URL(request.url);
    if (!requestUrl.searchParams.has('version')) {
      return errorResponse('Version parameter is required', 400);
    }
    const version = parseBoundedQueryInteger(requestUrl, 'version', 1, 1, Number.MAX_SAFE_INTEGER);
    if (version === null) {
      return errorResponse('Invalid version parameter', 400);
    }

    const product = await updateProduct(env, id, body, version);

    return jsonResponse(product, 200);
  } catch (error) {
    return productErrorResponse(error);
  }
}

export async function handleGetProduct(
  id: number,
  env: Env
): Promise<Response> {
  try {
    const product = await env.DB.prepare(
      'SELECT * FROM products WHERE id = ?'
    ).bind(id).first();

    if (!product) {
      return errorResponse('Product not found', 404);
    }

    return jsonResponse(buildProductDTO(product), 200);
  } catch {
    return errorResponse('Internal server error', 500);
  }
}

export async function handleDeactivateProduct(
  id: number,
  activate: boolean,
  env: Env
): Promise<Response> {
  try {
    const product = await toggleProductActive(env, id, activate);

    return jsonResponse(product, 200);
  } catch (error) {
    return productErrorResponse(error);
  }
}

export async function handleProductHistory(
  id: number,
  url: URL,
  env: Env
): Promise<Response> {
  const limit = parseBoundedQueryInteger(url, 'limit', 50, 1, 100);
  const offset = parseBoundedQueryInteger(url, 'offset', 0, 0, Number.MAX_SAFE_INTEGER);
  if (limit === null || offset === null) {
    return errorResponse('Invalid pagination parameters', 400);
  }

  const product = await env.DB.prepare(
    'SELECT id FROM products WHERE id = ?',
  ).bind(id).first();

  if (!product) {
    return errorResponse('Product not found', 404);
  }

  const batchResults = await env.DB.batch([
    env.DB.prepare(
    `SELECT id, product_id, quantity_delta, reason, sale_id, stock_entry_id, note, created_at
     FROM stock_movements
     WHERE product_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ? OFFSET ?`,
    ).bind(id, limit, offset),
    env.DB.prepare(
      'SELECT COUNT(*) AS total FROM stock_movements WHERE product_id = ?',
    ).bind(id),
  ]);
  const movementRows = batchResults[0]?.results ?? [];
  const totalRecord = batchResults[1]?.results?.[0] as Record<string, unknown> | undefined;
  const total = (totalRecord?.total as number | undefined) ?? 0;

  return jsonResponse({
    movements: movementRows.map((row) => {
      const record = row as Record<string, unknown>;
      return {
        id: record.id as number,
        productId: record.product_id as number,
        quantityDelta: record.quantity_delta as number,
        reason: record.reason as string,
        saleId: record.sale_id as number | null,
        stockEntryId: record.stock_entry_id as number | null,
        note: record.note as string | null,
        createdAt: record.created_at as string,
      };
    }),
    total,
    limit,
    offset,
  });
}

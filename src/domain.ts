// Domain types and pure functions for the inventory prototype.
// All monetary values are in integer paise. All quantities are integers >= 0.

export type ProductId = number;

export interface Product {
  readonly id: ProductId;
  readonly sku: string | null;
  readonly name: string;
  readonly category: string | null;
  readonly colour?: string | null;
  readonly size?: string | null;
  readonly pricePaise: number;
  readonly mrpPaise?: number | null;
  readonly consultantPricePaise?: number | null;
  readonly quantity: number;
  readonly setStockQuantity?: number;
  readonly lowStockLevel: number;
  readonly locationId?: number | null;
  readonly locationName?: string | null;
  readonly personalUse?: boolean;
  readonly active: boolean;
  readonly version: number;
}

export type PaymentMethod = 'upi' | 'cash' | 'card' | 'bank-transfer' | 'other';

export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  'upi',
  'cash',
  'card',
  'bank-transfer',
  'other',
] as const;

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  upi: 'UPI',
  cash: 'Cash',
  card: 'Card',
  'bank-transfer': 'Bank transfer',
  other: 'Other',
};

export interface SaleLine {
  readonly productId: ProductId;
  readonly quantity: number;
  readonly unitPricePaise?: number;
  readonly setStockAfter?: number;
}

export interface SaleDraft {
  readonly lines: readonly SaleLine[];
  readonly discountPaise: number;
  readonly paymentMethod: PaymentMethod;
}

export interface SaleLineRecord {
  readonly productId: ProductId;
  readonly productName: string;
  readonly quantity: number;
  readonly unitPricePaise: number;
  readonly lineTotalPaise: number;
  readonly setStockBefore?: number;
  readonly setStockAfter?: number;
}

export interface SaleRecord {
  readonly id: number;
  readonly saleNumber: string;
  readonly soldAt: string;
  readonly saleDate?: string;
  readonly customerName?: string | null;
  readonly lines: readonly SaleLineRecord[];
  readonly subtotalPaise: number;
  readonly discountPaise: number;
  readonly totalPaise: number;
  readonly paymentMethod: PaymentMethod;
  readonly paidPaise?: number;
  readonly balancePaise?: number;
  readonly paymentStatus?: 'unpaid' | 'partial' | 'paid';
  readonly payments?: readonly {
    readonly id: number;
    readonly amountPaise: number;
    readonly paymentMethod: string;
    readonly receivedAt: string;
  }[];
  readonly status: 'completed' | 'cancelled';
  readonly cancelledAt?: string;
  readonly cancellationReason?: string;
}

export type AdjustmentReason =
  | 'damaged'
  | 'lost'
  | 'sample'
  | 'personal-use'
  | 'incorrect-entry'
  | 'other';

export const ADJUSTMENT_REASONS: readonly AdjustmentReason[] = [
  'damaged',
  'lost',
  'sample',
  'personal-use',
  'incorrect-entry',
  'other',
] as const;

export const ADJUSTMENT_REASON_LABELS: Record<AdjustmentReason, string> = {
  damaged: 'Damaged',
  lost: 'Lost',
  sample: 'Used as sample',
  'personal-use': 'Personal use',
  'incorrect-entry': 'Incorrect entry',
  other: 'Other',
};

// Subtractive reasons ask "how many affected?" and decrease stock.
// Corrective reasons ask "what should the quantity be?" and set absolute value.
export const SUBTRACTIVE_REASONS: readonly AdjustmentReason[] = [
  'damaged',
  'lost',
  'sample',
  'personal-use',
] as const;

export const CORRECTIVE_REASONS: readonly AdjustmentReason[] = [
  'incorrect-entry',
  'other',
] as const;

export interface StockAdjustment {
  readonly id: number;
  readonly productId: ProductId;
  readonly productName: string;
  readonly reason: AdjustmentReason;
  readonly quantityBefore: number;
  readonly quantityAfter: number;
  readonly note: string | null;
  readonly createdAt: string;
}

export interface RestockLine {
  readonly productId: ProductId;
  readonly quantityReceived: number;
}

export interface InventoryState {
  readonly products: ReadonlyMap<ProductId, Product>;
  readonly sales: readonly SaleRecord[];
  readonly adjustments: readonly StockAdjustment[];
  readonly saleDraft: SaleDraft;
  readonly restockDraft: readonly RestockLine[];
  readonly nextSaleId: number;
  readonly nextAdjustmentId: number;
  readonly idempotencyKeys: ReadonlySet<string>;
}

// Result type for operations that can fail
export type Result<T, E = string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const Err = <E>(error: E): Result<never, E> => ({ ok: false, error });

// Empty draft for initialization
export const EMPTY_SALE_DRAFT: SaleDraft = {
  lines: [],
  discountPaise: 0,
  paymentMethod: 'upi',
} as const;

// ============================================================================
// Timezone utilities
// ============================================================================

/**
 * Get today's date in Asia/Kolkata timezone as ISO date string (YYYY-MM-DD).
 */
export function getTodayKolkata(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Get timestamp in Asia/Kolkata timezone as ISO string.
 */
export function getTimestampKolkata(): string {
  const now = new Date();
  const kolkataTime = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(now);

  // Parse and convert to ISO-like format
  const parts = kolkataTime.match(/(\d{2})\/(\d{2})\/(\d{4}), (\d{2}):(\d{2}):(\d{2})/);
  if (!parts) return now.toISOString();

  const [, month, day, year, hour, minute, second] = parts;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}+05:30`;
}

// ============================================================================
// Formatting
// ============================================================================

/**
 * Format paise as INR with Indian number grouping.
 * ₹499 for whole rupees, ₹499.50 for amounts with paise.
 */
export function formatInr(paise: number): string {
  const rupees = paise / 100;
  // Use 2 decimal places if there are paise, 0 if whole rupees
  const hasPaise = paise % 100 !== 0;

  const formatter = new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  });

  return formatter.format(rupees);
}

/**
 * Format a number with Indian grouping (for quantities, not money).
 */
export function formatQuantity(n: number): string {
  return new Intl.NumberFormat('en-IN').format(n);
}

// ============================================================================
// Validation helpers
// ============================================================================

export function validateNonNegative(n: number, fieldName: string): Result<void> {
  if (!Number.isFinite(n) || n < 0) {
    return Err(`${fieldName} cannot be negative`);
  }
  return Ok(undefined);
}

export function validatePositive(n: number, fieldName: string): Result<void> {
  if (!Number.isFinite(n) || n <= 0) {
    return Err(`${fieldName} must be greater than zero`);
  }
  return Ok(undefined);
}

export function validateWholeNumber(n: number, fieldName: string): Result<void> {
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return Err(`${fieldName} must be a whole number`);
  }
  return Ok(undefined);
}

/**
 * Validate a quantity is a non-negative whole number.
 */
export function validateQuantity(n: number, fieldName: string): Result<void> {
  if (!Number.isFinite(n)) {
    return Err(`${fieldName} must be a valid number`);
  }
  if (!Number.isInteger(n)) {
    return Err(`${fieldName} must be a whole number`);
  }
  if (n < 0) {
    return Err(`${fieldName} cannot be negative`);
  }
  return Ok(undefined);
}

// ============================================================================
// Sale calculations and validation
// ============================================================================

/**
 * Calculate the subtotal for a sale draft.
 * Returns error if any product is missing, inactive, has insufficient stock, or invalid quantity.
 */
export function calculateSaleSubtotal(
  draft: SaleDraft,
  products: ReadonlyMap<ProductId, Product>
): Result<number> {
  let subtotal = 0;

  for (const line of draft.lines) {
    // Validate quantity is a valid whole number
    const qtyValidation = validateQuantity(line.quantity, 'Quantity');
    if (!qtyValidation.ok) {
      return Err(qtyValidation.error);
    }

    const product = products.get(line.productId);
    if (!product) {
      return Err(`Product not found`);
    }
    if (!product.active) {
      return Err(`${product.name} is not available`);
    }
    if (line.quantity > product.quantity) {
      return Err(`Only ${product.quantity} ${product.name} available, but ${line.quantity} requested`);
    }
    const lineTotal = (line.unitPricePaise ?? product.pricePaise) * line.quantity;
    subtotal += lineTotal;
  }

  return Ok(subtotal);
}

/**
 * Validate that discount is non-negative and does not exceed subtotal.
 */
export function validateSaleDiscount(
  discountPaise: number,
  subtotalPaise: number
): Result<void> {
  if (discountPaise < 0) {
    return Err('Discount cannot be negative');
  }
  if (discountPaise > subtotalPaise) {
    return Err(`Discount cannot be more than subtotal (${formatInr(subtotalPaise)})`);
  }
  return Ok(undefined);
}

/**
 * Get the current quantity in the sale draft for a product.
 */
export function getSaleLineQuantity(draft: SaleDraft, productId: ProductId): number {
  const line = draft.lines.find((l) => l.productId === productId);
  return line?.quantity ?? 0;
}

/**
 * Add or update a product quantity in the sale draft.
 * Returns a new draft, never mutates.
 */
export function setSaleLineQuantity(
  draft: SaleDraft,
  productId: ProductId,
  quantity: number
): SaleDraft {
  if (quantity <= 0) {
    return {
      ...draft,
      lines: draft.lines.filter((l) => l.productId !== productId),
    };
  }

  const existingIndex = draft.lines.findIndex((l) => l.productId === productId);
  if (existingIndex === -1) {
    return {
      ...draft,
      lines: [...draft.lines, { productId, quantity }],
    };
  }

  const newLines = draft.lines.map((line, index) =>
    index === existingIndex ? { ...line, quantity } : line
  );
  return { ...draft, lines: newLines };
}

export function setSaleLineUnitPrice(draft: SaleDraft, productId: ProductId, unitPricePaise: number): SaleDraft {
  return { ...draft, lines: draft.lines.map((line) => line.productId === productId ? { ...line, unitPricePaise } : line) };
}

export function setSaleLineSetStock(draft: SaleDraft, productId: ProductId, setStockAfter: number): SaleDraft {
  return { ...draft, lines: draft.lines.map((line) => line.productId === productId ? { ...line, setStockAfter } : line) };
}

/**
 * Set the discount amount in the sale draft.
 */
export function setSaleDiscount(draft: SaleDraft, discountPaise: number): SaleDraft {
  return { ...draft, discountPaise };
}

/**
 * Set the payment method in the sale draft.
 */
export function setSalePaymentMethod(draft: SaleDraft, method: PaymentMethod): SaleDraft {
  return { ...draft, paymentMethod: method };
}

/**
 * Clear the sale draft.
 */
export function clearSaleDraft(_draft: SaleDraft): SaleDraft {
  return EMPTY_SALE_DRAFT;
}

// ============================================================================
// Restock draft operations
// ============================================================================

/**
 * Get the current received quantity for a product in the restock draft.
 */
export function getRestockLineQuantity(
  draft: readonly RestockLine[],
  productId: ProductId
): number {
  const line = draft.find((l) => l.productId === productId);
  return line?.quantityReceived ?? 0;
}

/**
 * Add or update a received quantity in the restock draft.
 */
export function setRestockLineQuantity(
  draft: readonly RestockLine[],
  productId: ProductId,
  quantity: number
): readonly RestockLine[] {
  if (quantity <= 0) {
    return draft.filter((l) => l.productId !== productId);
  }

  const existingIndex = draft.findIndex((l) => l.productId === productId);
  if (existingIndex === -1) {
    return [...draft, { productId, quantityReceived: quantity }];
  }

  return draft.map((line, index) =>
    index === existingIndex ? { ...line, quantityReceived: quantity } : line
  );
}

/**
 * Clear the restock draft.
 */
export function clearRestockDraft(): readonly RestockLine[] {
  return [];
}

// ============================================================================
// Commands that transform state
// ============================================================================

/**
 * Generate a sale number like "1234".
 */
function generateSaleNumber(id: number): string {
  return String(id).padStart(4, '0');
}

/**
 * Complete a sale from the current draft.
 * Validates all lines, creates a SaleRecord, and reduces product quantities atomically.
 * Uses idempotency key to prevent duplicate sales from double submission.
 */
export function completeSale(
  state: InventoryState,
  idempotencyKey: string
): Result<InventoryState> {
  const { saleDraft, products, sales, nextSaleId, idempotencyKeys } = state;

  // Check idempotency - if key was used before, return the existing result
  if (idempotencyKeys.has(idempotencyKey)) {
    // Find the sale that was created with this key
    const existingSale = sales.find((s) => s.id === nextSaleId - 1);
    if (existingSale) {
      // Return state unchanged - the sale already exists
      return Ok(state);
    }
  }

  // Validate non-empty sale
  if (saleDraft.lines.length === 0) {
    return Err('Add at least one product to the sale');
  }

  // Calculate subtotal and validate stock
  const subtotalResult = calculateSaleSubtotal(saleDraft, products);
  if (!subtotalResult.ok) {
    return Err(subtotalResult.error);
  }
  const subtotalPaise = subtotalResult.value;

  // Validate discount
  const discountResult = validateSaleDiscount(saleDraft.discountPaise, subtotalPaise);
  if (!discountResult.ok) {
    return Err(discountResult.error);
  }

  const totalPaise = subtotalPaise - saleDraft.discountPaise;

  // Build line records and new products map
  const lineRecords: SaleLineRecord[] = [];
  const newProducts = new Map<ProductId, Product>();

  for (const [id, product] of products) {
    newProducts.set(id, product);
  }

  for (const line of saleDraft.lines) {
    const product = newProducts.get(line.productId);
    if (!product) continue; // Already validated above

    const unitPricePaise = line.unitPricePaise ?? product.pricePaise;
    const lineTotal = unitPricePaise * line.quantity;
    lineRecords.push({
      productId: product.id,
      productName: product.name,
      quantity: line.quantity,
      unitPricePaise,
      lineTotalPaise: lineTotal,
      setStockBefore: product.setStockQuantity ?? 0,
      setStockAfter: line.setStockAfter ?? product.setStockQuantity ?? 0,
    });

    // Reduce stock
    newProducts.set(line.productId, {
      ...product,
      quantity: product.quantity - line.quantity,
      setStockQuantity: line.setStockAfter ?? product.setStockQuantity ?? 0,
    });
  }

  const saleRecord: SaleRecord = {
    id: nextSaleId,
    saleNumber: generateSaleNumber(nextSaleId),
    soldAt: getTimestampKolkata(),
    lines: lineRecords,
    subtotalPaise,
    discountPaise: saleDraft.discountPaise,
    totalPaise,
    paymentMethod: saleDraft.paymentMethod,
    status: 'completed',
  };

  // Add idempotency key to the set
  const newIdempotencyKeys = new Set(idempotencyKeys);
  newIdempotencyKeys.add(idempotencyKey);

  return Ok({
    ...state,
    products: newProducts,
    sales: [...sales, saleRecord],
    saleDraft: EMPTY_SALE_DRAFT,
    nextSaleId: nextSaleId + 1,
    idempotencyKeys: newIdempotencyKeys,
  });
}

/**
 * Cancel a completed sale, restoring stock.
 */
export function cancelSale(
  state: InventoryState,
  saleId: number,
  reason: string
): Result<InventoryState> {
  const { products, sales } = state;

  const saleIndex = sales.findIndex((s) => s.id === saleId);
  if (saleIndex === -1) {
    return Err('Sale not found');
  }

  const sale = sales[saleIndex];
  if (!sale) {
    return Err('Sale not found');
  }

  if (sale.status !== 'completed') {
    return Err('This sale has already been cancelled');
  }

  // Restore stock for each line
  const newProducts = new Map<ProductId, Product>();
  for (const [id, product] of products) {
    newProducts.set(id, product);
  }

  for (const line of sale.lines) {
    const product = newProducts.get(line.productId);
    if (product) {
      newProducts.set(line.productId, {
        ...product,
        quantity: product.quantity + line.quantity,
      });
    }
  }

  // Update sale status
  const newSales = sales.map((s, index) =>
    index === saleIndex
      ? {
          ...s,
          status: 'cancelled' as const,
          cancelledAt: getTimestampKolkata(),
          cancellationReason: reason,
        }
      : s
  );

  return Ok({
    ...state,
    products: newProducts,
    sales: newSales,
  });
}

/**
 * Receive stock from a restock draft.
 * Validates all quantities and increases product stock atomically.
 */
export function receiveStock(
  state: InventoryState
): Result<InventoryState> {
  const { restockDraft, products } = state;

  // Validate non-empty
  const activeLines = restockDraft.filter((l) => l.quantityReceived > 0);
  if (activeLines.length === 0) {
    return Err('Add at least one product to receive');
  }

  // Validate all lines have valid quantities and products exist
  for (const line of activeLines) {
    // Validate quantity is a valid whole number
    const qtyValidation = validateQuantity(line.quantityReceived, 'Received quantity');
    if (!qtyValidation.ok) {
      return Err(qtyValidation.error);
    }

    const product = products.get(line.productId);
    if (!product) {
      return Err('Product not found');
    }
    if (!product.active) {
      return Err(`${product.name} is not available`);
    }
  }

  // Apply all stock increases
  const newProducts = new Map<ProductId, Product>();
  for (const [id, product] of products) {
    newProducts.set(id, product);
  }

  for (const line of activeLines) {
    const product = newProducts.get(line.productId);
    if (product) {
      newProducts.set(line.productId, {
        ...product,
        quantity: product.quantity + line.quantityReceived,
      });
    }
  }

  return Ok({
    ...state,
    products: newProducts,
    restockDraft: [],
  });
}

/**
 * Count stock for a product (set absolute quantity).
 * Records an adjustment if the quantity changed.
 */
export function countStock(
  state: InventoryState,
  productId: ProductId,
  countedQuantity: number,
  note?: string
): Result<InventoryState> {
  const { products, adjustments, nextAdjustmentId } = state;

  // Validate quantity is a valid whole number
  const qtyValidation = validateQuantity(countedQuantity, 'Counted quantity');
  if (!qtyValidation.ok) {
    return Err(qtyValidation.error);
  }

  const product = products.get(productId);
  if (!product) {
    return Err('Product not found');
  }

  if (product.quantity === countedQuantity) {
    // No change needed
    return Ok(state);
  }

  // Update product quantity
  const newProducts = new Map<ProductId, Product>();
  for (const [id, p] of products) {
    newProducts.set(id, p);
  }
  newProducts.set(productId, {
    ...product,
    quantity: countedQuantity,
  });

  // Record adjustment
  const adjustment: StockAdjustment = {
    id: nextAdjustmentId,
    productId: product.id,
    productName: product.name,
    reason: 'incorrect-entry',
    quantityBefore: product.quantity,
    quantityAfter: countedQuantity,
    note: note ?? null,
    createdAt: getTimestampKolkata(),
  };

  return Ok({
    ...state,
    products: newProducts,
    adjustments: [...adjustments, adjustment],
    nextAdjustmentId: nextAdjustmentId + 1,
  });
}

/**
 * Adjust stock for subtractive reasons (damaged, lost, sample, personal-use).
 * Decreases stock by the affected quantity.
 */
export function adjustStockSubtractive(
  state: InventoryState,
  productId: ProductId,
  reason: AdjustmentReason,
  affectedQuantity: number,
  note?: string
): Result<InventoryState> {
  const { products, adjustments, nextAdjustmentId } = state;

  // Validate quantity is a valid positive whole number
  const qtyValidation = validateQuantity(affectedQuantity, 'Quantity');
  if (!qtyValidation.ok) {
    return Err(qtyValidation.error);
  }

  if (affectedQuantity <= 0) {
    return Err('Quantity must be greater than zero');
  }

  const product = products.get(productId);
  if (!product) {
    return Err('Product not found');
  }

  if (affectedQuantity > product.quantity) {
    return Err(`Cannot remove ${affectedQuantity}. Only ${product.quantity} in stock.`);
  }

  const newQuantity = product.quantity - affectedQuantity;

  // Update product quantity
  const newProducts = new Map<ProductId, Product>();
  for (const [id, p] of products) {
    newProducts.set(id, p);
  }
  newProducts.set(productId, {
    ...product,
    quantity: newQuantity,
  });

  // Record adjustment
  const adjustment: StockAdjustment = {
    id: nextAdjustmentId,
    productId: product.id,
    productName: product.name,
    reason,
    quantityBefore: product.quantity,
    quantityAfter: newQuantity,
    note: note ?? null,
    createdAt: getTimestampKolkata(),
  };

  return Ok({
    ...state,
    products: newProducts,
    adjustments: [...adjustments, adjustment],
    nextAdjustmentId: nextAdjustmentId + 1,
  });
}

/**
 * Correct stock for corrective reasons (incorrect-entry, other).
 * Sets the absolute quantity.
 */
export function correctStock(
  state: InventoryState,
  productId: ProductId,
  reason: AdjustmentReason,
  newQuantity: number,
  note?: string
): Result<InventoryState> {
  const { products, adjustments, nextAdjustmentId } = state;

  // Validate quantity is a valid whole number
  const qtyValidation = validateQuantity(newQuantity, 'Quantity');
  if (!qtyValidation.ok) {
    return Err(qtyValidation.error);
  }

  const product = products.get(productId);
  if (!product) {
    return Err('Product not found');
  }

  if (product.quantity === newQuantity) {
    // No change needed
    return Ok(state);
  }

  // Update product quantity
  const newProducts = new Map<ProductId, Product>();
  for (const [id, p] of products) {
    newProducts.set(id, p);
  }
  newProducts.set(productId, {
    ...product,
    quantity: newQuantity,
  });

  // Record adjustment
  const adjustment: StockAdjustment = {
    id: nextAdjustmentId,
    productId: product.id,
    productName: product.name,
    reason,
    quantityBefore: product.quantity,
    quantityAfter: newQuantity,
    note: note ?? null,
    createdAt: getTimestampKolkata(),
  };

  return Ok({
    ...state,
    products: newProducts,
    adjustments: [...adjustments, adjustment],
    nextAdjustmentId: nextAdjustmentId + 1,
  });
}

// ============================================================================
// Selectors
// ============================================================================

/**
 * Get products that are at or below their low-stock threshold.
 */
export function getLowStockProducts(state: InventoryState): Product[] {
  const result: Product[] = [];
  for (const product of state.products.values()) {
    if (product.active && product.quantity > 0 && product.quantity <= product.lowStockLevel) {
      result.push(product);
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get products that are out of stock.
 */
export function getOutOfStockProducts(state: InventoryState): Product[] {
  const result: Product[] = [];
  for (const product of state.products.values()) {
    if (product.active && product.quantity === 0) {
      result.push(product);
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get today's sales count and total.
 */
export function getTodaysSalesTotal(state: InventoryState): {
  count: number;
  totalPaise: number;
} {
  const today = getTodayKolkata();
  let count = 0;
  let totalPaise = 0;

  for (const sale of state.sales) {
    if (sale.status === 'completed' && sale.soldAt.slice(0, 10) === today) {
      count++;
      totalPaise += sale.totalPaise;
    }
  }

  return { count, totalPaise };
}

/**
 * Get total completed sales count and total revenue across all sales.
 */
export function getTotalSalesSummary(state: InventoryState): {
  count: number;
  totalPaise: number;
} {
  let count = 0;
  let totalPaise = 0;

  for (const sale of state.sales) {
    if (sale.status === 'completed') {
      count++;
      totalPaise += sale.totalPaise;
    }
  }

  return { count, totalPaise };
}

/**
 * Calculate total inventory stock valuation for active products with positive stock.
 * Returns CP (Consultant/Cost Price), SRP (Selling Price), MRP (Max Retail Price) total values in paise.
 */
export function getInventoryValuation(state: InventoryState): {
  cpPaise: number;
  srpPaise: number;
  mrpPaise: number;
  totalUnits: number;
} {
  let cpPaise = 0;
  let srpPaise = 0;
  let mrpPaise = 0;
  let totalUnits = 0;

  for (const product of state.products.values()) {
    if (product.active) {
      const stockQty =
        product.setStockQuantity !== undefined && product.setStockQuantity !== null
          ? product.setStockQuantity
          : product.quantity;

      if (stockQty > 0) {
        totalUnits += product.quantity;
        const cp = product.consultantPricePaise ?? product.pricePaise;
        const srp = product.pricePaise;
        const mrp = product.mrpPaise ?? product.pricePaise;

        cpPaise += Math.round(cp * stockQty);
        srpPaise += Math.round(srp * stockQty);
        mrpPaise += Math.round(mrp * stockQty);
      }
    }
  }

  return { cpPaise, srpPaise, mrpPaise, totalUnits };
}


/**
 * Search active products by name or SKU (case-insensitive).
 */
export function searchProducts(
  products: ReadonlyMap<ProductId, Product>,
  query: string
): Product[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    // Return all active products when query is empty
    const result: Product[] = [];
    for (const product of products.values()) {
      if (product.active) {
        result.push(product);
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  const result: Product[] = [];
  for (const product of products.values()) {
    if (!product.active) continue;

    const nameMatch = product.name.toLowerCase().includes(normalized);
    const skuMatch = product.sku?.toLowerCase().includes(normalized) ?? false;

    if (nameMatch || skuMatch) {
      result.push(product);
    }
  }

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get a sale record by ID.
 */
export function getSaleById(state: InventoryState, saleId: number): SaleRecord | undefined {
  return state.sales.find((s) => s.id === saleId);
}

/**
 * Get all active products as a sorted array.
 */
export function getAllActiveProducts(products: ReadonlyMap<ProductId, Product>): Product[] {
  const result: Product[] = [];
  for (const product of products.values()) {
    if (product.active) {
      result.push(product);
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

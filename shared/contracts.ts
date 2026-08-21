// Shared DTOs, error envelope, and request/response types.
// Importable by both server/ (Cloudflare Worker) and src/ (Preact SPA).

export type { PaymentMethod, AdjustmentReason } from '../src/domain';

// ============================================================================
// Error envelope
// ============================================================================

export interface ApiErrorResponse {
  readonly error: string;
  readonly field?: string;
}

// ============================================================================
// DTOs (serialised representations sent over the wire)
// ============================================================================

export interface ProductDTO {
  readonly id: number;
  readonly sku: string | null;
  readonly name: string;
  readonly category: string | null;
  readonly colour: string | null;
  readonly size: string | null;
  readonly pricePaise: number;
  readonly mrpPaise: number | null;
  readonly consultantPricePaise: number | null;
  readonly quantity: number;
  readonly setStockQuantity: number;
  readonly unitsPerSet: number | null;
  readonly lowStockLevel: number;
  readonly locationId: number | null;
  readonly locationName: string | null;
  readonly personalUse: boolean;
  readonly active: boolean;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LocationDTO {
  readonly id: number;
  readonly name: string;
}

export interface LidReferenceDTO {
  readonly id: number;
  readonly orderCode: string | null;
  readonly itemCode: string;
  readonly description: string;
  readonly promotion: string | null;
  readonly mrpPaise: number;
  readonly specialPricePaise: number;
  readonly consultantPricePaise: number;
  readonly displayPricePaise: number;
}

export interface SaleLineDTO {
  readonly productId: number;
  readonly productName: string;
  readonly quantity: number;
  readonly unitPricePaise: number;
  readonly lineTotalPaise: number;
  readonly setStockBefore: number;
  readonly setStockAfter: number;
  readonly unitsPerSet: number | null;
  readonly setPricePaise: number | null;
}

export interface SaleDTO {
  readonly id: number;
  readonly saleNumber: string;
  readonly soldAt: string;
  readonly saleDate: string;
  readonly customerName: string | null;
  readonly isGift: boolean;
  readonly lines: readonly SaleLineDTO[];
  readonly subtotalPaise: number;
  readonly discountPaise: number;
  readonly totalPaise: number;
  readonly paymentMethod: string;
  readonly paidPaise: number;
  readonly balancePaise: number;
  readonly paymentStatus: 'unpaid' | 'partial' | 'paid';
  readonly payments: readonly PaymentDTO[];
  readonly status: 'completed' | 'cancelled';
  readonly cancelledAt?: string;
  readonly cancellationReason?: string;
}

export interface MovementDTO {
  readonly id: number;
  readonly productId: number;
  readonly productName: string;
  readonly quantityDelta: number;
  readonly setStockDelta: number;
  readonly reason: string;
  readonly saleId: number | null;
  readonly stockEntryId: number | null;
  readonly note: string | null;
  readonly createdAt: string;
}

export interface DashboardDTO {
  readonly today: { readonly count: number; readonly totalPaise: number };
  readonly total: { readonly count: number; readonly totalPaise: number };
  readonly lowStock: readonly ProductDTO[];
  readonly outOfStock: readonly ProductDTO[];
  readonly needsAttention: readonly ProductDTO[];
  readonly version: number;
  readonly lastUpdated: string;
}

// ============================================================================
// Request types
// ============================================================================

export interface CreateSaleRequest {
  readonly idempotencyKey: string;
  readonly saleDate: string;
  readonly customerName?: string | null;
  readonly isGift?: boolean;
  readonly lines: readonly {
    readonly productId: number;
    readonly quantity: number;
    readonly unitPricePaise?: number;
    readonly setPricePaise?: number;
    readonly setStockAfter?: number;
  }[];
  readonly discountPaise: number;
  readonly paymentMethod: string;
  readonly receivedPaise: number;
}

export interface PaymentDTO {
  readonly id: number;
  readonly amountPaise: number;
  readonly paymentMethod: string;
  readonly receivedAt: string;
}

export interface UpdatePaymentMethodRequest {
  readonly paymentMethod: string;
}

export interface SaleSummaryDTO {
  readonly id: number;
  readonly saleNumber: string;
  readonly saleDate: string;
  readonly customerName: string | null;
  readonly isGift: boolean;
  readonly totalPaise: number;
  readonly paidPaise: number;
  readonly balancePaise: number;
  readonly paymentStatus: 'unpaid' | 'partial' | 'paid';
  readonly status: 'completed' | 'cancelled';
}

export interface RecordPaymentRequest {
  readonly amountPaise: number;
  readonly paymentMethod: string;
}

export interface CreateProductRequest {
  readonly sku: string | null;
  readonly name: string;
  readonly category: string | null;
  readonly colour?: string | null;
  readonly size?: string | null;
  readonly pricePaise: number;
  readonly mrpPaise?: number | null;
  readonly consultantPricePaise?: number | null;
  readonly lowStockLevel: number;
  readonly quantity: number;
  readonly setStockQuantity?: number;
  readonly unitsPerSet?: number | null;
  readonly locationId?: number | null;
  readonly personalUse?: boolean;
  readonly active: boolean;
}

export interface UpdateProductRequest extends CreateProductRequest {}

export interface StockDeliveryRequest {
  readonly items: readonly { readonly productId: number; readonly quantity: number }[];
}

export interface StockCountRequest {
  readonly productId: number;
  readonly countedQuantity: number;
  readonly note?: string;
}

export type StockChangeReason =
  | 'delivery'
  | 'count'
  | 'damaged'
  | 'lost'
  | 'sample'
  | 'personal-use'
  | 'incorrect-entry'
  | 'other';

export interface StockChangeRequest {
  readonly productId: number;
  readonly expectedVersion: number;
  readonly quantity: number;
  readonly setStockQuantity: number;
  readonly reason: StockChangeReason;
  readonly note?: string | null;
}

export interface StockChangeResponse {
  readonly ok: true;
  readonly product: ProductDTO;
  readonly quantityDelta: number;
  readonly setStockDelta: number;
}

export interface StockAdjustmentRequest {
  readonly productId: number;
  readonly reason: string;
  readonly quantity: number;
  readonly note?: string;
}

export interface CancelSaleRequest {
  readonly reason: string;
}

export interface UpdateSaleRequest {
  readonly customerName?: string | null;
  readonly saleDate?: string;
  readonly isGift?: boolean;
}

export interface ImportCommitRequest {
  readonly requestId: string;
}

import type { InventoryState } from './domain';
import { EMPTY_SALE_DRAFT } from './domain';

export function createEmptyInventoryState(): InventoryState {
  return {
    products: new Map(),
    sales: [],
    adjustments: [],
    saleDraft: EMPTY_SALE_DRAFT,
    restockDraft: [],
    nextSaleId: 1,
    nextAdjustmentId: 1,
    idempotencyKeys: new Set(),
  };
}

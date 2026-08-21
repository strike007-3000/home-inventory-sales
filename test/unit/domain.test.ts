// Unit tests for domain layer pure functions.

import { describe, it, expect } from 'vitest';
import {
  formatInr,
  validateSaleDiscount,
  calculateSaleSubtotal,
  completeSale,
  cancelSale,
  receiveStock,
  countStock,
  adjustStockSubtractive,
  correctStock,
  setSaleLineQuantity,
  getSaleLineQuantity,
  clearSaleDraft,
  setRestockLineQuantity,
  getRestockLineQuantity,
  getLowStockProducts,
  getOutOfStockProducts,
  getTodaysSalesTotal,
  getTotalSalesSummary,
  getInventoryValuation,
  getInventoryValuationComparison,
  calculateProportionalLineTotal,
  deriveSetStock,
  getProductSetupIssue,
  calculateSetStockAfterSale,
  searchProducts,
  getTodayKolkata,
  validateQuantity,
  type SaleDraft,
  type RestockLine,
  type Product,
  type InventoryState,
} from '../../src/domain';
import { createInitialState, PRODUCT_IDS } from '../fixtures/inventory-state';

function createSaleReadyState(productId = PRODUCT_IDS.LUNCH_BOX_BLUE): InventoryState {
  const state = createInitialState();
  const product = state.products.get(productId)!;
  return {
    ...state,
    products: new Map(state.products).set(productId, {
      ...product,
      unitsPerSet: 1,
      setStockQuantity: product.quantity,
    }),
  };
}

describe('formatInr', () => {
  it('formats whole rupees without decimal', () => {
    expect(formatInr(49900)).toBe('₹499');
  });

  it('formats amounts with paise', () => {
    expect(formatInr(49950)).toBe('₹499.50');
  });

  it('formats zero', () => {
    expect(formatInr(0)).toBe('₹0');
  });

  it('formats large amounts with Indian grouping', () => {
    expect(formatInr(12500000)).toBe('₹1,25,000');
  });

  it('formats very large amounts', () => {
    expect(formatInr(125000000)).toBe('₹12,50,000');
  });
});

describe('validateSaleDiscount', () => {
  it('accepts zero discount', () => {
    const result = validateSaleDiscount(0, 1000);
    expect(result.ok).toBe(true);
  });

  it('accepts valid discount', () => {
    const result = validateSaleDiscount(500, 1000);
    expect(result.ok).toBe(true);
  });

  it('accepts discount equal to subtotal', () => {
    const result = validateSaleDiscount(1000, 1000);
    expect(result.ok).toBe(true);
  });

  it('rejects negative discount', () => {
    const result = validateSaleDiscount(-100, 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('negative');
    }
  });

  it('rejects discount exceeding subtotal', () => {
    const result = validateSaleDiscount(1500, 1000);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('more than subtotal');
    }
  });
});

describe('Sale draft operations', () => {
  it('sets and gets sale line quantity', () => {
    let draft: SaleDraft = { lines: [], discountPaise: 0, paymentMethod: 'upi', isGift: false };

    draft = setSaleLineQuantity(draft, 1, 3);
    expect(getSaleLineQuantity(draft, 1)).toBe(3);

    draft = setSaleLineQuantity(draft, 1, 5);
    expect(getSaleLineQuantity(draft, 1)).toBe(5);

    draft = setSaleLineQuantity(draft, 1, 0);
    expect(getSaleLineQuantity(draft, 1)).toBe(0);
    expect(draft.lines).toHaveLength(0);
  });

  it('handles multiple products in draft', () => {
    let draft: SaleDraft = { lines: [], discountPaise: 0, paymentMethod: 'upi', isGift: false };

    draft = setSaleLineQuantity(draft, 1, 2);
    draft = setSaleLineQuantity(draft, 2, 3);

    expect(getSaleLineQuantity(draft, 1)).toBe(2);
    expect(getSaleLineQuantity(draft, 2)).toBe(3);
    expect(draft.lines).toHaveLength(2);
  });

  it('clears every sale draft field through the canonical helper', () => {
    const draft: SaleDraft = {
      lines: [{ productId: 1, quantity: 3, unitPricePaise: 12500, setStockAfter: 2 }],
      discountPaise: 500,
      paymentMethod: 'cash',
      isGift: false,
    };

    expect(clearSaleDraft(draft)).toEqual({ lines: [], discountPaise: 0, paymentMethod: 'upi', isGift: false });
  });
});

describe('Restock draft operations', () => {
  it('sets and gets restock line quantity', () => {
    let draft: readonly RestockLine[] = [];

    draft = setRestockLineQuantity(draft, 1, 5);
    expect(getRestockLineQuantity(draft, 1)).toBe(5);

    draft = setRestockLineQuantity(draft, 1, 10);
    expect(getRestockLineQuantity(draft, 1)).toBe(10);

    draft = setRestockLineQuantity(draft, 1, 0);
    expect(getRestockLineQuantity(draft, 1)).toBe(0);
    expect(draft.filter(l => l.quantityReceived > 0)).toHaveLength(0);
  });
});

describe('calculateSaleSubtotal', () => {
  it('calculates subtotal for valid sale', () => {
    const state = createInitialState();
    const draft = {
      lines: [
        { productId: PRODUCT_IDS.LUNCH_BOX_BLUE, quantity: 2 },
        { productId: PRODUCT_IDS.WATER_BOTTLE_BLUE, quantity: 1 },
      ],
      discountPaise: 0,
      paymentMethod: 'upi' as const,
      isGift: false,
    };

    const result = calculateSaleSubtotal(draft, state.products);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Lunch Box Blue: ₹499 * 2 = ₹998
      // Water Bottle Blue: ₹299 * 1 = ₹299
      // Total: ₹1,297 = 129700 paise
      expect(result.value).toBe(129700);
    }
  });

  it('rejects empty sale', () => {
    const state = createInitialState();
    const draft = {
      lines: [],
      discountPaise: 0,
      paymentMethod: 'upi' as const,
      isGift: false,
    };

    const result = calculateSaleSubtotal(draft, state.products);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(0);
    }
  });

  it('rejects sale with insufficient stock', () => {
    const state = createInitialState();
    const draft = {
      lines: [{ productId: PRODUCT_IDS.LUNCH_BOX_BLUE, quantity: 100 }], // Only 12 in stock
      discountPaise: 0,
      paymentMethod: 'upi' as const,
      isGift: false,
    };

    const result = calculateSaleSubtotal(draft, state.products);
    expect(result.ok).toBe(false);
  });

  it('rejects sale with out of stock product', () => {
    const state = createInitialState();
    const draft = {
      lines: [{ productId: PRODUCT_IDS.WATER_BOTTLE_RED, quantity: 1 }], // Out of stock (0)
      discountPaise: 0,
      paymentMethod: 'upi' as const,
      isGift: false,
    };

    const result = calculateSaleSubtotal(draft, state.products);
    expect(result.ok).toBe(false);
  });

  it('rejects a draft containing an unavailable product', () => {
    const state = createInitialState();
    const draft = {
      lines: [{ productId: 999999, quantity: 1 }],
      discountPaise: 0,
      paymentMethod: 'upi' as const,
      isGift: false,
    };

    expect(calculateSaleSubtotal(draft, state.products)).toEqual({ ok: false, error: 'Product not found' });
  });

  it('handles zero price products', () => {
    const state = createInitialState();
    const draft = {
      lines: [{ productId: PRODUCT_IDS.SAMPLE_GIFT_ITEM, quantity: 3 }], // ₹0 price
      discountPaise: 0,
      paymentMethod: 'upi' as const,
      isGift: false,
    };

    const result = calculateSaleSubtotal(draft, state.products);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(0);
    }
  });
});

describe('completeSale', () => {
  it('completes a valid sale and reduces stock', () => {
    const state = createSaleReadyState();
    const initialProduct = state.products.get(PRODUCT_IDS.LUNCH_BOX_BLUE);
    expect(initialProduct).toBeDefined();
    if (!initialProduct) return;

    const initialQuantity = initialProduct.quantity;

    const draft = {
      lines: [{ productId: PRODUCT_IDS.LUNCH_BOX_BLUE, quantity: 2 }],
      discountPaise: 0,
      paymentMethod: 'upi' as const,
      isGift: false,
    };

    const stateWithDraft = { ...state, saleDraft: draft };
    const result = completeSale(stateWithDraft, 'test-key-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.sales).toHaveLength(1);
      const sale = result.value.sales[0];
      expect(sale).toBeDefined();
      expect(sale?.totalPaise).toBe(99800); // ₹499 * 2

      const updatedProduct = result.value.products.get(PRODUCT_IDS.LUNCH_BOX_BLUE);
      expect(updatedProduct).toBeDefined();
      if (updatedProduct) {
        expect(updatedProduct.quantity).toBe(initialQuantity - 2);
      }
    }
  });

  it('rejects empty sale', () => {
    const state = createInitialState();
    const draft = {
      lines: [],
      discountPaise: 0,
      paymentMethod: 'upi' as const,
      isGift: false,
    };

    const stateWithDraft = { ...state, saleDraft: draft };
    const result = completeSale(stateWithDraft, 'test-key-2');

    expect(result.ok).toBe(false);
  });

  it('rejects sale with insufficient stock without mutating', () => {
    const state = createSaleReadyState();
    const initialProduct = state.products.get(PRODUCT_IDS.LUNCH_BOX_BLUE);
    expect(initialProduct).toBeDefined();
    if (!initialProduct) return;

    const draft = {
      lines: [{ productId: PRODUCT_IDS.LUNCH_BOX_BLUE, quantity: 100 }], // Way more than available
      discountPaise: 0,
      paymentMethod: 'upi' as const,
      isGift: false,
    };

    const stateWithDraft = { ...state, saleDraft: draft };
    const result = completeSale(stateWithDraft, 'test-key-3');

    expect(result.ok).toBe(false);

    // Verify state wasn't mutated
    const unchangedProduct = state.products.get(PRODUCT_IDS.LUNCH_BOX_BLUE);
    expect(unchangedProduct?.quantity).toBe(initialProduct.quantity);
  });

  it('depletes stock to zero successfully', () => {
    const state = createSaleReadyState(PRODUCT_IDS.LUNCH_BOX_GREEN);
    const product = state.products.get(PRODUCT_IDS.LUNCH_BOX_GREEN);
    expect(product).toBeDefined();
    if (!product) return;

    const quantity = product.quantity; // 2

    const draft = {
      lines: [{ productId: PRODUCT_IDS.LUNCH_BOX_GREEN, quantity }],
      discountPaise: 0,
      paymentMethod: 'upi' as const,
      isGift: false,
    };

    const stateWithDraft = { ...state, saleDraft: draft };
    const result = completeSale(stateWithDraft, 'test-key-4');

    expect(result.ok).toBe(true);
    if (result.ok) {
      const updatedProduct = result.value.products.get(PRODUCT_IDS.LUNCH_BOX_GREEN);
      expect(updatedProduct?.quantity).toBe(0);
    }
  });

  it('applies discount correctly', () => {
    const state = createSaleReadyState();

    const draft = {
      lines: [{ productId: PRODUCT_IDS.LUNCH_BOX_BLUE, quantity: 2 }],
      discountPaise: 10000, // ₹100 discount
      paymentMethod: 'upi' as const,
      isGift: false,
    };

    const stateWithDraft = { ...state, saleDraft: draft };
    const result = completeSale(stateWithDraft, 'test-key-5');

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Subtotal: ₹998, Discount: ₹100, Total: ₹898
      const sale = result.value.sales[0];
      expect(sale).toBeDefined();
      expect(sale?.subtotalPaise).toBe(99800);
      expect(sale?.discountPaise).toBe(10000);
      expect(sale?.totalPaise).toBe(89800);
    }
  });

  it('allows sales while products still need setup', () => {
    const initial = createInitialState();
    const product = initial.products.get(PRODUCT_IDS.LUNCH_BOX_BLUE)!;
    const draft = { lines: [{ productId: product.id, quantity: 1 }], discountPaise: 0, paymentMethod: 'upi' as const, isGift: false };
    const missing = completeSale({ ...initial, products: new Map([[product.id, { ...product, unitsPerSet: null }]]), saleDraft: draft }, 'missing-setup');
    const mismatch = completeSale({ ...initial, products: new Map([[product.id, { ...product, setStockQuantity: product.quantity - 0.5 }]]), saleDraft: draft }, 'mismatch-setup');
    expect(missing.ok).toBe(true);
    expect(mismatch.ok).toBe(true);
  });
});

describe('cancelSale', () => {
  it('cancels a sale and restores stock', () => {
    let state = createSaleReadyState();
    const initialProduct = state.products.get(PRODUCT_IDS.LUNCH_BOX_BLUE);
    expect(initialProduct).toBeDefined();
    if (!initialProduct) return;

    const initialQuantity = initialProduct.quantity;

    // First complete a sale
    const draft = {
      lines: [{ productId: PRODUCT_IDS.LUNCH_BOX_BLUE, quantity: 2 }],
      discountPaise: 0,
      paymentMethod: 'upi' as const,
      isGift: false,
    };

    state = { ...state, saleDraft: draft };
    const completedState = completeSale(state, 'test-key-cancel');
    expect(completedState.ok).toBe(true);
    if (!completedState.ok) return;

    state = completedState.value;
    const sale = state.sales[0];
    expect(sale).toBeDefined();
    const saleId = sale?.id ?? 0;

    // Now cancel it
    const cancelledResult = cancelSale(state, saleId, 'Incorrect entry');
    expect(cancelledResult.ok).toBe(true);
    if (!cancelledResult.ok) return;

    const cancelledState = cancelledResult.value;

    // Check stock restored
    const restoredProduct = cancelledState.products.get(PRODUCT_IDS.LUNCH_BOX_BLUE);
    expect(restoredProduct?.quantity).toBe(initialQuantity);

    // Check sale status
    expect(cancelledState.sales[0]?.status).toBe('cancelled');
  });

  it('rejects cancelling already cancelled sale', () => {
    let state = createSaleReadyState();

    // Complete a sale
    const draft = {
      lines: [{ productId: PRODUCT_IDS.LUNCH_BOX_BLUE, quantity: 1 }],
      discountPaise: 0,
      paymentMethod: 'upi' as const,
      isGift: false,
    };

    state = { ...state, saleDraft: draft };
    const completedState = completeSale(state, 'test-key-double-cancel');
    expect(completedState.ok).toBe(true);
    if (!completedState.ok) return;

    state = completedState.value;
    const sale = state.sales[0];
    expect(sale).toBeDefined();
    const saleId = sale?.id ?? 0;

    // Cancel once
    const firstCancel = cancelSale(state, saleId, 'First cancel');
    expect(firstCancel.ok).toBe(true);
    if (!firstCancel.ok) return;

    // Try to cancel again
    const secondCancel = cancelSale(firstCancel.value, saleId, 'Second cancel');
    expect(secondCancel.ok).toBe(false);
  });

  it('restores the exact recorded Stock/set delta after later stock changes', () => {
    const product = { ...createInitialState().products.get(PRODUCT_IDS.LUNCH_BOX_BLUE)!, quantity: 1, setStockQuantity: 1 / 3, unitsPerSet: 3 };
    const initial = createInitialState();
    const completed = completeSale({ ...initial, products: new Map([[product.id, product]]), saleDraft: {
      lines: [{ productId: product.id, quantity: 1 }], discountPaise: 0, paymentMethod: 'upi', isGift: false,
    } }, 'exact-set-delta');
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    const currentSetStock = 2.123456789012345;
    const changedProduct = { ...completed.value.products.get(product.id)!, setStockQuantity: currentSetStock };
    const cancelled = cancelSale({ ...completed.value, products: new Map([[product.id, changedProduct]]) }, completed.value.sales[0]!.id, 'Undo');
    expect(cancelled.ok).toBe(true);
    if (cancelled.ok) expect(cancelled.value.products.get(product.id)?.setStockQuantity).toBe(currentSetStock + 1 / 3);
  });
});

describe('receiveStock', () => {
  it('receives stock for multiple products', () => {
    const state = createInitialState();
    const product1 = state.products.get(PRODUCT_IDS.LUNCH_BOX_BLUE);
    const product2 = state.products.get(PRODUCT_IDS.WATER_BOTTLE_BLUE);
    expect(product1).toBeDefined();
    expect(product2).toBeDefined();
    if (!product1 || !product2) return;

    const restockDraft = [
      { productId: PRODUCT_IDS.LUNCH_BOX_BLUE, quantityReceived: 5 },
      { productId: PRODUCT_IDS.WATER_BOTTLE_BLUE, quantityReceived: 10 },
    ];

    const stateWithDraft = { ...state, restockDraft };
    const result = receiveStock(stateWithDraft);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const updated1 = result.value.products.get(PRODUCT_IDS.LUNCH_BOX_BLUE);
      const updated2 = result.value.products.get(PRODUCT_IDS.WATER_BOTTLE_BLUE);

      expect(updated1?.quantity).toBe(product1.quantity + 5);
      expect(updated2?.quantity).toBe(product2.quantity + 10);
    }
  });

  it('rejects empty restock', () => {
    const state = createInitialState();
    const stateWithDraft = { ...state, restockDraft: [] };

    const result = receiveStock(stateWithDraft);
    expect(result.ok).toBe(false);
  });
});

describe('countStock', () => {
  it('sets absolute quantity and records decrease', () => {
    const state = createInitialState();
    const product = state.products.get(PRODUCT_IDS.LUNCH_BOX_BLUE);
    expect(product).toBeDefined();
    if (!product) return;

    const result = countStock(state, PRODUCT_IDS.LUNCH_BOX_BLUE, product.quantity - 2);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const updated = result.value.products.get(PRODUCT_IDS.LUNCH_BOX_BLUE);
      expect(updated?.quantity).toBe(product.quantity - 2);

      // Should have recorded an adjustment
      expect(result.value.adjustments.length).toBeGreaterThan(0);
    }
  });

  it('sets absolute quantity and records increase', () => {
    const state = createInitialState();
    const product = state.products.get(PRODUCT_IDS.LUNCH_BOX_BLUE);
    expect(product).toBeDefined();
    if (!product) return;

    const result = countStock(state, PRODUCT_IDS.LUNCH_BOX_BLUE, product.quantity + 5);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const updated = result.value.products.get(PRODUCT_IDS.LUNCH_BOX_BLUE);
      expect(updated?.quantity).toBe(product.quantity + 5);
    }
  });

  it('handles no change case', () => {
    const state = createInitialState();
    const product = state.products.get(PRODUCT_IDS.LUNCH_BOX_BLUE);
    expect(product).toBeDefined();
    if (!product) return;

    const result = countStock(state, PRODUCT_IDS.LUNCH_BOX_BLUE, product.quantity);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // No adjustment should be recorded
      expect(result.value.adjustments).toHaveLength(state.adjustments.length);
    }
  });

  it('rejects negative quantity', () => {
    const state = createInitialState();

    const result = countStock(state, PRODUCT_IDS.LUNCH_BOX_BLUE, -5);
    expect(result.ok).toBe(false);
  });
});

describe('adjustStockSubtractive', () => {
  it('decreases stock for damaged items', () => {
    const state = createInitialState();
    const product = state.products.get(PRODUCT_IDS.LUNCH_BOX_BLUE);
    expect(product).toBeDefined();
    if (!product) return;

    const result = adjustStockSubtractive(state, PRODUCT_IDS.LUNCH_BOX_BLUE, 'damaged', 2);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const updated = result.value.products.get(PRODUCT_IDS.LUNCH_BOX_BLUE);
      expect(updated?.quantity).toBe(product.quantity - 2);

      const adjustment = result.value.adjustments[result.value.adjustments.length - 1];
      expect(adjustment?.reason).toBe('damaged');
    }
  });

  it('rejects adjustment exceeding stock', () => {
    const state = createInitialState();
    const product = state.products.get(PRODUCT_IDS.LUNCH_BOX_BLUE);
    expect(product).toBeDefined();
    if (!product) return;

    const result = adjustStockSubtractive(state, PRODUCT_IDS.LUNCH_BOX_BLUE, 'lost', product.quantity + 10);

    expect(result.ok).toBe(false);
  });
});

describe('correctStock', () => {
  it('sets absolute quantity for incorrect entry', () => {
    const state = createInitialState();
    const product = state.products.get(PRODUCT_IDS.LUNCH_BOX_BLUE);
    expect(product).toBeDefined();
    if (!product) return;

    const result = correctStock(state, PRODUCT_IDS.LUNCH_BOX_BLUE, 'incorrect-entry', 20);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const updated = result.value.products.get(PRODUCT_IDS.LUNCH_BOX_BLUE);
      expect(updated?.quantity).toBe(20);
    }
  });
});

describe('Selectors', () => {
  it('gets low stock products', () => {
    const state = createInitialState();
    const lowStock = getLowStockProducts(state);

    // Lunch Box Green has quantity 2, lowStockLevel 2
    // Water Bottle Blue has quantity 3, lowStockLevel 5
    // Storage Set Medium has quantity 1, lowStockLevel 2
    expect(lowStock.length).toBeGreaterThan(0);
    expect(lowStock.every(p => p.quantity > 0 && p.quantity <= p.lowStockLevel)).toBe(true);
  });

  it('gets out of stock products', () => {
    const state = createInitialState();
    const outOfStock = getOutOfStockProducts(state);

    // Water Bottle Red has quantity 0
    expect(outOfStock.length).toBeGreaterThan(0);
    expect(outOfStock.every(p => p.quantity === 0)).toBe(true);
  });

  it('gets today\'s sales total', () => {
    const state = createInitialState();
    const { count, totalPaise } = getTodaysSalesTotal(state);

    expect(count).toBe(0);
    expect(totalPaise).toBe(0);
  });

  it('searches products by name', () => {
    const state = createInitialState();
    const results = searchProducts(state.products, 'lunch');

    expect(results.length).toBeGreaterThan(0);
    expect(results.every(p => p.name.toLowerCase().includes('lunch'))).toBe(true);
  });

  it('searches products by SKU', () => {
    const state = createInitialState();
    const results = searchProducts(state.products, 'LB-BLUE');

    expect(results.length).toBeGreaterThan(0);
    expect(results.some(p => p.sku === 'LB-BLUE')).toBe(true);
  });

  it('returns all active products for empty query', () => {
    const state = createInitialState();
    const results = searchProducts(state.products, '');

    // Should return all active products
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(p => p.active)).toBe(true);
  });
});

describe('Reset state', () => {
  it('createInitialState returns fresh state', () => {
    const state1 = createInitialState();
    const state2 = createInitialState();

    // Should be different object references
    expect(state1).not.toBe(state2);
    expect(state1.products).not.toBe(state2.products);

    // But with same values
    expect(state1.products.size).toBe(state2.products.size);
    expect(state1.sales).toEqual(state2.sales);
  });
});

describe('Idempotency', () => {
  it('returns the same result when the same idempotency key is reused', () => {
    const state = createSaleReadyState();
    const idempotencyKey = 'stable-test-key-1';

    const draft: SaleDraft = {
      lines: [{ productId: PRODUCT_IDS.LUNCH_BOX_BLUE, quantity: 1 }],
      discountPaise: 0,
      paymentMethod: 'upi',
      isGift: false,
    };

    const first = completeSale({ ...state, saleDraft: draft }, idempotencyKey);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = completeSale(first.value, idempotencyKey);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.sales).toHaveLength(first.value.sales.length);
  });

  it('creates a new sale when the idempotency key changes', () => {
    const state = createSaleReadyState();

    const draft: SaleDraft = {
      lines: [{ productId: PRODUCT_IDS.LUNCH_BOX_BLUE, quantity: 1 }],
      discountPaise: 0,
      paymentMethod: 'upi',
      isGift: false,
    };

    const first = completeSale({ ...state, saleDraft: draft }, 'key-a');
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // The draft was cleared after the first sale, so set up a fresh draft for the second
    const second = completeSale({ ...first.value, saleDraft: draft }, 'key-b');
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.value.sales.length).toBeGreaterThan(first.value.sales.length);
  });
});

describe('Quantity edge cases', () => {
  it('rejects fractional quantities in sale lines', () => {
    const state = createInitialState();
    const draft: SaleDraft = {
      lines: [{ productId: PRODUCT_IDS.LUNCH_BOX_BLUE, quantity: 1.5 }],
      discountPaise: 0,
      paymentMethod: 'upi',
      isGift: false,
    };

    const result = calculateSaleSubtotal(draft, state.products);
    expect(result.ok).toBe(false);
  });

  it('rejects negative counted quantity', () => {
    const state = createInitialState();
    const result = countStock(state, PRODUCT_IDS.LUNCH_BOX_BLUE, -1);
    expect(result.ok).toBe(false);
  });

  it('rejects zero subtractive adjustment quantity', () => {
    const state = createInitialState();
    const result = adjustStockSubtractive(state, PRODUCT_IDS.LUNCH_BOX_BLUE, 'damaged', 0);
    expect(result.ok).toBe(false);
  });

  it('validates finite whole numbers in quantity validator', () => {
    expect(validateQuantity(0, 'qty').ok).toBe(true);
    expect(validateQuantity(1, 'qty').ok).toBe(true);
    expect(validateQuantity(1.2, 'qty').ok).toBe(false);
    expect(validateQuantity(NaN, 'qty').ok).toBe(false);
    expect(validateQuantity(Infinity, 'qty').ok).toBe(false);
  });
});

describe('Kolkata time behavior', () => {
  it('returns a Kolkata-local date string in YYYY-MM-DD format', () => {
    const today = getTodayKolkata();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('getTodaysSalesTotal uses the Kolkata local date', () => {
    const state = createInitialState();
    const now = new Date();
    const kolkataDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);

    const saleDate = new Date(`${kolkataDate}T12:00:00+05:30`).toISOString();

    const saleWithKolkataDate = {
      id: state.sales.length + 1,
      saleNumber: '9999',
      soldAt: saleDate,
      lines: [
        {
          productId: PRODUCT_IDS.LUNCH_BOX_BLUE,
          productName: 'Lunch Box – Blue',
          quantity: 1,
          unitPricePaise: 49900,
          lineTotalPaise: 49900,
        },
      ],
      subtotalPaise: 49900,
      discountPaise: 0,
      totalPaise: 49900,
      paymentMethod: 'upi' as const,
      isGift: false,
      status: 'completed' as const,
    };

    const adjustedState = {
      ...state,
      sales: [saleWithKolkataDate],
    };

    const today = getTodaysSalesTotal(adjustedState);
    expect(today.count).toBe(1);
    expect(today.totalPaise).toBe(49900);
  });
});

describe('getTotalSalesSummary', () => {
  it('calculates total count and revenue for completed sales', () => {
    const state = createInitialState();
    const summary = getTotalSalesSummary(state);
    expect(summary.count).toBeGreaterThanOrEqual(0);
    expect(summary.totalPaise).toBeGreaterThanOrEqual(0);
  });
});

describe('getInventoryValuation', () => {
  it('calculates CP, SRP, MRP totals for active products with positive stock', () => {
    const state = createInitialState();
    const valuation = getInventoryValuation(state);
    expect(valuation.cpPaise).toBeGreaterThanOrEqual(0);
    expect(valuation.srpPaise).toBeGreaterThanOrEqual(0);
    expect(valuation.mrpPaise).toBeGreaterThanOrEqual(0);
    expect(valuation.totalUnits).toBeGreaterThanOrEqual(0);
  });
});

describe('set pricing and QTY-derived valuation', () => {
  const bottle: Product = {
    id: 999,
    sku: null,
    name: '310 ML BOTTLES',
    category: null,
    pricePaise: 66000,
    mrpPaise: 88000,
    consultantPricePaise: 50160,
    quantity: 14,
    setStockQuantity: 3.5,
    unitsPerSet: 4,
    lowStockLevel: 0,
    active: true,
    version: 1,
  };

  it('prices one bottle and one set from a set price', () => {
    expect(calculateProportionalLineTotal(66000, 1, 4)).toEqual({ ok: true, value: 16500 });
    expect(calculateProportionalLineTotal(66000, 4, 4)).toEqual({ ok: true, value: 66000 });
  });

  it('rounds half up once at the proportional line total', () => {
    expect(calculateProportionalLineTotal(1, 1, 2)).toEqual({ ok: true, value: 1 });
    expect(calculateProportionalLineTotal(1, 3, 2)).toEqual({ ok: true, value: 2 });
  });

  it('derives fractional set stock from individual QTY', () => {
    expect(deriveSetStock(14, 4)).toEqual({ ok: true, value: 3.5 });
    expect(deriveSetStock(10, 4)).toEqual({ ok: true, value: 2.5 });
  });

  it('flags missing and inconsistent stock setup without changing saved values', () => {
    expect(getProductSetupIssue({ ...bottle, unitsPerSet: null })).toBe('Pieces per set is missing.');
    expect(getProductSetupIssue({ ...bottle, quantity: 1, setStockQuantity: 0.5, unitsPerSet: 1 }))
      .toBe('1 piece should equal 1 set, but Stock/set is 0.5.');
    expect(getProductSetupIssue({ ...bottle, quantity: 1, setStockQuantity: 0.5, unitsPerSet: 2 })).toBeNull();
  });

  it('normalizes valid final and near-zero Stock/set values', () => {
    expect(calculateSetStockAfterSale({ ...bottle, quantity: 1, setStockQuantity: 0.5, unitsPerSet: 2 }, 1))
      .toEqual({ ok: true, value: 0 });
    expect(calculateSetStockAfterSale({ ...bottle, quantity: 1, setStockQuantity: 0.5, unitsPerSet: 1 }, 1))
      .toEqual({ ok: true, value: 0 });
    expect(calculateSetStockAfterSale({ ...bottle, quantity: 3, setStockQuantity: 0.3, unitsPerSet: 10 }, 3))
      .toEqual({ ok: true, value: 0 });
  });

  it('uses the tolerance boundary but rejects meaningful mismatches', () => {
    expect(getProductSetupIssue({ ...bottle, setStockQuantity: 3.5 + 0.9e-9 })).toBeNull();
    expect(getProductSetupIssue({ ...bottle, setStockQuantity: 3.5 + 1.1e-9 })).not.toBeNull();
  });

  it('returns exact legacy and QTY-derived CP, SRP and MRP values', () => {
    const state = { ...createInitialState(), products: new Map([[bottle.id, bottle]]) };
    expect(getInventoryValuationComparison(state)).toEqual({
      ok: true,
      value: {
        legacySetBased: { cpPaise: 175560, srpPaise: 231000, mrpPaise: 308000 },
        quantityDerived: { cpPaise: 175560, srpPaise: 231000, mrpPaise: 308000 },
        unconfiguredCount: 0,
      },
    });
  });

  it('reveals stale Stock/set without corrupting the QTY-derived valuation', () => {
    const staleBottle = { ...bottle, quantity: 10, setStockQuantity: 3.5 };
    const state = { ...createInitialState(), products: new Map([[staleBottle.id, staleBottle]]) };
    expect(getInventoryValuationComparison(state)).toEqual({
      ok: true,
      value: {
        legacySetBased: { cpPaise: 175560, srpPaise: 231000, mrpPaise: 308000 },
        quantityDerived: { cpPaise: 125400, srpPaise: 165000, mrpPaise: 220000 },
        unconfiguredCount: 1,
      },
    });
  });

  it('preserves legacy value and flags missing packaging when QTY is zero but Stock/set remains', () => {
    const staleZeroQty = { ...bottle, quantity: 0, setStockQuantity: 2, unitsPerSet: null };
    const state = { ...createInitialState(), products: new Map([[staleZeroQty.id, staleZeroQty]]) };
    expect(getInventoryValuationComparison(state)).toEqual({
      ok: true,
      value: {
        legacySetBased: { cpPaise: 100320, srpPaise: 132000, mrpPaise: 176000 },
        quantityDerived: { cpPaise: 0, srpPaise: 0, mrpPaise: 0 },
        unconfiguredCount: 1,
      },
    });
  });

  it('rejects invalid packaging and unsafe totals', () => {
    expect(calculateProportionalLineTotal(66000, 1, 0).ok).toBe(false);
    expect(calculateProportionalLineTotal(Number.MAX_SAFE_INTEGER, 2, 1).ok).toBe(false);
    expect(deriveSetStock(1.5, 4).ok).toBe(false);
  });
});

describe('searchProducts colour and size matching', () => {
  const productsMap = new Map<number, Product>([
      [1, { id: 1, sku: 'LB-01', name: 'Lunch Box', category: 'Kitchen', colour: 'Ocean Blue', size: '500ml', pricePaise: 50000, quantity: 10, lowStockLevel: 2, active: true, version: 1 }],
      [2, { id: 2, sku: 'LB-02', name: 'Lunch Box', category: 'Kitchen', colour: 'Crimson Red', size: '750ml', pricePaise: 60000, quantity: 5, lowStockLevel: 2, active: true, version: 1 }],
      [3, { id: 3, sku: null, name: 'Plain Box', category: null, colour: null, size: null, pricePaise: 30000, quantity: 3, lowStockLevel: 1, active: true, version: 1 }],
    ]);

  it('matches by colour or size case-insensitively', () => {
    const blueMatch = searchProducts(productsMap, 'OCEAN');
    expect(blueMatch).toHaveLength(1);
    expect(blueMatch[0]?.id).toBe(1);

    const sizeMatch = searchProducts(productsMap, '750ML');
    expect(sizeMatch).toHaveLength(1);
    expect(sizeMatch[0]?.id).toBe(2);
  });

  it('handles products with missing colour and size', () => {
    expect(searchProducts(productsMap, 'plain')).toEqual([productsMap.get(3)]);
    expect(searchProducts(productsMap, 'not-present')).toEqual([]);
  });
});

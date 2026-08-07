// Seed data for the Phase 0 prototype.
// 18 representative products covering all test scenarios.

import type { Product, ProductId, InventoryState } from './domain';
import { EMPTY_SALE_DRAFT } from './domain';

// Deterministic product IDs for stable testing
export const PRODUCT_IDS = {
  LUNCH_BOX_BLUE: 1 as ProductId,
  LUNCH_BOX_RED: 2 as ProductId,
  LUNCH_BOX_GREEN: 3 as ProductId,
  LUNCH_BOX_LARGE: 4 as ProductId,
  WATER_BOTTLE_RED: 5 as ProductId,
  WATER_BOTTLE_BLUE: 6 as ProductId,
  WATER_BOTTLE_SMALL: 7 as ProductId,
  STORAGE_SET_LARGE: 8 as ProductId,
  STORAGE_SET_SMALL: 9 as ProductId,
  STORAGE_SET_MEDIUM: 10 as ProductId,
  SERVING_BOWL_PREMIUM: 11 as ProductId,
  SERVING_BOWL_STANDARD: 12 as ProductId,
  SPICE_CONTAINER_SET: 13 as ProductId,
  JUG_WITH_LID: 14 as ProductId,
  SAMPLE_GIFT_ITEM: 15 as ProductId,
  KITCHEN_SHELF_ORGANISER: 16 as ProductId,
  TRAY_SET_WITH_HANDLE: 17 as ProductId,
  DISPOSABLE_PLATE_PACK: 18 as ProductId,
} as const;

const PRODUCTS: readonly Product[] = [
  // Lunch Boxes - color variants
  {
    id: PRODUCT_IDS.LUNCH_BOX_BLUE,
    sku: 'LB-BLUE',
    name: 'Lunch Box – Blue',
    category: 'Lunch Boxes',
    pricePaise: 49900, // ₹499
    quantity: 12,
    lowStockLevel: 2,
    active: true,
  },
  {
    id: PRODUCT_IDS.LUNCH_BOX_RED,
    sku: 'LB-RED',
    name: 'Lunch Box – Red',
    category: 'Lunch Boxes',
    pricePaise: 49900,
    quantity: 8,
    lowStockLevel: 2,
    active: true,
  },
  {
    id: PRODUCT_IDS.LUNCH_BOX_GREEN,
    sku: null, // No SKU
    name: 'Lunch Box – Green',
    category: 'Lunch Boxes',
    pricePaise: 49900,
    quantity: 2, // Low stock (at threshold)
    lowStockLevel: 2,
    active: true,
  },
  {
    id: PRODUCT_IDS.LUNCH_BOX_LARGE,
    sku: 'LB-LARGE',
    name: 'Lunch Box – Large with Compartments',
    category: 'Lunch Boxes',
    pricePaise: 75000, // ₹750
    quantity: 6,
    lowStockLevel: 3,
    active: true,
  },

  // Water Bottles - out of stock and variants
  {
    id: PRODUCT_IDS.WATER_BOTTLE_RED,
    sku: 'WB-RED',
    name: 'Water Bottle – Red',
    category: 'Water Bottles',
    pricePaise: 29900, // ₹299
    quantity: 0, // Out of stock
    lowStockLevel: 2,
    active: true,
  },
  {
    id: PRODUCT_IDS.WATER_BOTTLE_BLUE,
    sku: 'WB-BLUE',
    name: 'Water Bottle – Blue',
    category: 'Water Bottles',
    pricePaise: 29900,
    quantity: 3, // Low stock (below threshold of 5)
    lowStockLevel: 5,
    active: true,
  },
  {
    id: PRODUCT_IDS.WATER_BOTTLE_SMALL,
    sku: 'WB-SML',
    name: 'Water Bottle – Small',
    category: 'Water Bottles',
    pricePaise: 19900, // ₹199
    quantity: 15,
    lowStockLevel: 5,
    active: true,
  },

  // Storage Sets
  {
    id: PRODUCT_IDS.STORAGE_SET_LARGE,
    sku: 'SS-LARGE',
    name: 'Storage Set – Large',
    category: 'Storage',
    pricePaise: 125000, // ₹1,250
    quantity: 5,
    lowStockLevel: 3,
    active: true,
  },
  {
    id: PRODUCT_IDS.STORAGE_SET_SMALL,
    sku: 'SS-SML',
    name: 'Storage Set – Small',
    category: 'Storage',
    pricePaise: 75000, // ₹750
    quantity: 15,
    lowStockLevel: 5,
    active: true,
  },
  {
    id: PRODUCT_IDS.STORAGE_SET_MEDIUM,
    sku: null,
    name: 'Storage Set – Medium',
    category: 'Storage',
    pricePaise: 95000, // ₹950
    quantity: 1, // Very low stock
    lowStockLevel: 2,
    active: true,
  },

  // Serving Bowls - high value
  {
    id: PRODUCT_IDS.SERVING_BOWL_PREMIUM,
    sku: 'SB-PREM',
    name: 'Premium Serving Bowl with Lid',
    category: 'Serving',
    pricePaise: 1250000, // ₹12,500 - tests Indian number grouping
    quantity: 1,
    lowStockLevel: 1,
    active: true,
  },
  {
    id: PRODUCT_IDS.SERVING_BOWL_STANDARD,
    sku: 'SB-STD',
    name: 'Standard Serving Bowl',
    category: 'Serving',
    pricePaise: 45000, // ₹450
    quantity: 7,
    lowStockLevel: 3,
    active: true,
  },

  // Accessories
  {
    id: PRODUCT_IDS.SPICE_CONTAINER_SET,
    sku: 'SC-SET',
    name: 'Spice Container Set – 12 Pieces with Stand and Labels for Kitchen Organisation',
    category: 'Accessories',
    pricePaise: 65000, // ₹650
    quantity: 4,
    lowStockLevel: 2,
    active: true,
  },
  {
    id: PRODUCT_IDS.JUG_WITH_LID,
    sku: 'JUG-1L',
    name: 'Jug with Lid – 1 Litre',
    category: 'Accessories',
    pricePaise: 35000, // ₹350
    quantity: 10,
    lowStockLevel: 3,
    active: true,
  },
  {
    id: PRODUCT_IDS.SAMPLE_GIFT_ITEM,
    sku: 'GIFT-01',
    name: 'Sample Gift Item',
    category: 'Accessories',
    pricePaise: 0, // Zero price
    quantity: 10,
    lowStockLevel: 0,
    active: true,
  },
  {
    id: PRODUCT_IDS.KITCHEN_SHELF_ORGANISER,
    sku: 'KSO-01',
    name: 'Kitchen Shelf Organiser',
    category: 'Accessories',
    pricePaise: 89900, // ₹899
    quantity: 3,
    lowStockLevel: 2,
    active: true,
  },
  {
    id: PRODUCT_IDS.TRAY_SET_WITH_HANDLE,
    sku: 'TRAY-H',
    name: 'Tray Set with Handle',
    category: 'Accessories',
    pricePaise: 55000, // ₹550
    quantity: 6,
    lowStockLevel: 2,
    active: false, // Inactive product
  },
  {
    id: PRODUCT_IDS.DISPOSABLE_PLATE_PACK,
    sku: null,
    name: 'Disposable Plate Pack – 50 Pieces',
    category: 'Accessories',
    pricePaise: 25000, // ₹250
    quantity: 20,
    lowStockLevel: 5,
    active: true,
  },
];

/**
 * Create the initial inventory state from seed data.
 * Call this on mount and on Reset.
 */
export function createInitialState(): InventoryState {
  const productsMap = new Map<ProductId, Product>();
  for (const product of PRODUCTS) {
    productsMap.set(product.id, product);
  }

  return {
    products: productsMap,
    sales: [],
    adjustments: [],
    saleDraft: EMPTY_SALE_DRAFT,
    restockDraft: [],
    nextSaleId: 1,
    nextAdjustmentId: 1,
    idempotencyKeys: new Set<string>(),
  };
}

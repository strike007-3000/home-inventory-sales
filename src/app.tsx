// Main application shell with navigation and routing.
// Part 1: Imports, types, and app shell.

import { useState, useCallback, useMemo } from 'preact/hooks';
import type { JSX } from 'preact';
import {
  InventoryState,
  ProductId,
  Product,
  formatInr,
  getLowStockProducts,
  getOutOfStockProducts,
  getTodaysSalesTotal,
  searchProducts,
  getSaleLineQuantity,
  setSaleLineQuantity,
  setSaleDiscount,
  setSalePaymentMethod,
  completeSale,
  cancelSale,
  getRestockLineQuantity,
  setRestockLineQuantity,
  receiveStock,
  countStock,
  adjustStockSubtractive,
  correctStock,
  calculateSaleSubtotal,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  ADJUSTMENT_REASONS,
  ADJUSTMENT_REASON_LABELS,
  SUBTRACTIVE_REASONS,
  type AdjustmentReason,
  type PaymentMethod,
} from './domain';
import { createInitialState } from './seed';
import {
  HomeIcon,
  SellIcon,
  StockIcon,
  ProductsIcon,
  MoreIcon,
  SearchIcon,
  CheckIcon,
  PackageIcon,
  ClipboardIcon,
  WrenchIcon,
  PlusIcon,
  MinusIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
} from './icons';
import './styles.css';

// Route type
type Route =
  | 'home'
  | 'sell'
  | 'stock'
  | 'stock-arrived'
  | 'count-stock'
  | 'fix-stock'
  | 'review-sale'
  | 'sale-completed'
  | 'view-sale'
  | 'cancel-sale-confirm'
  | 'products'
  | 'more';

// ============================================================================
// Navigation Component
// ============================================================================

interface NavProps {
  currentRoute: Route;
  onNavigate: (route: Route) => void;
}

function Nav({ currentRoute, onNavigate }: NavProps) {
  const navItems: { route: Route; label: string; Icon: () => JSX.Element }[] = [
    { route: 'home', label: 'Home', Icon: HomeIcon },
    { route: 'sell', label: 'Sell', Icon: SellIcon },
    { route: 'stock', label: 'Stock', Icon: StockIcon },
    { route: 'products', label: 'Products', Icon: ProductsIcon },
    { route: 'more', label: 'More', Icon: MoreIcon },
  ];

  return (
    <nav class="nav" role="navigation" aria-label="Main navigation">
      <div class="nav-inner">
        {navItems.map(({ route, label, Icon }) => (
          <button
            key={route}
            class={`nav-item ${currentRoute === route ? 'active' : ''}`}
            onClick={() => onNavigate(route)}
            aria-current={currentRoute === route ? 'page' : undefined}
            type="button"
          >
            <span class="nav-icon" aria-hidden="true">
              <Icon />
            </span>
            <span>{label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

// ============================================================================
// Home Screen
// ============================================================================

interface HomeScreenProps {
  state: InventoryState;
  onNavigate: (route: Route) => void;
  onReset: () => void;
}

function HomeScreen({ state, onNavigate, onReset }: HomeScreenProps) {
  const lowStock = getLowStockProducts(state);
  const outOfStock = getOutOfStockProducts(state);
  const todaySales = getTodaysSalesTotal(state);

  const handleReset = () => {
    if (confirm('Reset all sample data? This cannot be undone.')) {
      onReset();
    }
  };

  return (
    <div class="screen">
      <div class="main no-sticky-action">
        {/* Record a sale button */}
        <button
          class="btn btn-primary btn-lg mb-6"
          onClick={() => onNavigate('sell')}
          type="button"
        >
          Record a sale
        </button>

        {/* Today's sales */}
        <section class="mb-4">
          <h2 class="text-lg font-semibold mb-3">Today</h2>
          <div class="card">
            <div class="summary-value">{todaySales.count} {todaySales.count === 1 ? 'sale' : 'sales'}</div>
            <div class="summary-label">
              {todaySales.totalPaise > 0 ? formatInr(todaySales.totalPaise) + ' received' : 'No sales yet'}
            </div>
          </div>
        </section>

        {/* Stock alerts */}
        <section class="mb-4">
          <h2 class="text-lg font-semibold mb-3">Stock alerts</h2>
          <div class="flex gap-3">
            <button
              class="card card-clickable flex-1"
              onClick={() => onNavigate('products')}
              type="button"
            >
              <div class="summary-value text-marigold">{lowStock.length}</div>
              <div class="summary-label">Low stock</div>
            </button>
            <button
              class="card card-clickable flex-1"
              onClick={() => onNavigate('products')}
              type="button"
            >
              <div class="summary-value text-error">{outOfStock.length}</div>
              <div class="summary-label">Out of stock</div>
            </button>
          </div>
        </section>

        {/* Needs attention */}
        {(lowStock.length > 0 || outOfStock.length > 0) && (
          <section class="mb-4">
            <h2 class="text-lg font-semibold mb-3">Needs attention</h2>
            {[...outOfStock, ...lowStock.slice(0, 3)].map((product) => (
              <div key={product.id} class="list-item">
                <div>
                  <div class="font-semibold">{product.name}</div>
                  <div class="text-sm text-ink-light">
                    {product.quantity === 0 ? 'Out of stock' : `${product.quantity} left`}
                  </div>
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Footer */}
        <div class="text-center text-sm text-ink-light mt-6">
          <p>Sample data · Updated just now</p>
          <button class="btn btn-ghost btn-sm" onClick={handleReset} type="button">
            Reset sample data
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Product Card Component
// ============================================================================

interface ProductCardProps {
  product: Product;
  quantityInDraft: number;
  quantityLabel: string;
  maxQuantity?: number;
  onQuantityChange: (quantity: number) => void;
  showAfterQuantity?: number;
}

function ProductCard({
  product,
  quantityInDraft,
  quantityLabel,
  maxQuantity,
  onQuantityChange,
  showAfterQuantity,
}: ProductCardProps) {
  const isOutOfStock = product.quantity === 0;
  const isAtMax = maxQuantity !== undefined && quantityInDraft >= maxQuantity;

  const handleDecrease = () => {
    if (quantityInDraft > 0) {
      onQuantityChange(quantityInDraft - 1);
    }
  };

  const handleIncrease = () => {
    if (!isOutOfStock && !isAtMax) {
      onQuantityChange(quantityInDraft + 1);
    }
  };

  return (
    <div class="card">
      <div class="card-header">
        <div>
          <h3 class="card-title">{product.name}</h3>
          {product.sku && <div class="card-subtitle code">{product.sku}</div>}
        </div>
        <div class="card-price">{formatInr(product.pricePaise)}</div>
      </div>

      <div class="text-sm text-ink-light mb-2">
        {isOutOfStock ? (
          <span class="status-chip status-chip-out-of-stock">Out of stock</span>
        ) : (
          `${product.quantity} in stock`
        )}
      </div>

      <div class="quantity-label">{quantityLabel}</div>
      <div class="quantity-control">
        <button
          class="quantity-btn"
          onClick={handleDecrease}
          disabled={quantityInDraft === 0}
          type="button"
          aria-label={`Decrease ${product.name} quantity`}
        >
          <MinusIcon />
        </button>
        <span class="quantity-value">{quantityInDraft}</span>
        <button
          class="quantity-btn"
          onClick={handleIncrease}
          disabled={isOutOfStock || isAtMax}
          type="button"
          aria-label={`Increase ${product.name} quantity`}
        >
          <PlusIcon />
        </button>
      </div>

      {isAtMax && !isOutOfStock && (
        <div class="quantity-hint">Only {maxQuantity} available</div>
      )}

      {showAfterQuantity !== undefined && quantityInDraft > 0 && (
        <div class="text-sm text-ink-light mt-2">
          After saving: <span class="font-semibold">{showAfterQuantity}</span>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Sell Screen
// ============================================================================

interface SellScreenProps {
  state: InventoryState;
  onSaleDraftChange: (draft: InventoryState['saleDraft']) => void;
  onNavigate: (route: Route) => void;
}

function SellScreen({ state, onSaleDraftChange, onNavigate }: SellScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredProducts = useMemo(() => {
    return searchProducts(state.products, searchQuery);
  }, [state.products, searchQuery]);

  const cartItemCount = state.saleDraft.lines.reduce((sum, line) => sum + line.quantity, 0);
  const subtotalResult = calculateSaleSubtotal(state.saleDraft, state.products);

  const handleQuantityChange = (productId: ProductId, quantity: number) => {
    const newDraft = setSaleLineQuantity(state.saleDraft, productId, quantity);
    onSaleDraftChange(newDraft);
  };

  return (
    <div class="screen">
      <div class="main">
        {/* Search */}
        <h1 class="text-2xl font-semibold mb-4">Record a sale</h1>
        <div class="search-input">
          <SearchIcon />
          <input
            type="search"
            class="form-input"
            placeholder="Search products..."
            value={searchQuery}
            onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
            aria-label="Search products"
          />
        </div>

        {/* Products */}
        {filteredProducts.length === 0 ? (
          <div class="empty-state">
            <div class="empty-state-icon">
              <SearchIcon />
            </div>
            <h3 class="empty-state-title">No products found</h3>
            <p class="empty-state-message">Try a different search.</p>
          </div>
        ) : (
          filteredProducts.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              quantityInDraft={getSaleLineQuantity(state.saleDraft, product.id)}
              quantityLabel="Quantity to sell"
              maxQuantity={product.quantity}
              onQuantityChange={(q) => handleQuantityChange(product.id, q)}
            />
          ))
        )}
      </div>

      {/* Sticky cart summary */}
      {cartItemCount > 0 && (
        <div class="sticky-action">
          <div class="sticky-action-inner">
            <button
              class="btn btn-primary btn-lg"
              onClick={() => onNavigate('review-sale')}
              type="button"
            >
              <span>Review sale · {cartItemCount} items</span>
              {subtotalResult.ok && (
                <span> · {formatInr(subtotalResult.value)}</span>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Review Sale Screen
// ============================================================================

interface ReviewSaleScreenProps {
  state: InventoryState;
  saleIdempotencyKey: string;
  onSaleDraftChange: (draft: InventoryState['saleDraft']) => void;
  onStateChange: (state: InventoryState) => void;
  onNavigate: (route: Route) => void;
  setLastCompletedSaleId: (id: number) => void;
}

function ReviewSaleScreen({
  state,
  saleIdempotencyKey,
  onSaleDraftChange,
  onStateChange,
  onNavigate,
  setLastCompletedSaleId,
}: ReviewSaleScreenProps) {
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { saleDraft, products } = state;

  // Calculate subtotal
  const subtotalResult = calculateSaleSubtotal(saleDraft, products);
  const subtotalPaise = subtotalResult.ok ? subtotalResult.value : 0;
  const totalPaise = Math.max(0, subtotalPaise - saleDraft.discountPaise);

  // Get line items with product details
  const lineItems = saleDraft.lines
    .map((line) => {
      const product = products.get(line.productId);
      if (!product) return null;
      return {
        product,
        quantity: line.quantity,
        lineTotal: product.pricePaise * line.quantity,
      };
    })
    .filter((item): item is { product: Product; quantity: number; lineTotal: number } => item !== null);

  const handleDiscountChange = (e: Event) => {
    const value = (e.target as HTMLInputElement).value;
    // Parse as rupees, convert to paise
    const rupees = parseFloat(value) || 0;
    const paise = Math.round(rupees * 100);
    onSaleDraftChange(setSaleDiscount(saleDraft, paise));
  };

  const handlePaymentMethodChange = (method: PaymentMethod) => {
    onSaleDraftChange(setSalePaymentMethod(saleDraft, method));
  };

  const handleCompleteSale = async () => {
    setError(null);
    setIsSubmitting(true);

    // Simulate a brief delay for UX
    await new Promise((resolve) => setTimeout(resolve, 300));

    const result = completeSale(state, saleIdempotencyKey);
    setIsSubmitting(false);

    if (result.ok) {
      setLastCompletedSaleId(result.value.sales[result.value.sales.length - 1]?.id ?? 0);
      onStateChange(result.value);
      onNavigate('sale-completed');
    } else {
      setError(result.error);
    }
  };

  return (
    <div class="screen">
      <div class="main">
        <h1 class="text-2xl font-semibold mb-4">Review sale</h1>

        {/* Line items */}
        {lineItems.map(({ product, quantity, lineTotal }) => (
          <div key={product.id} class="card">
            <div class="flex justify-between items-start">
              <div>
                <div class="font-semibold">{product.name}</div>
                <div class="text-sm text-ink-light">Qty: {quantity}</div>
              </div>
              <div class="font-semibold">{formatInr(lineTotal)}</div>
            </div>
          </div>
        ))}

        {/* Totals */}
        <div class="card mt-4">
          <div class="flex justify-between mb-2">
            <span>Subtotal</span>
            <span class="font-semibold">{formatInr(subtotalPaise)}</span>
          </div>

          <div class="form-group">
            <label class="form-label" for="discount">Discount amount (₹)</label>
            <input
              id="discount"
              type="number"
              class="form-input"
              value={saleDraft.discountPaise / 100}
              onInput={handleDiscountChange}
              min={0}
              step={1}
              inputMode="decimal"
            />
          </div>

          <div class="flex justify-between text-lg font-semibold mt-3 pt-3 divider-top">
            <span>Total</span>
            <span>{formatInr(totalPaise)}</span>
          </div>
        </div>

        {/* Payment method */}
        <div class="card">
          <label class="form-label">Payment method</label>
          <div class="payment-methods" role="group" aria-label="Payment method">
            {PAYMENT_METHODS.map((method) => (
              <button
                key={method}
                class={`payment-pill ${saleDraft.paymentMethod === method ? 'selected' : ''}`}
                onClick={() => handlePaymentMethodChange(method)}
                aria-pressed={saleDraft.paymentMethod === method}
                type="button"
              >
                {PAYMENT_METHOD_LABELS[method]}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div class="error-message mt-3" role="alert">
            {error}
          </div>
        )}
      </div>

      {/* Complete sale button */}
      <div class="sticky-action">
        <div class="sticky-action-inner">
          <button
            class="btn btn-primary btn-lg"
            onClick={handleCompleteSale}
            disabled={isSubmitting || lineItems.length === 0}
            type="button"
          >
            {isSubmitting ? 'Saving...' : `Complete sale · ${formatInr(totalPaise)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Sale Completed Screen
// ============================================================================

interface SaleCompletedScreenProps {
  state: InventoryState;
  lastCompletedSaleId: number;
  onNavigate: (route: Route) => void;
}

function SaleCompletedScreen({ state, lastCompletedSaleId, onNavigate }: SaleCompletedScreenProps) {
  const sale = state.sales.find((s) => s.id === lastCompletedSaleId);

  if (!sale) {
    return (
      <div class="screen">
        <div class="main">
          <div class="result-screen">
            <h2 class="result-title">Sale not found</h2>
            <button class="btn btn-primary" onClick={() => onNavigate('home')} type="button">
              Go home
            </button>
          </div>
        </div>
      </div>
    );
  }

  const itemCount = sale.lines.reduce((sum, line) => sum + line.quantity, 0);

  return (
    <div class="screen">
      <div class="main no-sticky-action">
        <div class="result-screen">
          <div class="result-icon success">
            <CheckIcon />
          </div>
          <h1 class="result-title">Sale saved</h1>
          <p class="result-message">
            {itemCount} {itemCount === 1 ? 'item' : 'items'} sold<br />
            {formatInr(sale.totalPaise)} received by {PAYMENT_METHOD_LABELS[sale.paymentMethod]}<br />
            Stock has been updated
          </p>
          <div class="result-actions">
            <button class="btn btn-secondary" onClick={() => onNavigate('home')} type="button">
              Done
            </button>
            <button
              class="btn btn-primary"
              onClick={() => onNavigate('view-sale')}
              type="button"
            >
              View sale
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Stock Chooser Screen
// ============================================================================

interface StockChooserScreenProps {
  onNavigate: (route: Route) => void;
}

function StockChooserScreen({ onNavigate }: StockChooserScreenProps) {
  const actions = [
    { route: 'stock-arrived' as Route, icon: PackageIcon, title: 'Stock arrived', description: 'Add quantities you received' },
    { route: 'count-stock' as Route, icon: ClipboardIcon, title: 'Count stock', description: 'Enter what you physically have' },
    { route: 'fix-stock' as Route, icon: WrenchIcon, title: 'Fix stock quantity', description: 'Damage, loss, samples, errors' },
  ];

  return (
    <div class="screen">
      <div class="main no-sticky-action">
        <h1 class="text-2xl font-semibold mb-4">Stock</h1>
        {actions.map(({ route, icon: Icon, title, description }) => (
          <button
            key={route}
            class="card card-clickable mb-3"
            onClick={() => onNavigate(route)}
            type="button"
          >
            <div class="flex items-center gap-4">
              <div class="action-icon">
                <Icon />
              </div>
              <div class="flex-1 text-left">
                <div class="font-semibold">{title}</div>
                <div class="text-sm text-ink-light">{description}</div>
              </div>
              <ChevronRightIcon />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Stock Arrived Screen
// ============================================================================

interface StockArrivedScreenProps {
  state: InventoryState;
  onRestockDraftChange: (draft: InventoryState['restockDraft']) => void;
  onStateChange: (state: InventoryState) => void;
}

function StockArrivedScreen({ state, onRestockDraftChange, onStateChange }: StockArrivedScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const filteredProducts = useMemo(() => {
    return searchProducts(state.products, searchQuery);
  }, [state.products, searchQuery]);

  const activeLines = state.restockDraft.filter((l) => l.quantityReceived > 0);
  const totalUnits = activeLines.reduce((sum, l) => sum + l.quantityReceived, 0);

  const handleQuantityChange = (productId: ProductId, quantity: number) => {
    const newDraft = setRestockLineQuantity(state.restockDraft, productId, quantity);
    onRestockDraftChange(newDraft);
  };

  const handleSave = async () => {
    setError(null);
    setIsSubmitting(true);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const result = receiveStock(state);
    setIsSubmitting(false);

    if (result.ok) {
      onStateChange(result.value);
    } else {
      setError(result.error);
    }
  };

  return (
    <div class="screen">
      <div class="main">
        <h1 class="text-2xl font-semibold mb-4">Stock arrived</h1>

        <div class="search-input">
          <SearchIcon />
          <input
            type="search"
            class="form-input"
            placeholder="Search products..."
            value={searchQuery}
            onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
            aria-label="Search products"
          />
        </div>

        {filteredProducts.length === 0 ? (
          <div class="empty-state">
            <div class="empty-state-icon">🔍</div>
            <h3 class="empty-state-title">No products found</h3>
          </div>
        ) : (
          filteredProducts.map((product) => {
            const qty = getRestockLineQuantity(state.restockDraft, product.id);
            return (
              <ProductCard
                key={product.id}
                product={product}
                quantityInDraft={qty}
                quantityLabel="Quantity received"
                onQuantityChange={(q) => handleQuantityChange(product.id, q)}
                showAfterQuantity={product.quantity + qty}
              />
            );
          })
        )}

        {error && <div class="error-message mt-3" role="alert">{error}</div>}
      </div>

      {activeLines.length > 0 && (
        <div class="sticky-action">
          <div class="sticky-action-inner">
            <button
              class="btn btn-primary btn-lg"
              onClick={handleSave}
              disabled={isSubmitting}
              type="button"
            >
              {isSubmitting ? 'Saving...' : `Save received stock · ${totalUnits} ${totalUnits === 1 ? 'unit' : 'units'}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Count Stock Screen
// ============================================================================

interface CountStockScreenProps {
  state: InventoryState;
  onStateChange: (state: InventoryState) => void;
}

function CountStockScreen({ state, onStateChange }: CountStockScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<ProductId | null>(null);
  const [countedQuantity, setCountedQuantity] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const filteredProducts = useMemo(() => {
    return searchProducts(state.products, searchQuery);
  }, [state.products, searchQuery]);

  const selectedProduct = selectedProductId !== null ? state.products.get(selectedProductId) : undefined;

  const handleSelectProduct = (productId: ProductId) => {
    setSelectedProductId(productId);
    const product = state.products.get(productId);
    if (product) {
      setCountedQuantity(String(product.quantity));
    }
    setError(null);
    setSuccess(false);
  };

  const handleSave = async () => {
    if (!selectedProductId) return;

    const quantity = parseInt(countedQuantity, 10);
    if (isNaN(quantity) || quantity < 0) {
      setError('Enter a valid quantity');
      return;
    }

    setError(null);
    const result = countStock(state, selectedProductId, quantity);

    if (result.ok) {
      onStateChange(result.value);
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setSelectedProductId(null);
        setCountedQuantity('');
      }, 1500);
    } else {
      setError(result.error);
    }
  };

  const delta = selectedProduct ? parseInt(countedQuantity || '0', 10) - selectedProduct.quantity : 0;

  return (
    <div class="screen">
      <div class="main">
        <h1 class="text-2xl font-semibold mb-4">Count stock</h1>

        {!selectedProduct ? (
          <>
            <div class="search-input">
              <SearchIcon />
              <input
                type="search"
                class="form-input"
                placeholder="Search products..."
                value={searchQuery}
                onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
                aria-label="Search products"
              />
            </div>

            {filteredProducts.map((product) => (
              <button
                key={product.id}
                class="card card-clickable mb-3"
                onClick={() => handleSelectProduct(product.id)}
                type="button"
              >
                <div class="flex justify-between items-center">
                  <div>
                    <div class="font-semibold">{product.name}</div>
                    <div class="text-sm text-ink-light">{product.quantity} in stock</div>
                  </div>
                  <ChevronRightIcon />
                </div>
              </button>
            ))}
          </>
        ) : (
          <>
            <button class="btn btn-ghost btn-sm mb-4" onClick={() => setSelectedProductId(null)} type="button">
              <ChevronLeftIcon /> Choose another product
            </button>

            <div class="card">
              <h2 class="card-title mb-2">{selectedProduct.name}</h2>

              <div class="mb-4">
                <div class="text-sm text-ink-light mb-1">System quantity</div>
                <div class="text-2xl font-bold">{selectedProduct.quantity}</div>
              </div>

              <div class="form-group">
                <label class="form-label" for="count">How many did you count?</label>
                <input
                  id="count"
                  type="number"
                  class="form-input form-input-lg"
                  value={countedQuantity}
                  onInput={(e) => setCountedQuantity((e.target as HTMLInputElement).value)}
                  min={0}
                  inputMode="numeric"
                />
              </div>

              {delta !== 0 && (
                <div class="stock-delta">
                  <span class={`stock-delta-value ${delta > 0 ? 'increase' : 'decrease'}`}>
                    {delta > 0 ? `Increase by ${delta}` : `Decrease by ${Math.abs(delta)}`}
                  </span>
                </div>
              )}

              {delta === 0 && parseInt(countedQuantity || '0', 10) === selectedProduct.quantity && (
                <div class="text-center text-ink-light mt-3">No change needed</div>
              )}
            </div>

            {error && <div class="error-message mt-3" role="alert">{error}</div>}

            {success && (
              <div class="text-center text-success font-semibold mt-3" role="status" aria-live="polite">
                <CheckIcon /> Stock updated
              </div>
            )}
          </>
        )}
      </div>

      {selectedProduct && (
        <div class="sticky-action">
          <div class="sticky-action-inner">
            <button
              class="btn btn-primary btn-lg"
              onClick={handleSave}
              disabled={success}
              type="button"
            >
              Save count
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Fix Stock Screen
// ============================================================================

interface FixStockScreenProps {
  state: InventoryState;
  onStateChange: (state: InventoryState) => void;
}

function FixStockScreen({ state, onStateChange }: FixStockScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<ProductId | null>(null);
  const [reason, setReason] = useState<AdjustmentReason>('damaged');
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const filteredProducts = useMemo(() => {
    return searchProducts(state.products, searchQuery);
  }, [state.products, searchQuery]);

  const selectedProduct = selectedProductId !== null ? state.products.get(selectedProductId) : undefined;
  const isSubtractive = SUBTRACTIVE_REASONS.includes(reason);

  const handleSelectProduct = (productId: ProductId) => {
    setSelectedProductId(productId);
    setError(null);
    setSuccess(false);
    setQuantity('1');
    setReason('damaged');
    setNote('');
  };

  const handleSave = async () => {
    if (!selectedProductId) return;

    const qty = parseInt(quantity, 10);
    if (isNaN(qty) || qty < 0) {
      setError('Enter a valid quantity');
      return;
    }

    setError(null);

    let result;
    if (isSubtractive) {
      result = adjustStockSubtractive(state, selectedProductId, reason, qty, note || undefined);
    } else {
      result = correctStock(state, selectedProductId, reason, qty, note || undefined);
    }

    if (result.ok) {
      onStateChange(result.value);
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setSelectedProductId(null);
        setQuantity('1');
        setNote('');
      }, 1500);
    } else {
      setError(result.error);
    }
  };

  const newQuantity = selectedProduct
    ? isSubtractive
      ? selectedProduct.quantity - parseInt(quantity || '0', 10)
      : parseInt(quantity || '0', 10)
    : 0;

  return (
    <div class="screen">
      <div class="main">
        <h1 class="text-2xl font-semibold mb-4">Fix stock quantity</h1>

        {!selectedProduct ? (
          <>
            <div class="search-input">
              <SearchIcon />
              <input
                type="search"
                class="form-input"
                placeholder="Search products..."
                value={searchQuery}
                onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
                aria-label="Search products"
              />
            </div>

            {filteredProducts.map((product) => (
              <button
                key={product.id}
                class="card card-clickable mb-3"
                onClick={() => handleSelectProduct(product.id)}
                type="button"
              >
                <div class="flex justify-between items-center">
                  <div>
                    <div class="font-semibold">{product.name}</div>
                    <div class="text-sm text-ink-light">{product.quantity} in stock</div>
                  </div>
                  <ChevronRightIcon />
                </div>
              </button>
            ))}
          </>
        ) : (
          <>
            <button class="btn btn-ghost btn-sm mb-4" onClick={() => setSelectedProductId(null)} type="button">
              <ChevronLeftIcon /> Choose another product
            </button>

            <div class="card">
              <h2 class="card-title mb-2">{selectedProduct.name}</h2>
              <div class="text-sm text-ink-light mb-4">{selectedProduct.quantity} in stock</div>

              <div class="form-group">
                <label class="form-label" for="reason">What happened?</label>
                <select
                  id="reason"
                  class="form-input"
                  value={reason}
                  onChange={(e) => {
                    setReason((e.target as HTMLSelectElement).value as AdjustmentReason);
                    setError(null);
                  }}
                >
                  {ADJUSTMENT_REASONS.map((r) => (
                    <option key={r} value={r}>{ADJUSTMENT_REASON_LABELS[r]}</option>
                  ))}
                </select>
              </div>

              <div class="form-group">
                <label class="form-label" for="qty">
                  {isSubtractive ? 'How many were affected?' : 'What should the quantity be?'}
                </label>
                <input
                  id="qty"
                  type="number"
                  class="form-input form-input-lg"
                  value={quantity}
                  onInput={(e) => setQuantity((e.target as HTMLInputElement).value)}
                  min={0}
                  inputMode="numeric"
                />
              </div>

              {isSubtractive && selectedProduct && (
                <div class="text-sm text-ink-light mb-3">
                  Stock will decrease from {selectedProduct.quantity} to {Math.max(0, newQuantity)}
                </div>
              )}

              {!isSubtractive && selectedProduct && (
                <div class="text-sm text-ink-light mb-3">
                  Stock will {newQuantity > selectedProduct.quantity ? 'increase' : 'decrease'} by {Math.abs(newQuantity - selectedProduct.quantity)}
                </div>
              )}

              <div class="form-group">
                <label class="form-label" for="note">Note (optional)</label>
                <input
                  id="note"
                  type="text"
                  class="form-input"
                  value={note}
                  onInput={(e) => setNote((e.target as HTMLInputElement).value)}
                  placeholder="Add a note..."
                />
              </div>
            </div>

            {error && <div class="error-message mt-3" role="alert">{error}</div>}

            {success && (
              <div class="text-center text-success font-semibold mt-3" role="status" aria-live="polite">
                <CheckIcon /> Stock updated
              </div>
            )}
          </>
        )}
      </div>

      {selectedProduct && (
        <div class="sticky-action">
          <div class="sticky-action-inner">
            <button
              class="btn btn-primary btn-lg"
              onClick={handleSave}
              disabled={success}
              type="button"
            >
              Save adjustment
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// View Sale Screen
// ============================================================================

interface ViewSaleScreenProps {
  state: InventoryState;
  lastCompletedSaleId: number;
  onNavigate: (route: Route) => void;
}

function ViewSaleScreen({ state, lastCompletedSaleId, onNavigate }: ViewSaleScreenProps) {
  const sale = state.sales.find((s) => s.id === lastCompletedSaleId);

  if (!sale) {
    return (
      <div class="screen">
        <div class="main">
          <div class="result-screen">
            <h2 class="result-title">Sale not found</h2>
            <button class="btn btn-primary" onClick={() => onNavigate('home')} type="button">
              Go home
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div class="screen">
      <div class="main no-sticky-action">
        <button class="btn btn-ghost btn-sm mb-4" onClick={() => onNavigate('home')} type="button">
          <ChevronLeftIcon /> Back
        </button>

        <h1 class="text-2xl font-semibold mb-2">Sale #{sale.saleNumber}</h1>
        <p class="text-sm text-ink-light mb-4">
          {new Date(sale.soldAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
        </p>

        {sale.lines.map((line) => (
          <div key={`${line.productId}-${line.quantity}`} class="card">
            <div class="flex justify-between">
              <div>
                <div class="font-semibold">{line.productName}</div>
                <div class="text-sm text-ink-light">Qty: {line.quantity}</div>
              </div>
              <div class="font-semibold">{formatInr(line.lineTotalPaise)}</div>
            </div>
          </div>
        ))}

        <div class="card mt-4">
          <div class="flex justify-between mb-2">
            <span>Total</span>
            <span class="font-semibold">{formatInr(sale.totalPaise)}</span>
          </div>
          <div class="text-sm text-ink-light">
            Paid by {PAYMENT_METHOD_LABELS[sale.paymentMethod]}
          </div>
        </div>

        {sale.status === 'completed' && (
          <button
            class="btn btn-danger btn-lg mt-6"
            onClick={() => onNavigate('cancel-sale-confirm')}
            type="button"
          >
            Cancel this sale
          </button>
        )}

        {sale.status === 'cancelled' && (
          <div class="text-center text-ink-light mt-4">
            <p>This sale was cancelled.</p>
            {sale.cancellationReason && <p>Reason: {sale.cancellationReason}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Cancel Sale Confirm Screen
// ============================================================================

interface CancelSaleConfirmScreenProps {
  state: InventoryState;
  lastCompletedSaleId: number;
  onStateChange: (state: InventoryState) => void;
  onNavigate: (route: Route) => void;
}

function CancelSaleConfirmScreen({
  state,
  lastCompletedSaleId,
  onStateChange,
  onNavigate,
}: CancelSaleConfirmScreenProps) {
  const [reason, setReason] = useState('Incorrect entry');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const sale = state.sales.find((s) => s.id === lastCompletedSaleId);

  if (!sale) {
    return (
      <div class="screen">
        <div class="main">
          <div class="result-screen">
            <h2 class="result-title">Sale not found</h2>
            <button class="btn btn-primary" onClick={() => onNavigate('home')} type="button">
              Go home
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleCancel = async () => {
    setError(null);
    const result = cancelSale(state, sale.id, reason);

    if (result.ok) {
      onStateChange(result.value);
      setSuccess(true);
      setTimeout(() => onNavigate('home'), 1500);
    } else {
      setError(result.error);
    }
  };

  return (
    <div class="screen">
      <div class="main no-sticky-action">
        <h1 class="text-2xl font-semibold mb-4">Cancel sale #{sale.saleNumber}?</h1>

        <div class="card mb-4">
          <p class="mb-3">This will put {sale.lines.reduce((sum, l) => sum + l.quantity, 0)} {sale.lines.reduce((sum, l) => sum + l.quantity, 0) === 1 ? 'item' : 'items'} back into stock:</p>
          <ul class="mb-3">
            {sale.lines.map((line) => (
              <li key={`${line.productId}-${line.quantity}`} class="mb-1">
                {line.productName}: +{line.quantity}
              </li>
            ))}
          </ul>
        </div>

        <div class="form-group">
          <label class="form-label" for="cancel-reason">Reason for cancellation</label>
          <select
            id="cancel-reason"
            class="form-input"
            value={reason}
            onInput={(e) => setReason((e.target as HTMLSelectElement).value)}
          >
            <option>Incorrect entry</option>
            <option>Customer cancelled</option>
            <option>Other</option>
          </select>
        </div>

        {error && <div class="error-message mt-3" role="alert">{error}</div>}

        {success && (
          <div class="text-center text-success font-semibold mt-3">
            <CheckIcon /> Sale cancelled
          </div>
        )}

        <div class="flex gap-3 mt-6">
          <button class="btn btn-secondary flex-1" onClick={() => onNavigate('view-sale')} type="button">
            Go back
          </button>
          <button class="btn btn-danger flex-1" onClick={handleCancel} disabled={success} type="button">
            Cancel sale
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Products Placeholder Screen
// ============================================================================

function ProductsPlaceholderScreen() {
  return (
    <div class="screen">
      <div class="main no-sticky-action">
        <div class="result-screen">
          <h1 class="result-title">Products</h1>
          <p class="result-message">
            Product management will be available after the pilot phase.
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// More Placeholder Screen
// ============================================================================

function MorePlaceholderScreen() {
  return (
    <div class="screen">
      <div class="main no-sticky-action">
        <div class="result-screen">
          <h1 class="result-title">More</h1>
          <p class="result-message">
            Additional settings and tools will be available after the pilot phase.
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main App Component
// ============================================================================

export function App() {
  const [state, setState] = useState<InventoryState>(createInitialState);
  const [route, setRoute] = useState<Route>('home');
  const [lastCompletedSaleId, setLastCompletedSaleId] = useState<number>(0);
  const [activeSaleIdempotencyKey, setActiveSaleIdempotencyKey] = useState<string>(() => crypto.randomUUID());

  const handleNavigate = useCallback((newRoute: Route) => {
    setRoute(newRoute);
    window.scrollTo(0, 0);
  }, []);

  const handleReset = useCallback(() => {
    setState(createInitialState());
    setLastCompletedSaleId(0);
    setRoute('home');
    setActiveSaleIdempotencyKey(crypto.randomUUID());
  }, []);

  const handleSaleDraftChange = useCallback((draft: InventoryState['saleDraft']) => {
    setState((prev) => ({ ...prev, saleDraft: draft }));

    // When a draft becomes empty after having items, create a fresh idempotency key
    // for the next sale attempt. This keeps one key per completed sale flow.
    if (draft.lines.length === 0) {
      setActiveSaleIdempotencyKey(crypto.randomUUID());
    }
  }, []);

  const handleRestockDraftChange = useCallback((draft: InventoryState['restockDraft']) => {
    setState((prev) => ({ ...prev, restockDraft: draft }));
  }, []);

  // Render current screen
  const renderScreen = () => {
    switch (route) {
      case 'home':
        return <HomeScreen state={state} onNavigate={handleNavigate} onReset={handleReset} />;
      case 'sell':
        return <SellScreen state={state} onSaleDraftChange={handleSaleDraftChange} onNavigate={handleNavigate} />;
      case 'review-sale':
        return (
          <ReviewSaleScreen
            state={state}
            saleIdempotencyKey={activeSaleIdempotencyKey}
            onSaleDraftChange={handleSaleDraftChange}
            onStateChange={setState}
            onNavigate={handleNavigate}
            setLastCompletedSaleId={setLastCompletedSaleId}
          />
        );
      case 'sale-completed':
        return <SaleCompletedScreen state={state} lastCompletedSaleId={lastCompletedSaleId} onNavigate={handleNavigate} />;
      case 'stock':
        return <StockChooserScreen onNavigate={handleNavigate} />;
      case 'stock-arrived':
        return <StockArrivedScreen state={state} onRestockDraftChange={handleRestockDraftChange} onStateChange={setState} />;
      case 'count-stock':
        return <CountStockScreen state={state} onStateChange={setState} />;
      case 'fix-stock':
        return <FixStockScreen state={state} onStateChange={setState} />;
      case 'view-sale':
        return <ViewSaleScreen state={state} lastCompletedSaleId={lastCompletedSaleId} onNavigate={handleNavigate} />;
      case 'cancel-sale-confirm':
        return <CancelSaleConfirmScreen state={state} lastCompletedSaleId={lastCompletedSaleId} onStateChange={setState} onNavigate={handleNavigate} />;
      case 'products':
        return <ProductsPlaceholderScreen />;
      case 'more':
        return <MorePlaceholderScreen />;
      default:
        return <HomeScreen state={state} onNavigate={handleNavigate} onReset={handleReset} />;
    }
  };

  // Determine if we should show the nav (hide on some screens)
  const showNav = !['sale-completed', 'view-sale', 'cancel-sale-confirm'].includes(route);

  return (
    <div class="app">
      {renderScreen()}
      {showNav && <Nav currentRoute={route} onNavigate={handleNavigate} />}
    </div>
  );
}

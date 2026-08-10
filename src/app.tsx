// Main application shell with navigation and routing.
// Part 1: Imports, types, and app shell.

import { useState, useCallback, useMemo, useEffect } from 'preact/hooks';
import type { JSX } from 'preact';
import { apiGetJson, apiPostJson } from './api';
import type { CreateSaleRequest, DashboardDTO, RecordPaymentRequest, SaleDTO, SaleSummaryDTO } from '../shared/contracts';
import {
  InventoryState,
  ProductId,
  Product,
  formatInr,
  getLowStockProducts,
  getOutOfStockProducts,
  getTodaysSalesTotal,
  getSaleLineQuantity,
  setSaleLineQuantity,
  setSaleLineUnitPrice,
  setSaleLineSetStock,
  setSaleDiscount,
  setSalePaymentMethod,
  getRestockLineQuantity,
  setRestockLineQuantity,
  calculateSaleSubtotal,
  searchProducts,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  ADJUSTMENT_REASONS,
  ADJUSTMENT_REASON_LABELS,
  SUBTRACTIVE_REASONS,
  type AdjustmentReason,
  type PaymentMethod,
} from './domain';
import {
  useStockDelivery,
  useStockCount,
  useStockAdjustment,
} from './hooks/useStock';
import { createEmptyInventoryState } from './state';
import {
  HomeIcon,
  SellIcon,
  StockIcon,
  ProductsIcon,
  SearchIcon,
  CheckIcon,
  AlertIcon,
  PackageIcon,
  ClipboardIcon,
  WrenchIcon,
  PlusIcon,
  MinusIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
  LogoutIcon,
  AppLogo,
} from './icons';
import './styles.css';
import { LoginScreen } from './screens/login';
import { ProductList } from './components/ProductList';
import { LidLookup } from './components/LidLookup';

// Route type
type Route =
  | 'home'
  | 'sell'
  | 'sales'
  | 'stock'
  | 'stock-arrived'
  | 'count-stock'
  | 'fix-stock'
  | 'review-sale'
  | 'sale-completed'
  | 'view-sale'
  | 'cancel-sale-confirm'
  | 'products'
  | 'lids';

// ============================================================================
// Navigation Component
// ============================================================================

interface NavProps {
  currentRoute: Route;
  onNavigate: (route: Route) => void;
  onLogout: () => Promise<void>;
  isLoggingOut: boolean;
}

function Nav({ currentRoute, onNavigate, onLogout, isLoggingOut }: NavProps) {
  const navItems: { route: Route; label: string; Icon: () => JSX.Element }[] = [
    { route: 'home', label: 'Dashboard', Icon: HomeIcon },
    { route: 'sales', label: 'Sales', Icon: SellIcon },
    { route: 'products', label: 'Products', Icon: ProductsIcon },
    { route: 'lids', label: 'LIDS', Icon: SearchIcon },
    { route: 'stock', label: 'Stock', Icon: StockIcon },
  ];
  const activeRoute: Route = ['sell', 'review-sale', 'sale-completed', 'view-sale', 'cancel-sale-confirm'].includes(currentRoute)
    ? 'sales'
    : ['stock-arrived', 'count-stock', 'fix-stock'].includes(currentRoute)
      ? 'stock'
      : currentRoute;

  return (
    <nav class="nav" role="navigation" aria-label="Main navigation">
      <div class="nav-brand" aria-label="Home Inventory">
        <AppLogo />
        <span>Home Inventory</span>
      </div>
      <div class="nav-inner">
        {navItems.map(({ route, label, Icon }) => (
          <button
            key={route}
            class={`nav-item ${activeRoute === route ? 'active' : ''}`}
            onClick={() => onNavigate(route)}
            aria-current={activeRoute === route ? 'page' : undefined}
            type="button"
          >
            <span class="nav-icon" aria-hidden="true">
              <Icon />
            </span>
            <span>{label}</span>
          </button>
        ))}
      </div>
      <button class="nav-item nav-logout" onClick={() => void onLogout()} disabled={isLoggingOut} type="button">
        <span class="nav-icon" aria-hidden="true"><LogoutIcon /></span>
        <span>{isLoggingOut ? 'Signing out…' : 'Logout'}</span>
      </button>
    </nav>
  );
}

// ============================================================================
// Home Screen
// ============================================================================

interface HomeScreenProps {
  state: InventoryState;
  onNavigate: (route: Route) => void;
}

function HomeScreen({ state, onNavigate }: HomeScreenProps) {
  const lowStock = getLowStockProducts(state);
  const outOfStock = getOutOfStockProducts(state);
  const localToday = useMemo(() => {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  }, []);
  const fallbackTodaySales = getTodaysSalesTotal(state);
  const [todaySales, setTodaySales] = useState(fallbackTodaySales);

  useEffect(() => {
    apiGetJson<DashboardDTO>(`/dashboard?date=${localToday}`)
      .then((dashboard) => setTodaySales(dashboard.today))
      .catch(() => setTodaySales(fallbackTodaySales));
  }, [localToday, fallbackTodaySales.count, fallbackTodaySales.totalPaise]);

  const last7Days = useMemo(() => {
    const result: { dateStr: string; dayLabel: string; isToday: boolean; totalPaise: number }[] = [];
    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const now = new Date();

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86_400_000);
      const dateStr = new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
      const dayLabel = daysOfWeek[d.getDay()] || '';
      result.push({ dateStr, dayLabel, isToday: i === 0, totalPaise: 0 });
    }

    for (const sale of state.sales) {
      if (sale.soldAt) {
        const saleDateStr = sale.soldAt.slice(0, 10);
        const match = result.find((r) => r.dateStr === saleDateStr);
        if (match) {
          match.totalPaise += sale.totalPaise;
        }
      }
    }

    return result;
  }, [state.sales]);

  const maxSalesPaise = useMemo(() => {
    return Math.max(1, ...last7Days.map((d) => d.totalPaise));
  }, [last7Days]);

  const topCategories = useMemo(() => {
    const catMap = new Map<string, number>();
    for (const product of state.products.values()) {
      if (product.active && product.category && product.category.trim().length > 0) {
        const cat = product.category.trim();
        const current = catMap.get(cat) || 0;
        catMap.set(cat, current + product.quantity);
      }
    }
    const sorted = Array.from(catMap.entries())
      .map(([name, qty]) => ({ name, qty }))
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 4);

    const maxQty = Math.max(1, ...sorted.map((c) => c.qty));
    return { categories: sorted, maxQty };
  }, [state.products]);

  const attentionProducts = [...outOfStock, ...lowStock.slice(0, 3)];

  return (
    <div class="screen">
      <div class="main no-sticky-action">
        <div class="page-header">
          <h1 class="text-2xl font-semibold">Dashboard</h1>
          <div class="header-actions">
            <button class="btn btn-primary btn-sm" onClick={() => onNavigate('sell')} type="button">Record sale</button>
          </div>
        </div>

        {/* Top 4 KPI Metric Cards Grid */}
        <div class="home-metric-grid mb-4">
          <div class="card flex items-center justify-between">
            <div>
              <div class="summary-value">{todaySales.totalPaise > 0 ? formatInr(todaySales.totalPaise) : '₹0'}</div>
              <div class="summary-label">Today's revenue</div>
            </div>
            <div class="summary-icon-badge">
              <SellIcon />
            </div>
          </div>

          <div class="card flex items-center justify-between">
            <div>
              <div class="summary-value">{todaySales.count}</div>
              <div class="summary-label">{todaySales.count === 1 ? 'Sale today' : 'Sales today'}</div>
            </div>
            <div class="summary-icon-badge green">
              <CheckIcon />
            </div>
          </div>

          <button
            class={`card card-clickable flex items-center justify-between ${lowStock.length > 0 ? 'alert-warning' : 'alert-clear'}`}
            onClick={() => onNavigate('products')}
            type="button"
          >
            <div>
              <div class="summary-value">{lowStock.length}</div>
              <div class="summary-label">Low stock items</div>
            </div>
            <div class={`summary-icon-badge ${lowStock.length > 0 ? 'amber' : 'green'}`}>
              {lowStock.length > 0 ? <AlertIcon /> : <CheckIcon />}
            </div>
          </button>

          <button
            class={`card card-clickable flex items-center justify-between ${outOfStock.length > 0 ? 'alert-danger' : 'alert-clear'}`}
            onClick={() => onNavigate('products')}
            type="button"
          >
            <div>
              <div class="summary-value">{outOfStock.length}</div>
              <div class="summary-label">Out of stock</div>
            </div>
            <div class={`summary-icon-badge ${outOfStock.length > 0 ? 'red' : 'green'}`}>
              {outOfStock.length > 0 ? <AlertIcon /> : <CheckIcon />}
            </div>
          </button>
        </div>

        {/* Middle Row: Top Categories Breakdown & Past 7 Days Sales */}
        <div class="home-summary-row mb-4">
          {/* Top Categories */}
          <section>
            <h2 class="text-lg font-semibold mb-3">Top categories</h2>
            <div class="card">
              {topCategories.categories.length === 0 ? (
                <div class="text-sm text-ink-light py-4 text-center">No categories recorded yet</div>
              ) : (
                <div class="flex flex-col gap-3">
                  {topCategories.categories.map((cat) => {
                    const widthPercent = Math.max(12, Math.round((cat.qty / topCategories.maxQty) * 100));
                    return (
                      <div key={cat.name} class="category-row">
                        <div class="flex items-center justify-between text-sm mb-1">
                          <span class="font-semibold">{cat.name}</span>
                          <span class="text-ink-light font-mono text-xs">{cat.qty} in stock</span>
                        </div>
                        <div class="w-full bg-line rounded-sm overflow-hidden" style={{ height: '8px' }}>
                          <div class="bg-blue h-full rounded-sm transition-all" style={{ width: `${widthPercent}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {/* Past 7 Days Chart */}
          <section>
            <h2 class="text-lg font-semibold mb-3">Past 7 days</h2>
            <div class="card">
              <div class="text-xs font-semibold text-ink-light mb-3">Daily sales trend (₹)</div>
              <div class="flex items-end justify-between gap-2" style={{ height: '110px' }}>
                {last7Days.map((d) => {
                  const heightPercent = d.totalPaise > 0 ? Math.max(16, Math.round((d.totalPaise / maxSalesPaise) * 100)) : 8;
                  return (
                    <div key={d.dateStr} class="flex-1 flex flex-col items-center gap-1 group relative chart-bar-col">
                      {d.totalPaise > 0 && (
                        <div class="chart-tooltip">
                          {formatInr(d.totalPaise)}
                        </div>
                      )}
                      <div
                        class={`chart-bar w-full rounded-sm ${d.isToday ? 'bg-blue' : d.totalPaise > 0 ? 'bg-ink-light' : 'bg-line'}`}
                        style={{ height: `${heightPercent}%`, opacity: d.isToday ? 1 : d.totalPaise > 0 ? 0.7 : 0.4 }}
                      />
                      <span class={`text-xs ${d.isToday ? 'font-bold text-blue' : 'text-ink-light'}`}>{d.dayLabel}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        </div>

        {/* Needs attention */}
        <section class="mb-4">
          <h2 class="text-lg font-semibold mb-3">Needs attention</h2>
          {attentionProducts.length > 0 ? (
            <div class="flex flex-col gap-2">
              {attentionProducts.map((product) => (
                <button
                  key={product.id}
                  class="card card-clickable flex items-center justify-between"
                  onClick={() => onNavigate('products')}
                  type="button"
                >
                  <div>
                    <div class="font-semibold text-left">{product.name}</div>
                    <div class="text-sm text-ink-light text-left mt-1">
                      {product.quantity === 0 ? '0 in stock' : `${product.quantity} left`}
                    </div>
                  </div>
                  <div class="flex items-center gap-2">
                    {product.quantity === 0 ? (
                      <span class="status-chip status-chip-out-of-stock">Out of stock</span>
                    ) : (
                      <span class="status-chip status-chip-low-stock">Low stock</span>
                    )}
                    <ChevronRightIcon />
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div class="card flex items-center gap-3" style={{ background: 'var(--green-soft)', borderColor: 'rgba(20,122,82,0.25)' }}>
              <span style={{ color: 'var(--green)' }}><CheckIcon /></span>
              <span class="text-sm font-semibold text-success">Stock levels are all good!</span>
            </div>
          )}
        </section>
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
  const isSaleQuantity = maxQuantity !== undefined;
  const isAtMax = maxQuantity !== undefined && quantityInDraft >= maxQuantity;

  const handleDecrease = () => {
    if (quantityInDraft > 0) {
      onQuantityChange(quantityInDraft - 1);
    }
  };

  const handleIncrease = () => {
    if ((!isSaleQuantity || !isOutOfStock) && !isAtMax) {
      onQuantityChange(quantityInDraft + 1);
    }
  };

  return (
    <div class="card product-card">
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
          disabled={(isSaleQuantity && isOutOfStock) || isAtMax}
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
// Sales History Screen
// ============================================================================

type SalesStatusFilter = 'all' | 'unpaid' | 'partial' | 'paid' | 'cancelled';

interface SalesHistoryScreenProps {
  state: InventoryState;
  onStateChange: (state: InventoryState) => void;
  onNavigate: (route: Route) => void;
  setLastCompletedSaleId: (id: number) => void;
}

function SalesHistoryScreen({ state, onStateChange, onNavigate, setLastCompletedSaleId }: SalesHistoryScreenProps) {
  const [sales, setSales] = useState<readonly SaleSummaryDTO[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<SalesStatusFilter>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSales = useCallback(async (search = '') => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await apiGetJson<{ items: SaleSummaryDTO[] }>(`/sales?limit=500&q=${encodeURIComponent(search)}`);
      setSales(response.items);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Sales could not be loaded');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void loadSales(); }, [loadSales]);

  const visibleSales = sales.filter((sale) => statusFilter === 'all'
    || (statusFilter === 'cancelled' ? sale.status === 'cancelled' : sale.status === 'completed' && sale.paymentStatus === statusFilter));

  const openSale = async (id: number) => {
    setError(null);
    try {
      const sale = await apiGetJson<SaleDTO>(`/sales/${id}`);
      const record = { ...sale, paymentMethod: sale.paymentMethod as PaymentMethod };
      onStateChange({ ...state, sales: [...state.sales.filter((item) => item.id !== id), record] });
      setLastCompletedSaleId(id);
      onNavigate('view-sale');
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : 'Sale could not be opened');
    }
  };

  const statusLabel = (sale: SaleSummaryDTO) => sale.status === 'cancelled'
    ? 'Cancelled'
    : sale.paymentStatus === 'partial' ? 'Partially paid'
      : sale.paymentStatus === 'unpaid' ? 'Unpaid' : 'Paid';

  return (
    <div class="screen">
      <div class="main no-sticky-action">
        <div class="page-header">
          <h1 class="text-2xl font-semibold">Sales</h1>
          <div class="header-actions">
            <button class="btn btn-primary btn-sm" type="button" onClick={() => onNavigate('sell')}>Record sale</button>
          </div>
        </div>

        <form class="sales-search-form" onSubmit={(event) => { event.preventDefault(); void loadSales(query); }}>
          <div class="search-input">
            <SearchIcon />
            <input type="search" class="form-input" value={query}
              placeholder="Search customer or sale number..." aria-label="Search sales"
              onInput={(event) => setQuery((event.target as HTMLInputElement).value)} />
          </div>
          <div class="sales-search-actions">
            <button class="btn btn-navy" type="submit">Search</button>
            <button class="btn btn-secondary" type="button" onClick={() => { setQuery(''); void loadSales(); }}>Reset</button>
          </div>
        </form>

        <div class="sales-filter-pills mt-3" role="group" aria-label="Filter by status">
          {(
            [
              { value: 'all', label: 'All sales' },
              { value: 'paid', label: 'Paid' },
              { value: 'unpaid', label: 'Unpaid' },
              { value: 'partial', label: 'Partial' },
              { value: 'cancelled', label: 'Cancelled' },
            ] as const
          ).map((item) => (
            <button
              key={item.value}
              type="button"
              class={`filter-pill ${statusFilter === item.value ? 'selected' : ''}`}
              aria-pressed={statusFilter === item.value}
              onClick={() => setStatusFilter(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {error && <div class="error-message mt-4" role="alert">{error}</div>}
        {isLoading ? <p class="text-ink-light mt-4">Loading sales…</p> : visibleSales.length === 0 ? (
          <div class="empty-state"><h2 class="empty-state-title">No sales found</h2><p class="empty-state-message">Try another search or filter.</p></div>
        ) : (
          <div class="mt-4">
            {visibleSales.map((sale) => (
              <button key={sale.id} class="card card-clickable w-full text-left" type="button" onClick={() => void openSale(sale.id)}>
                <div class="flex justify-between items-start gap-3">
                  <div>
                    <div class="font-semibold">{sale.customerName || 'Walk-in customer'}</div>
                    <div class="text-sm text-ink-light">{sale.saleNumber} · {new Date(`${sale.saleDate}T00:00:00`).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</div>
                    <div class="text-sm mt-2">{statusLabel(sale)}{sale.balancePaise > 0 && sale.status !== 'cancelled' ? ` · ${formatInr(sale.balancePaise)} due` : ''}</div>
                  </div>
                  <div class="font-semibold">{formatInr(sale.totalPaise)}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
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
  const [customerName, setCustomerName] = useState('');
  const [receivedPaise, setReceivedPaise] = useState<number | null>(null);
  const [saleDate, setSaleDate] = useState(() => {
    const now = new Date();
    const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
    return localDate.toISOString().slice(0, 10);
  });

  const { saleDraft, products } = state;

  // Calculate subtotal
  const subtotalResult = calculateSaleSubtotal(saleDraft, products);
  const subtotalPaise = subtotalResult.ok ? subtotalResult.value : 0;
  const totalPaise = Math.max(0, subtotalPaise - saleDraft.discountPaise);
  const effectiveReceivedPaise = receivedPaise ?? totalPaise;

  // Get line items with product details
  const lineItems = saleDraft.lines
    .map((line) => {
      const product = products.get(line.productId);
      if (!product) return null;
      return {
        product,
        quantity: line.quantity,
        unitPricePaise: line.unitPricePaise ?? product.pricePaise,
        setStockAfter: line.setStockAfter ?? product.setStockQuantity ?? 0,
        lineTotal: (line.unitPricePaise ?? product.pricePaise) * line.quantity,
      };
    })
    .filter((item): item is { product: Product; quantity: number; unitPricePaise: number; setStockAfter: number; lineTotal: number } => item !== null);

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

    try {
      const request: CreateSaleRequest = {
        idempotencyKey: saleIdempotencyKey,
        saleDate,
        customerName: customerName.trim() || null,
        lines: lineItems.map(({ product, quantity, unitPricePaise, setStockAfter }) => ({
          productId: product.id, quantity, unitPricePaise, setStockAfter,
        })),
        discountPaise: saleDraft.discountPaise,
        paymentMethod: saleDraft.paymentMethod,
        receivedPaise: effectiveReceivedPaise,
      };
      const sale = await apiPostJson<SaleDTO>('/sales', request);
      const productsResponse = await apiGetJson<{ items: Product[] }>('/products?active=all&limit=1000');
      const record = { ...sale, paymentMethod: sale.paymentMethod as PaymentMethod };
      setLastCompletedSaleId(sale.id);
      onStateChange({
        ...state,
        products: new Map(productsResponse.items.map((product) => [product.id, product])),
        sales: [...state.sales.filter((item) => item.id !== sale.id), record],
        saleDraft: { lines: [], discountPaise: 0, paymentMethod: 'upi' },
      });
      onNavigate('sale-completed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sale could not be saved');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div class="screen">
      <div class="main">
        <h1 class="text-2xl font-semibold mb-4">Review sale</h1>

        <div class="card">
          <div class="form-group">
            <label class="form-label" for="customer-name">Customer name (optional)</label>
            <input
              id="customer-name"
              type="text"
              class="form-input"
              value={customerName}
              maxLength={200}
              placeholder="Enter customer name"
              onInput={(event) => setCustomerName((event.target as HTMLInputElement).value)}
            />
          </div>
          <div class="form-group">
            <label class="form-label" for="sale-date">Sale date</label>
            <input
              id="sale-date"
              type="date"
              class="form-input"
              value={saleDate}
              onInput={(event) => setSaleDate((event.target as HTMLInputElement).value)}
              required
            />
          </div>
        </div>

        {/* Line items */}
        {lineItems.map(({ product, quantity, unitPricePaise, setStockAfter, lineTotal }) => (
          <div key={product.id} class="card">
            <div class="flex justify-between items-start">
              <div>
                <div class="font-semibold">{product.name}</div>
                <div class="text-sm text-ink-light">Qty: {quantity}</div>
              </div>
              <div class="font-semibold">{formatInr(lineTotal)}</div>
            </div>
            <div class="form-group mt-3">
              <label class="form-label" for={`price-${product.id}`}>Price to multiply by QTY (₹)</label>
              <input id={`price-${product.id}`} type="number" class="form-input"
                min={0} step="0.01" inputMode="decimal" value={unitPricePaise / 100}
                onInput={(event) => onSaleDraftChange(setSaleLineUnitPrice(saleDraft, product.id,
                  Math.max(0, Math.round((parseFloat((event.target as HTMLInputElement).value) || 0) * 100))))} />
              <div class="text-sm text-ink-light mt-2">Catalogue SRP is per Stock/set. Change this price when selling individual pieces.</div>
            </div>
            <div class="form-group">
              <label class="form-label" for={`set-stock-${product.id}`}>Stock/set count after sale</label>
              <input id={`set-stock-${product.id}`} type="number" class="form-input"
                min={0} step="0.01" inputMode="decimal" value={setStockAfter}
                onInput={(event) => onSaleDraftChange(setSaleLineSetStock(saleDraft, product.id,
                  Math.max(0, parseFloat((event.target as HTMLInputElement).value) || 0)))} />
              <div class="text-sm text-ink-light mt-2">Before sale: {product.setStockQuantity ?? 0}</div>
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
          <div class="form-group">
            <label class="form-label" for="amount-received">Amount received now (₹)</label>
            <input
              id="amount-received"
              type="number"
              class="form-input"
              min={0}
              max={totalPaise / 100}
              step="0.01"
              inputMode="decimal"
              value={effectiveReceivedPaise / 100}
              onInput={(event) => setReceivedPaise(Math.max(0, Math.round((parseFloat((event.target as HTMLInputElement).value) || 0) * 100)))}
            />
            <div class="text-sm text-ink-light mt-2">
              {effectiveReceivedPaise === 0
                ? 'Marked unpaid — payment can be added later.'
                : effectiveReceivedPaise < totalPaise
                  ? `${formatInr(totalPaise - effectiveReceivedPaise)} will remain due.`
                  : 'Fully paid.'}
            </div>
          </div>
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
            {sale.customerName ? `${sale.customerName} · ` : ''}{new Date(`${sale.saleDate}T00:00:00`).toLocaleDateString('en-IN', { dateStyle: 'medium' })}<br />
            {sale.paymentStatus === 'paid'
              ? `${formatInr(sale.paidPaise ?? sale.totalPaise)} received`
              : `${formatInr(sale.paidPaise ?? 0)} received · ${formatInr(sale.balancePaise ?? sale.totalPaise)} due`}<br />
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

function StockArrivedScreen({ state, onRestockDraftChange }: StockArrivedScreenProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { execute: saveStock } = useStockDelivery();

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
    setSuccessMessage(null);
    setIsSubmitting(true);
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Prepare stock delivery items
    const items = activeLines
      .filter((l) => l.quantityReceived > 0)
      .map((l) => ({
        productId: l.productId,
        quantity: l.quantityReceived,
      }));

    const result = await saveStock({ items });

    setIsSubmitting(false);

    if (result && result.ok) {
      // Clear the draft and show inline success feedback
      setSuccessMessage(`Saved ${result.entries.length} items successfully`);
      onRestockDraftChange([]);
    } else {
      // Error is already handled by the hook
      setError('Failed to save stock delivery');
    }
  };

  return (
    <div class="screen">
      <div class="main">
        <h1 class="text-2xl font-semibold mb-4">Stock arrived</h1>

        {successMessage && (
          <div class="status-chip status-chip-success mb-4 text-sm font-semibold" style={{ width: '100%', padding: '10px 14px', borderRadius: '10px', justifyContent: 'center' }} role="status">
            {successMessage}
          </div>
        )}

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
            <div class="empty-state-icon"><SearchIcon /></div>
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

    const { execute: saveStockCount } = useStockCount();

    const result = await saveStockCount({
      productId: selectedProductId,
      countedQuantity: quantity,
    });

    if (result && result.ok) {
      // Update the local product with the new quantity
      const newProduct: Product = {
        ...state.products.get(selectedProductId)!,
        quantity: result.newQuantity,
      };
      const newProducts = new Map(state.products);
      newProducts.set(selectedProductId, newProduct);

      // Update state with new products map - this is called from parent
      onStateChange({ ...state, products: newProducts });
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setSelectedProductId(null);
        setCountedQuantity('');
      }, 1500);
    } else {
      // Error is already set by the hook
      setError('Failed to save stock count');
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

    const { execute: saveStockAdjustment } = useStockAdjustment();

    const result = await saveStockAdjustment({
      productId: selectedProductId,
      reason,
      quantity: qty,
      note,
    });

    if (result && result.ok) {
      // Update the local product with the new quantity
      const newProduct: Product = {
        ...state.products.get(selectedProductId)!,
        quantity: result.newQuantity,
      };
      const newProducts = new Map(state.products);
      newProducts.set(selectedProductId, newProduct);

      // Update state with new products map
      onStateChange({ ...state, products: newProducts });
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setSelectedProductId(null);
        setQuantity('1');
        setNote('');
      }, 1500);
    } else {
      // Error is already set by the hook
      setError('Failed to save stock adjustment');
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
  onStateChange: (state: InventoryState) => void;
  onNavigate: (route: Route) => void;
}

function ViewSaleScreen({ state, lastCompletedSaleId, onStateChange, onNavigate }: ViewSaleScreenProps) {
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('upi');
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isSavingPayment, setIsSavingPayment] = useState(false);
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

  const balancePaise = sale.balancePaise ?? 0;
  const handleAddPayment = async () => {
    const amountPaise = Math.round((parseFloat(paymentAmount) || 0) * 100);
    setPaymentError(null);
    if (amountPaise <= 0 || amountPaise > balancePaise) {
      setPaymentError(`Enter an amount between ₹0.01 and ${formatInr(balancePaise)}.`);
      return;
    }
    setIsSavingPayment(true);
    try {
      const request: RecordPaymentRequest = { amountPaise, paymentMethod };
      const updated = await apiPostJson<SaleDTO>(`/sales/${sale.id}/payments`, request);
      const record = {
        ...updated,
        paymentMethod: updated.paymentMethod as PaymentMethod,
        payments: updated.payments.map((payment) => ({ ...payment, paymentMethod: payment.paymentMethod as PaymentMethod })),
      };
      onStateChange({ ...state, sales: state.sales.map((item) => item.id === sale.id ? record : item) });
      setPaymentAmount('');
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : 'Payment could not be saved');
    } finally {
      setIsSavingPayment(false);
    }
  };

  return (
    <div class="screen">
      <div class="main no-sticky-action">
        <button class="btn btn-ghost btn-sm mb-4" onClick={() => onNavigate('home')} type="button">
          <ChevronLeftIcon /> Back
        </button>

        <h1 class="text-2xl font-semibold mb-2">Sale #{sale.saleNumber}</h1>
        <p class="text-sm text-ink-light mb-4">
          {sale.customerName && <>{sale.customerName}<br /></>}
          Sale date: {new Date(`${sale.saleDate}T00:00:00`).toLocaleDateString('en-IN', { dateStyle: 'medium' })}<br />
          Recorded: {new Date(sale.soldAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
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
          <div class="flex justify-between mb-2">
            <span>Received</span>
            <span>{formatInr(sale.paidPaise ?? sale.totalPaise)}</span>
          </div>
          <div class="flex justify-between font-semibold">
            <span>Balance due</span>
            <span>{formatInr(balancePaise)}</span>
          </div>
        </div>

        {sale.status === 'completed' && balancePaise > 0 && (
          <div class="card mt-4">
            <h2 class="text-lg font-semibold mb-3">Add payment</h2>
            <div class="form-group">
              <label class="form-label" for="later-payment">Amount received (₹)</label>
              <input id="later-payment" type="number" class="form-input" min={0.01}
                max={balancePaise / 100} step="0.01" inputMode="decimal" value={paymentAmount}
                placeholder={(balancePaise / 100).toFixed(2)}
                onInput={(event) => setPaymentAmount((event.target as HTMLInputElement).value)} />
            </div>
            <div class="payment-methods" role="group" aria-label="Payment method">
              {PAYMENT_METHODS.map((method) => (
                <button key={method} type="button" class={`payment-pill ${paymentMethod === method ? 'selected' : ''}`}
                  aria-pressed={paymentMethod === method} onClick={() => setPaymentMethod(method)}>
                  {PAYMENT_METHOD_LABELS[method]}
                </button>
              ))}
            </div>
            {paymentError && <div class="error-message mt-3" role="alert">{paymentError}</div>}
            <button class="btn btn-primary btn-lg mt-4" type="button" disabled={isSavingPayment}
              onClick={() => void handleAddPayment()}>
              {isSavingPayment ? 'Saving…' : 'Save payment'}
            </button>
          </div>
        )}

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
    try {
      const cancelled = await apiPostJson<SaleDTO>(`/sales/${sale.id}/cancel`, { reason });
      const productsResponse = await apiGetJson<{ items: Product[] }>('/products?active=all&limit=1000');
      onStateChange({
        ...state,
        products: new Map(productsResponse.items.map((product) => [product.id, product])),
        sales: state.sales.map((item) => item.id === sale.id
          ? { ...cancelled, paymentMethod: cancelled.paymentMethod as PaymentMethod }
          : item),
      });
      setSuccess(true);
      setTimeout(() => onNavigate('home'), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sale could not be cancelled');
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
// Products Screen
// ============================================================================

interface ProductsScreenProps {
  onNavigate: (route: Route) => void;
}

function ProductsScreen({ onNavigate }: ProductsScreenProps) {
  return <ProductList onNavigate={onNavigate} />;
}

// ============================================================================
// Main App Component
// ============================================================================

export function App() {
  const [state, setState] = useState<InventoryState>(createEmptyInventoryState);
  const [route, setRoute] = useState<Route>('home');
  const [lastCompletedSaleId, setLastCompletedSaleId] = useState<number>(0);
  const [activeSaleIdempotencyKey, setActiveSaleIdempotencyKey] = useState<string>(() => crypto.randomUUID());
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Auth gate: check session on mount
  useEffect(() => {
    fetch('/api/me', { credentials: 'same-origin' })
      .then((r) => {
        setSignedIn(r.ok);
        if (!r.ok) {
          window.scrollTo(0, 0);
        }
      })
      .catch(() => setSignedIn(false));
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    apiGetJson<{ items: Product[] }>('/products?active=all&limit=1000')
      .then(({ items }) => setState((previous) => ({
        ...previous,
        products: new Map(items.map((product) => [product.id, product])),
      })))
      .catch(() => undefined);
  }, [signedIn]);

  // Listen for 401 events from api.ts
  useEffect(() => {
    const handler = () => setSignedIn(false);
    window.addEventListener('api:signed-out', handler);
    return () => window.removeEventListener('api:signed-out', handler);
  }, []);

  const handleNavigate = useCallback((newRoute: Route) => {
    setRoute(newRoute);
    window.scrollTo(0, 0);
  }, []);

  const handleLogout = useCallback(async () => {
    setIsLoggingOut(true);
    try {
      await apiPostJson<void>('/logout', {});
      setState(createEmptyInventoryState());
      setLastCompletedSaleId(0);
      setRoute('home');
      setSignedIn(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Could not log out. Please try again.');
    } finally {
      setIsLoggingOut(false);
    }
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
        return <HomeScreen state={state} onNavigate={handleNavigate} />;
      case 'sell':
        return <SellScreen state={state} onSaleDraftChange={handleSaleDraftChange} onNavigate={handleNavigate} />;
      case 'sales':
        return <SalesHistoryScreen state={state} onStateChange={setState} onNavigate={handleNavigate} setLastCompletedSaleId={setLastCompletedSaleId} />;
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
        return <ViewSaleScreen state={state} lastCompletedSaleId={lastCompletedSaleId} onStateChange={setState} onNavigate={handleNavigate} />;
      case 'cancel-sale-confirm':
        return <CancelSaleConfirmScreen state={state} lastCompletedSaleId={lastCompletedSaleId} onStateChange={setState} onNavigate={handleNavigate} />;
      case 'products':
        return <ProductsScreen onNavigate={handleNavigate} />;
      case 'lids':
        return <LidLookup />;
      default:
        return <HomeScreen state={state} onNavigate={handleNavigate} />;
    }
  };

  // Determine if we should show the nav (hide on some screens)
  const showNav = !['sale-completed', 'view-sale', 'cancel-sale-confirm'].includes(route);

  // Auth gate
  if (signedIn === null) {
    return (
      <div class="app">
        <div class="screen">
          <div class="main no-sticky-action">
            <div class="auth-loading">
              <p class="text-ink-light">Loading...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!signedIn) {
    return (
      <div class="app">
        <LoginScreen onLogin={() => setSignedIn(true)} />
      </div>
    );
  }

  return (
    <div class="app">
      <div class="top-header-bar">
        <div class="top-header-inner">
          <div class="top-header-brand" onClick={() => handleNavigate('home')} style={{ cursor: 'pointer' }}>
            <AppLogo />
            <span>Home Inventory</span>
          </div>
          <button
            class="btn btn-ghost btn-sm top-header-logout"
            onClick={() => void handleLogout()}
            disabled={isLoggingOut}
            type="button"
            aria-label="Logout"
          >
            <LogoutIcon />
            <span class="top-header-logout-text">{isLoggingOut ? 'Signing out…' : 'Logout'}</span>
          </button>
        </div>
      </div>
      {renderScreen()}
      {showNav && <Nav currentRoute={route} onNavigate={handleNavigate} onLogout={handleLogout} isLoggingOut={isLoggingOut} />}
    </div>
  );
}

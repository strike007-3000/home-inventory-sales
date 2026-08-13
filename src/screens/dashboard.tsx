import { useEffect, useMemo, useState } from 'preact/hooks';
import type { DashboardDTO } from '../../shared/contracts';
import { apiGetJson } from '../api';
import {
  formatInr,
  getInventoryValuationComparison,
  getLowStockProducts,
  getOutOfStockProducts,
  getTodaysSalesTotal,
  getTotalSalesSummary,
  type InventoryState,
} from '../domain';
import {
  AlertIcon,
  CheckIcon,
  ChevronRightIcon,
  ClipboardIcon,
  SellIcon,
  StockIcon,
} from '../icons';

type DashboardRoute = 'sell' | 'products';

interface DashboardScreenProps {
  state: InventoryState;
  onNavigate: (route: DashboardRoute, selectedProductId?: number) => void;
}

export function DashboardScreen({ state, onNavigate }: DashboardScreenProps) {
  const lowStock = useMemo(() => getLowStockProducts(state), [state]);
  const outOfStock = useMemo(() => getOutOfStockProducts(state), [state]);
  const fallbackTotalSales = useMemo(() => getTotalSalesSummary(state), [state.sales]);
  const valuationComparison = useMemo(() => getInventoryValuationComparison(state), [state.products]);
  const emptyValuation = { cpPaise: 0, srpPaise: 0, mrpPaise: 0 };
  const legacyValuation = valuationComparison.ok ? valuationComparison.value.legacySetBased : emptyValuation;
  const quantityValuation = valuationComparison.ok ? valuationComparison.value.quantityDerived : emptyValuation;

  const localToday = useMemo(() => {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  }, []);
  const fallbackTodaySales = getTodaysSalesTotal(state);
  const [todaySales, setTodaySales] = useState(fallbackTodaySales);
  const [totalSales, setTotalSales] = useState(fallbackTotalSales);

  const [refreshError, setRefreshError] = useState<string | null>(null);

  useEffect(() => {
    setTodaySales(fallbackTodaySales);
    setTotalSales(fallbackTotalSales);
  }, [fallbackTodaySales.count, fallbackTodaySales.totalPaise, fallbackTotalSales.count, fallbackTotalSales.totalPaise]);

  useEffect(() => {
    apiGetJson<DashboardDTO>(`/dashboard?date=${localToday}`)
      .then((dashboard) => {
        setTodaySales(dashboard.today);
        if (dashboard.total) {
          setTotalSales(dashboard.total);
        }
        setRefreshError(null);
      })
      .catch(() => {
        setTodaySales(fallbackTodaySales);
        setTotalSales(fallbackTotalSales);
        setRefreshError('Could not refresh — showing saved data.');
      });
  }, [localToday, fallbackTodaySales.count, fallbackTodaySales.totalPaise, fallbackTotalSales.count, fallbackTotalSales.totalPaise]);

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

        {refreshError && (
          <div class="dashboard-refresh-message mb-4" role="status">
            {refreshError}
          </div>
        )}

        <div class="home-metric-grid mb-4">
          <div class="card flex items-center justify-between">
            <div class="min-w-0 flex-1 mr-2">
              <div class="summary-value">{todaySales.totalPaise > 0 ? formatInr(todaySales.totalPaise) : '₹0'}</div>
              <div class="summary-label">Today's revenue ({todaySales.count})</div>
            </div>
            <div class="summary-icon-badge"><SellIcon /></div>
          </div>

          <div class="card flex items-center justify-between">
            <div class="min-w-0 flex-1 mr-2">
              <div class="summary-value">{totalSales.totalPaise > 0 ? formatInr(totalSales.totalPaise) : '₹0'}</div>
              <div class="summary-label">Total sale ({totalSales.count})</div>
            </div>
            <div class="summary-icon-badge green"><CheckIcon /></div>
          </div>

          <button
            class={`card card-clickable flex items-center justify-between ${outOfStock.length > 0 ? 'alert-danger' : 'alert-clear'}`}
            onClick={() => onNavigate('products')}
            type="button"
          >
            <div class="min-w-0 flex-1 mr-2">
              <div class="summary-value">{outOfStock.length}</div>
              <div class="summary-label">Out of stock</div>
            </div>
            <div class={`summary-icon-badge ${outOfStock.length > 0 ? 'red' : 'green'}`}>
              {outOfStock.length > 0 ? <AlertIcon /> : <CheckIcon />}
            </div>
          </button>

          <div class="card flex items-center justify-between">
            <div class="min-w-0 flex-1 mr-2">
              <div class="summary-value">{legacyValuation.cpPaise > 0 ? formatInr(legacyValuation.cpPaise) : '₹0'}</div>
              <div class="summary-label">Stock/set CP Value</div>
            </div>
            <div class="summary-icon-badge"><StockIcon /></div>
          </div>

          <div class="card flex items-center justify-between">
            <div class="min-w-0 flex-1 mr-2">
              <div class="summary-value">{legacyValuation.srpPaise > 0 ? formatInr(legacyValuation.srpPaise) : '₹0'}</div>
              <div class="summary-label">Stock/set SRP Value</div>
            </div>
            <div class="summary-icon-badge green"><SellIcon /></div>
          </div>

          <div class="card flex items-center justify-between">
            <div class="min-w-0 flex-1 mr-2">
              <div class="summary-value">{legacyValuation.mrpPaise > 0 ? formatInr(legacyValuation.mrpPaise) : '₹0'}</div>
              <div class="summary-label">Stock/set MRP Value</div>
            </div>
            <div class="summary-icon-badge purple"><ClipboardIcon /></div>
          </div>

          <div class="card flex items-center justify-between">
            <div class="min-w-0 flex-1 mr-2">
              <div class="summary-value">{quantityValuation.cpPaise > 0 ? formatInr(quantityValuation.cpPaise) : '₹0'}</div>
              <div class="summary-label">Individual QTY CP Value</div>
            </div>
            <div class="summary-icon-badge"><StockIcon /></div>
          </div>

          <div class="card flex items-center justify-between">
            <div class="min-w-0 flex-1 mr-2">
              <div class="summary-value">{quantityValuation.srpPaise > 0 ? formatInr(quantityValuation.srpPaise) : '₹0'}</div>
              <div class="summary-label">Individual QTY SRP Value</div>
            </div>
            <div class="summary-icon-badge green"><SellIcon /></div>
          </div>

          <div class="card flex items-center justify-between">
            <div class="min-w-0 flex-1 mr-2">
              <div class="summary-value">{quantityValuation.mrpPaise > 0 ? formatInr(quantityValuation.mrpPaise) : '₹0'}</div>
              <div class="summary-label">Individual QTY MRP Value</div>
            </div>
            <div class="summary-icon-badge"><ClipboardIcon /></div>
          </div>
        </div>

        {valuationComparison.ok && valuationComparison.value.unconfiguredCount > 0 && (
          <div class="dashboard-refresh-message mb-4" role="status">
            Individual QTY values exclude {valuationComparison.value.unconfiguredCount} product{valuationComparison.value.unconfiguredCount === 1 ? '' : 's'} until Pieces in one set is configured.
          </div>
        )}

        <section class="mb-4">
          <h2 class="text-lg font-semibold mb-3">Needs attention</h2>
          {attentionProducts.length > 0 ? (
            <div class="flex flex-col gap-2">
              {attentionProducts.map((product) => (
                <button
                  key={product.id}
                  class="card card-clickable flex items-center justify-between"
                  onClick={() => onNavigate('products', product.id)}
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

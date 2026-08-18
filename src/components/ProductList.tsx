import { useState, useEffect, useRef } from 'preact/hooks';
import { useProducts, useCreateProduct, useUpdateProduct, useToggleProduct, useLocations, type ProductFormData } from '../hooks/useProducts';
import { formatInr, getProductSetupIssue, needsUnitsPerSetConfiguration } from '../domain';
import { ProductForm } from './ProductForm';
import { useStockChange } from '../hooks/useStock';
import type { Product } from '../domain';
import type { StockChangeReason } from '../../shared/contracts';
import { ApiError } from '../api';
import {
  SearchIcon,
  PlusIcon,
  EditIcon,
  CheckIcon,
  XIcon,
} from '../icons';

const STOCK_REASONS: readonly { value: StockChangeReason; label: string }[] = [
  { value: 'delivery', label: 'Stock arrived' },
  { value: 'count', label: 'Stock count' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'lost', label: 'Lost' },
  { value: 'sample', label: 'Sample' },
  { value: 'personal-use', label: 'Personal use' },
  { value: 'incorrect-entry', label: 'Incorrect entry' },
  { value: 'other', label: 'Other' },
];

function formatDelta(value: number): string {
  const formatted = value !== 0 && Math.abs(value) < 1e-12
    ? value.toExponential(3)
    : new Intl.NumberFormat('en-IN', { maximumFractionDigits: 12 }).format(value);
  return value > 0 ? `+${formatted}` : formatted;
}

interface StockChangeFormProps {
  product: Product;
  onCancel: () => void;
  onSaved: () => Promise<void>;
  onConflict: () => Promise<void>;
}

function StockChangeForm({ product, onCancel, onSaved, onConflict }: StockChangeFormProps) {
  const [quantity, setQuantity] = useState(String(product.quantity));
  const [setStockQuantity, setSetStockQuantity] = useState(String(product.setStockQuantity ?? 0));
  const [reason, setReason] = useState<StockChangeReason | ''>('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const { execute, loading, error } = useStockChange();

  const nextQuantity = Number(quantity);
  const nextSetStock = Number(setStockQuantity);
  const quantityValid = Number.isSafeInteger(nextQuantity) && nextQuantity >= 0;
  const setStockValid = Number.isFinite(nextSetStock) && nextSetStock >= 0;
  const changed = quantityValid && setStockValid &&
    (nextQuantity !== product.quantity || nextSetStock !== (product.setStockQuantity ?? 0));
  const setupGuidance = quantityValid && setStockValid
    ? getProductSetupIssue({ ...product, quantity: nextQuantity, setStockQuantity: nextSetStock })
    : null;

  const handleSubmit = async (event: Event) => {
    event.preventDefault();
    setFormError(null);
    if (!quantityValid) return setFormError('Individual QTY must be a whole number of 0 or more.');
    if (!setStockValid) return setFormError('Stock/set must be 0 or more.');
    if (!reason) return setFormError('Choose why the stock is changing.');
    if (!changed) return setFormError('Change at least one stock value.');
    if (note.trim().length > 500) return setFormError('Note must be at most 500 characters.');

    const quantityDelta = nextQuantity - product.quantity;
    const setStockDelta = nextSetStock - (product.setStockQuantity ?? 0);
    if (reason === 'delivery' && (quantityDelta < 0 || setStockDelta < 0)) {
      return setFormError('Stock arrived cannot decrease either stock value. Use Stock count or Incorrect entry instead.');
    }
    if (['damaged', 'lost', 'sample', 'personal-use'].includes(reason) && (quantityDelta > 0 || setStockDelta > 0)) {
      return setFormError(`${STOCK_REASONS.find((item) => item.value === reason)?.label} cannot increase either stock value. Use Stock count or Incorrect entry instead.`);
    }

    try {
      const result = await execute({
        productId: product.id,
        expectedVersion: product.version,
        quantity: nextQuantity,
        setStockQuantity: nextSetStock,
        reason,
        note: note.trim() || null,
      });
      if (result) await onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) await onConflict();
    }
  };

  return (
    <form class="card stock-change-form" onSubmit={handleSubmit}>
      <div class="stock-change-heading">
        <div>
          <div class="text-sm text-ink-light">Change stock</div>
          <h2 class="card-title text-xl">{product.name}</h2>
          {(product.colour || product.size) && <div class="card-subtitle">{[product.colour, product.size].filter(Boolean).join(' · ')}</div>}
        </div>
        {product.sku && <span class="product-meta-token code">{product.sku}</span>}
      </div>

      {(formError || error) && <div class="error-message mb-4" role="alert">{formError || error}</div>}

      <div class="stock-change-inputs">
        <div class="form-group">
          <label class="form-label" for="changeQuantity">New individual QTY</label>
          <input id="changeQuantity" class="form-input" type="number" min="0" step="1" inputMode="numeric" value={quantity} onInput={(event) => setQuantity((event.target as HTMLInputElement).value)} disabled={loading} required />
        </div>
        <div class="form-group">
          <label class="form-label" for="changeSetStock">New Stock/set</label>
          <input id="changeSetStock" class="form-input" type="number" min="0" step="any" inputMode="decimal" value={setStockQuantity} onInput={(event) => setSetStockQuantity((event.target as HTMLInputElement).value)} disabled={loading} required />
        </div>
      </div>

      <div class="stock-change-preview" aria-live="polite">
        <div><span>Individual QTY</span><strong>{product.quantity} → {quantityValid ? nextQuantity : '—'}</strong><small>{changed && quantityValid ? formatDelta(nextQuantity - product.quantity) : 'No change'}</small></div>
        <div><span>Stock/set</span><strong>{product.setStockQuantity ?? 0} → {setStockValid ? nextSetStock : '—'}</strong><small>{changed && setStockValid ? formatDelta(nextSetStock - (product.setStockQuantity ?? 0)) : 'No change'}</small></div>
      </div>
      <div class="form-hint mb-4" aria-live="polite">
        {setupGuidance
          ? `${setupGuidance} ${product.unitsPerSet ? 'Adjust either stock value so they match.' : 'Use Edit details to add Pieces per set.'}`
          : product.unitsPerSet ? 'Individual QTY and Stock/set match.' : ''}
      </div>

      <div class="form-group">
        <label class="form-label" for="stockReason">Reason <span class="required-asterisk">*</span></label>
        <select id="stockReason" class="form-input" value={reason} onInput={(event) => setReason((event.target as HTMLSelectElement).value as StockChangeReason)} disabled={loading} required>
          <option value="">Choose a reason</option>
          {STOCK_REASONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="stockNote">Note (optional)</label>
        <input id="stockNote" class="form-input" value={note} onInput={(event) => setNote((event.target as HTMLInputElement).value)} placeholder="Add context for the stock history" maxLength={500} disabled={loading} />
      </div>
      <p class="stock-audit-note">This change will be saved in stock history with its reason.</p>
      <div class="stock-change-actions">
        <button type="button" class="btn btn-secondary" onClick={onCancel} disabled={loading}>Cancel</button>
        <button type="submit" class="btn btn-primary" disabled={loading}>{loading ? 'Saving…' : 'Save stock change'}</button>
      </div>
    </form>
  );
}

interface ProductListProps {
  initialActiveFilter?: 'active' | 'inactive' | 'all' | 'personal' | 'setup';
  selectedProductId?: number | null;
  onNavigate?: (route: any) => void;
  onProductsChanged?: () => Promise<void>;
}

export function ProductList({ initialActiveFilter = 'active', selectedProductId, onNavigate, onProductsChanged }: ProductListProps) {
  const [activeFilter, setActiveFilter] = useState<'active' | 'inactive' | 'all' | 'personal' | 'setup'>(initialActiveFilter);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingProduct, setEditingProduct] = useState<number | null>(null);
  const [creatingProduct, setCreatingProduct] = useState(false);
  const [changingStock, setChangingStock] = useState<number | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  // Fetch all products up to 1000 items once, apply active/inactive filtering on the client
  const {
    products,
    total,
    loading,
    error: fetchError,
    refetch,
  } = useProducts('all', 1000);

  const { createProduct } = useCreateProduct();
  const { updateProduct } = useUpdateProduct();
  const { toggleProduct, loading: toggling } = useToggleProduct();
  const { locations, loading: locationsLoading, error: locationsError } = useLocations();

  // Track if auto-scrolling for selectedProductId has completed to ensure it runs only once per selection
  const scrolledForIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!selectedProductId || loading) return;

    // Run only once per selectedProductId
    if (scrolledForIdRef.current === selectedProductId) return;
    scrolledForIdRef.current = selectedProductId;

    const targetId = selectedProductId;
    let animId: number;

    // Use requestAnimationFrame to scroll after DOM rendering
    animId = requestAnimationFrame(() => {
      const el = document.getElementById(`product-${targetId}`);
      if (el) {
        const prefersReduced = typeof window !== 'undefined' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        el.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'center' });
      } else {
        window.scrollTo(0, 0);
      }
    });

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [selectedProductId, loading, products]);

  const refreshViews = async () => {
    setMutationError(null);
    const results = await Promise.allSettled([
      refetch(),
      ...(onProductsChanged ? [onProductsChanged()] : []),
    ]);
    if (results.some((result) => result.status === 'rejected')) {
      setMutationError('Changes were saved, but the latest product list could not be refreshed. Reopen Products to try again.');
    }
  };

  // Local filtering by search query and activity filter
  const filteredProducts = products.filter(product => {
    const normalizedQuery = searchQuery.toLowerCase();
    const matchesSearch = !searchQuery || [
      product.name,
      product.sku,
      product.colour,
      product.size,
      product.locationName,
    ].some((value) => value?.toLowerCase().includes(normalizedQuery));

    const matchesFilter = activeFilter === 'all' ||
      (activeFilter === 'active' && product.active) ||
      (activeFilter === 'inactive' && !product.active) ||
      (activeFilter === 'personal' && product.personalUse) ||
      (activeFilter === 'setup' && needsUnitsPerSetConfiguration(product));

    return matchesSearch && matchesFilter;
  });

  const handleCreate = async (data: ProductFormData) => {
    setMutationError(null);
    const result = await createProduct(data);
    if (result) {
      setCreatingProduct(false);
      await refreshViews();
    }
  };

  const handleUpdate = async (id: number, data: ProductFormData) => {
    setMutationError(null);
    const existing = products.find(p => p.id === id);
    if (!existing) return;
    const result = await updateProduct(id, data, existing.version);
    if (result) {
      setEditingProduct(null);
      await refreshViews();
    }
  };

  const handleToggleActive = async (id: number, currentActive: boolean) => {
    setMutationError(null);
    try {
      const result = await toggleProduct(id, !currentActive);
      if (result) await refreshViews();
    } catch (err) {
      setMutationError(err instanceof Error ? err.message : 'Failed to update product status');
    }
  };

  const handleCancel = () => {
    setEditingProduct(null);
    setCreatingProduct(false);
    setChangingStock(null);
  };

  const activeCount = products.filter(p => p.active).length;
  const inactiveCount = products.filter(p => !p.active).length;
  const setupCount = products.filter(needsUnitsPerSetConfiguration).length;
  const productBeingEdited = products.find((product) => product.id === editingProduct);
  const productChangingStock = products.find((product) => product.id === changingStock);
  const editInitialData: ProductFormData | undefined = productBeingEdited ? {
    name: productBeingEdited.name,
    sku: productBeingEdited.sku ?? '',
    category: productBeingEdited.category ?? '',
    colour: productBeingEdited.colour ?? '',
    size: productBeingEdited.size ?? '',
    pricePaise: productBeingEdited.pricePaise,
    mrpPaise: productBeingEdited.mrpPaise ?? null,
    consultantPricePaise: productBeingEdited.consultantPricePaise ?? null,
    quantity: productBeingEdited.quantity,
    setStockQuantity: productBeingEdited.setStockQuantity ?? 0,
    unitsPerSet: productBeingEdited.unitsPerSet ?? null,
    lowStockLevel: productBeingEdited.lowStockLevel,
    locationId: productBeingEdited.locationId ?? null,
    personalUse: productBeingEdited.personalUse ?? false,
    active: productBeingEdited.active,
  } : undefined;

  return (
    <div class="screen">
      <div class="main no-sticky-action">
        <div class="page-header">
          <h1 class="text-2xl font-semibold">Products</h1>
          <div class="header-actions">
            {onNavigate && (
              <button
                class="btn btn-soft-blue btn-sm"
                onClick={() => onNavigate('stock')}
                type="button"
              >
                Stock tasks
              </button>
            )}
            {!creatingProduct && !editingProduct && !changingStock && (
              <button
                class="btn btn-primary btn-sm"
                onClick={() => setCreatingProduct(true)}
                type="button"
              >
                New product
              </button>
            )}
          </div>
        </div>

        <div class="sales-search-form mb-4">
          <div class="search-input">
            <SearchIcon />
            <input
              type="search"
              class="form-input"
              placeholder="Search name, colour, size, location or SKU…"
              value={searchQuery}
              onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
              aria-label="Search products"
            />
          </div>
          <div class="sales-search-actions product-search-actions">
            <button class="btn btn-secondary" type="button" onClick={() => setSearchQuery('')} disabled={!searchQuery}>Reset</button>
          </div>
        </div>

        <div class="sales-filter-pills mb-4" role="group" aria-label="Filter products by status">
          {(
            [
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
              { value: 'all', label: 'All' },
              { value: 'personal', label: 'Personal' },
              { value: 'setup', label: `Needs setup (${setupCount})` },
            ] as const
          ).map((item) => (
            <button
              key={item.value}
              type="button"
              class={`filter-pill ${activeFilter === item.value ? 'selected' : ''}`}
              aria-pressed={activeFilter === item.value}
              onClick={() => setActiveFilter(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {fetchError && (
          <div class="error-message mb-4" role="alert">
            {fetchError}
          </div>
        )}

        {mutationError && <div class="error-message mb-4" role="alert">{mutationError}</div>}

        {locationsError && (
          <div class="error-message mb-4" role="alert">{locationsError}</div>
        )}

        {creatingProduct ? (
          <ProductForm
            locations={locations}
            locationsLoading={locationsLoading}
            onSave={(data) => handleCreate(data)}
            onCancel={handleCancel}
            isEditing={false}
          />
        ) : editingProduct ? (
          <ProductForm
            initialData={editInitialData!}
            locations={locations}
            locationsLoading={locationsLoading}
            onSave={(data) => handleUpdate(editingProduct, data)}
            onCancel={handleCancel}
            isEditing={true}
            onChangeStock={() => {
              setChangingStock(editingProduct);
              setEditingProduct(null);
            }}
          />
        ) : productChangingStock ? (
          <StockChangeForm
            product={productChangingStock}
            onCancel={handleCancel}
            onSaved={async () => {
              setChangingStock(null);
              await refreshViews();
            }}
            onConflict={async () => {
              await Promise.allSettled([refetch()]);
            }}
          />
        ) : (
          <>
            <div class="product-summary mb-4">
              <span class="text-sm text-ink-light">
                {total > products.length
                  ? `Showing ${products.length} of ${total} products`
                  : `Total: ${total} products · Active: ${activeCount} · Inactive: ${inactiveCount}`}
              </span>
            </div>

            {filteredProducts.length === 0 ? (
              <div class="empty-state">
                <div class="empty-state-icon"><SearchIcon /></div>
                <h3 class="empty-state-title">No products found</h3>
                <p class="empty-state-message">
                  {searchQuery ? 'Try a different search.' : activeFilter !== 'all' ? 'No products match this filter.' : 'Create your first product to get started.'}
                </p>
                {!searchQuery && activeFilter === 'all' && (
                  <button
                    class="btn btn-primary mt-4"
                    onClick={() => setCreatingProduct(true)}
                    type="button"
                  >
                    <PlusIcon /> Create first product
                  </button>
                )}
              </div>
            ) : (
              <div class="product-list">
                {filteredProducts.map((product) => {
                  const isSelected = selectedProductId === product.id;
                  const setupIssue = getProductSetupIssue(product);
                  return (
                    <article
                      key={product.id}
                      id={`product-${product.id}`}
                      class={`product-list-row ${isSelected ? 'product-list-row-selected' : ''}`}
                    >
                      <div class="product-identity">
                        {isSelected && (
                          <div class="product-selected-badge mb-1">
                            <span class="status-chip status-chip-highlighted">Opened from Home</span>
                          </div>
                        )}

                        <div class="product-name">{product.name}</div>
                          {(product.colour || product.size) && (
                            <div class="text-sm text-ink-light">
                              {[product.colour, product.size].filter(Boolean).join(' · ')}
                            </div>
                          )}
                          <div class="product-meta-line">
                            {product.sku && <span class="product-meta-token code">{product.sku}</span>}
                            {product.category && <span>{product.category}</span>}
                            {product.locationName && <span>{product.locationName}</span>}
                          </div>
                        <div class="product-status-badges">
                          {product.quantity === 0 ? <span class="status-chip status-chip-out-of-stock">Out of stock</span> : product.quantity <= product.lowStockLevel ? <span class="status-chip status-chip-low-stock">Low stock</span> : null}
                          {product.personalUse && (
                            <span class="status-chip status-chip-warning">Keep aside</span>
                          )}
                          {!product.active && (
                            <span class="status-chip status-chip-muted">
                              Inactive
                            </span>
                          )}
                          {setupIssue && (
                            <span class="status-chip status-chip-warning">Needs setup</span>
                          )}
                        </div>
                        {setupIssue && (
                          <div class="text-sm text-ink-light mt-2">
                            {setupIssue} Use Edit details for Pieces per set or Change stock to correct the saved stock.
                          </div>
                        )}
                    </div>

                    <div class="product-inventory">
                      <div><span>QTY</span><strong>{product.quantity}</strong></div>
                      <div><span>Stock/set</span><strong>{product.setStockQuantity ?? 0}</strong></div>
                      <div><span>SRP</span><strong>{formatInr(product.pricePaise)}</strong></div>
                    </div>

                    <div class="product-actions">
                      <button
                        class="btn btn-soft-blue btn-sm"
                        onClick={() => setChangingStock(product.id)}
                        type="button"
                        disabled={toggling}
                      >
                        Change stock
                      </button>
                      <button
                        class="btn btn-secondary btn-sm"
                        onClick={() => setEditingProduct(product.id)}
                        type="button"
                        disabled={toggling}
                      >
                        <EditIcon /> Edit details
                      </button>
                      <button
                        class="btn btn-ghost btn-sm product-toggle"
                        onClick={() => handleToggleActive(product.id, product.active)}
                        disabled={toggling}
                      >
                        {product.active ? <><XIcon /> Deactivate</> : <><CheckIcon /> Activate</>}
                      </button>
                    </div>
                  </article>
                );
              })}
              </div>
            )}

            {loading && (
              <div class="text-center text-ink-light mt-4">
                Loading products...
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

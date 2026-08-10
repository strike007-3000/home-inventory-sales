import { useState } from 'preact/hooks';
import { useProducts, useCreateProduct, useUpdateProduct, useToggleProduct, useLocations, type ProductFormData } from '../hooks/useProducts';
import { formatInr } from '../domain';
import { ProductForm } from './ProductForm';
import {
  SearchIcon,
  PlusIcon,
  EditIcon,
  CheckIcon,
  XIcon,
} from '../icons';

interface ProductListProps {
  activeFilter?: 'active' | 'inactive' | 'all';
  onNavigate?: (route: any) => void;
}

export function ProductList({ activeFilter = 'all', onNavigate }: ProductListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingProduct, setEditingProduct] = useState<number | null>(null);
  const [creatingProduct, setCreatingProduct] = useState(false);

  const {
    products,
    total,
    loading,
    error: fetchError,
    refetch,
  } = useProducts(activeFilter);

  const { createProduct } = useCreateProduct();
  const { updateProduct } = useUpdateProduct();
  const { toggleProduct, loading: toggling } = useToggleProduct();
  const { locations, loading: locationsLoading, error: locationsError } = useLocations();

  // Use local filter for display, refetch from API
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
      (activeFilter === 'inactive' && !product.active);

    return matchesSearch && matchesFilter;
  });


  const handleCreate = async (data: ProductFormData) => {
    const result = await createProduct(data);
    if (result) {
      refetch();
      setCreatingProduct(false);
    }
  };

  const handleUpdate = async (id: number, data: ProductFormData) => {
    const existing = products.find(p => p.id === id);
    if (!existing) return;
    const result = await updateProduct(id, data, existing.version);
    if (result) {
      refetch();
      setEditingProduct(null);
    }
  };

  const handleToggleActive = async (id: number, currentActive: boolean) => {
    const result = await toggleProduct(id, !currentActive);
    if (result) {
      refetch();
    }
  };

  const handleCancel = () => {
    setEditingProduct(null);
    setCreatingProduct(false);
  };

  const activeCount = products.filter(p => p.active).length;
  const inactiveCount = products.filter(p => !p.active).length;
  const productBeingEdited = products.find((product) => product.id === editingProduct);
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
    lowStockLevel: productBeingEdited.lowStockLevel,
    locationId: productBeingEdited.locationId ?? null,
    personalUse: productBeingEdited.personalUse ?? false,
    active: productBeingEdited.active,
  } : undefined;

  return (
    <div class="screen">
      <div class="main no-sticky-action">
        <div class="page-header flex items-center justify-between mb-4">
          <h1 class="text-2xl font-semibold">Products</h1>
          <div class="flex items-center gap-2">
            {onNavigate && (
              <button
                class="btn btn-secondary btn-sm"
                onClick={() => onNavigate('stock')}
                type="button"
              >
                Update stock
              </button>
            )}
            {!creatingProduct && !editingProduct && (
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

        <div class="search-input mb-4">
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

        {fetchError && (
          <div class="error-message mb-4" role="alert">
            {fetchError}
          </div>
        )}

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
          />
        ) : (
          <>
            <div class="product-summary mb-4">
              <span class="text-sm text-ink-light">
                Total: {total} products · Active: {activeCount} · Inactive: {inactiveCount}
              </span>
            </div>

            {filteredProducts.length === 0 ? (
              <div class="empty-state">
                <div class="empty-state-icon"><SearchIcon /></div>
                <h3 class="empty-state-title">No products found</h3>
                <p class="empty-state-message">
                  {searchQuery ? 'Try a different search.' : activeFilter !== 'all' ? 'No products in this category.' : 'Create your first product to get started.'}
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
              <div class="product-list" aria-live="polite">
                {filteredProducts.map((product) => (
                  <div
                    key={product.id}
                    class="list-item product-list-row"
                  >
                    <div class="flex-1">
                      <div class="flex items-start justify-between">
                        <div>
                          <div class="font-semibold">{product.name}</div>
                          {(product.colour || product.size) && (
                            <div class="text-sm text-ink-light">
                              {[product.colour, product.size].filter(Boolean).join(' · ')}
                            </div>
                          )}
                          {product.sku && (
                            <div class="text-sm text-ink-light code">
                              SKU: {product.sku}
                            </div>
                          )}
                          {product.category && (
                            <div class="text-sm text-ink-light">
                              {product.category}
                            </div>
                          )}
                          {product.locationName && (
                            <div class="text-sm text-ink-light">{product.locationName}</div>
                          )}
                        </div>
                        <div class="product-status-badge">
                          {product.personalUse && (
                            <span class="status-chip status-chip-warning">Keep aside</span>
                          )}
                          {product.active ? (
                            <span class="status-chip status-chip-success">
                              Active
                            </span>
                          ) : (
                            <span class="status-chip status-chip-muted">
                              Inactive
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div class="product-list-meta">
                      <div class="font-semibold text-lg">SRP {formatInr(product.pricePaise)} / Stock</div>
                      {product.mrpPaise !== null && product.mrpPaise !== undefined && (
                        <div class="text-sm text-ink-light">MRP {formatInr(product.mrpPaise)} / Stock</div>
                      )}
                      <div class={product.quantity === 0 ? 'text-error' : product.quantity <= product.lowStockLevel ? 'text-marigold' : 'text-ink-light'}>
                        {product.quantity === 0 ? 'Out of stock' : `${product.quantity} individual`}
                      </div>
                      <div class="text-sm text-ink-light">{product.setStockQuantity ?? 0} sets</div>
                    </div>

                    <div class="product-actions">
                      <button
                        class="btn btn-ghost btn-sm"
                        onClick={() => setEditingProduct(product.id)}
                        type="button"
                        disabled={toggling}
                      >
                        <EditIcon />
                      </button>
                      <button
                        class="btn btn-ghost btn-sm"
                        onClick={() => handleToggleActive(product.id, product.active)}
                        type="button"
                        disabled={toggling}
                      >
                        {product.active ? <XIcon /> : <CheckIcon />}
                      </button>
                    </div>
                  </div>
                ))}
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

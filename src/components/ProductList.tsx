import { useState } from 'preact/hooks';
import { useProducts, useCreateProduct, useUpdateProduct, useToggleProduct, type ProductFormData } from '../hooks/useProducts';
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
}

export function ProductList({ activeFilter = 'all' }: ProductListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingProduct, setEditingProduct] = useState<number | null>(null);
  const [creatingProduct, setCreatingProduct] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

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

  // Use local filter for display, refetch from API
  const filteredProducts = products.filter(product => {
    const matchesSearch = !searchQuery ||
      product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (product.sku && product.sku.toLowerCase().includes(searchQuery.toLowerCase()));

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

  return (
    <div class="screen">
      <div class="main no-sticky-action">
        <div class="page-header">
          <h1 class="text-2xl font-semibold">Products</h1>
          <div class="flex gap-2">
            <button
              class="btn btn-ghost"
              onClick={() => setShowSearch(!showSearch)}
              type="button"
            >
              <SearchIcon />
              {showSearch ? 'Close' : 'Search'}
            </button>
            {!creatingProduct && !editingProduct && (
              <button
                class="btn btn-primary"
                onClick={() => setCreatingProduct(true)}
                type="button"
              >
                <PlusIcon />
                New product
              </button>
            )}
          </div>
        </div>

        {showSearch && (
          <div class="search-input mb-4">
            <SearchIcon />
            <input
              type="search"
              class="form-input"
              placeholder="Search products or SKU..."
              value={searchQuery}
              onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
              aria-label="Search products"
            />
          </div>
        )}

        {fetchError && (
          <div class="error-message mb-4" role="alert">
            {fetchError}
          </div>
        )}

        {creatingProduct ? (
          <ProductForm
            onSave={(data) => handleCreate(data)}
            onCancel={handleCancel}
            isEditing={false}
          />
        ) : editingProduct ? (
          <ProductForm
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
                        </div>
                        <div class="product-status-badge">
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
                      <div class="font-semibold text-lg">{formatInr(product.pricePaise)}</div>
                      <div class={product.quantity === 0 ? 'text-error' : product.quantity <= product.lowStockLevel ? 'text-marigold' : 'text-ink-light'}>
                        {product.quantity === 0 ? 'Out of stock' : `${product.quantity} in stock`}
                      </div>
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

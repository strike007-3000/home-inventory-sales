import { useState, useEffect } from 'preact/hooks';
import { apiGetJson, apiPostJson, apiPutJson } from '../api';
import { Product } from '../domain';
import type { LocationDTO } from '../../shared/contracts';

// Product form data (used for create/update)
export interface ProductFormData {
  name: string;
  sku?: string;
  category?: string;
  colour?: string;
  size?: string;
  pricePaise: number;
  mrpPaise: number | null;
  consultantPricePaise: number | null;
  quantity: number;
  setStockQuantity: number;
  lowStockLevel: number;
  locationId: number | null;
  personalUse: boolean;
  active: boolean;
}

// API response format from /api/products
export interface ProductsResponse {
  items: Product[];
  total: number;
}

// Error type for API operations
export interface ProductError {
  field?: string;
  message: string;
}

export function useLocations() {
  const [locations, setLocations] = useState<LocationDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchLocations = async () => {
      try {
        const data = await apiGetJson<{ items: LocationDTO[] }>('/locations');
        setLocations(data.items);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch locations');
      } finally {
        setLoading(false);
      }
    };

    void fetchLocations();
  }, []);

  return { locations, loading, error };
}

// ============================================================================
// Product CRUD Hooks
// ============================================================================

/**
 * Hook to fetch products from the API
 */
export function useProducts(activeFilter?: 'active' | 'inactive' | 'all') {
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProducts = async () => {
    setLoading(true);
    setError(null);

    try {
      const url = activeFilter
        ? `/products?active=${activeFilter}`
        : '/products';

      const data = await apiGetJson<ProductsResponse>(url);
      setProducts(data.items);
      setTotal(data.total);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to fetch products');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, [activeFilter]);

  return { products, total, loading, error, refetch: fetchProducts };
}

/**
 * Hook to create a new product
 */
export function useCreateProduct() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const createProduct = async (data: ProductFormData): Promise<Product | null> => {
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const product = await apiPostJson<Product>('/products', data);
      setSuccess(true);
      return product;
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to create product');
      }
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { createProduct, loading, error, success };
}

/**
 * Hook to update an existing product
 */
export function useUpdateProduct() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const updateProduct = async (id: number, data: ProductFormData, version: number): Promise<Product | null> => {
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const product = await apiPutJson<Product>(`/products/${id}?version=${version}`, data);
      setSuccess(true);
      return product;
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to update product');
      }
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { updateProduct, loading, error, success };
}

/**
 * Hook to toggle product active status
 */
export function useToggleProduct() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const toggleProduct = async (id: number, active: boolean): Promise<Product | null> => {
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const action = active ? 'activate' : 'deactivate';
      const product = await apiPostJson<Product>(`/products/${id}/${action}`, {});
      setSuccess(true);
      return product;
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to update product status');
      }
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { toggleProduct, loading, error, success };
}

import { useState } from 'preact/hooks';
import { validateQuantity, validateWholeNumber } from '../domain';

// Product form data
export interface ProductFormData {
  name: string;
  sku?: string;
  category?: string;
  pricePaise: number;
  quantity: number;
  lowStockLevel: number;
  active: boolean;
}

interface ProductFormProps {
  initialData?: Partial<ProductFormData>;
  onSave: (data: ProductFormData, id?: number | undefined) => Promise<void>;
  onCancel: () => void;
  isEditing?: boolean;
}

export function ProductForm({
  initialData,
  onSave,
  onCancel,
  isEditing = false,
}: ProductFormProps) {
  const [formData, setFormData] = useState<ProductFormData>(() => ({
    name: initialData?.name || '',
    sku: initialData?.sku || '',
    category: initialData?.category || '',
    pricePaise: initialData?.pricePaise || 0,
    quantity: initialData?.quantity || 0,
    lowStockLevel: initialData?.lowStockLevel || 5,
    active: initialData?.active ?? true,
  }));

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  // Validate all fields
  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Product name is required';
    }

    if (formData.sku && !formData.sku.trim()) {
      newErrors.sku = 'SKU cannot be empty';
    }

    const qtyValidation = validateQuantity(formData.quantity, 'Quantity');
    if (!qtyValidation.ok) {
      newErrors.quantity = qtyValidation.error;
    }

    const lowStockValidation = validateWholeNumber(formData.lowStockLevel, 'Low stock level');
    if (!lowStockValidation.ok) {
      newErrors.lowStockLevel = lowStockValidation.error;
    }

    const priceValidation = validateWholeNumber(formData.pricePaise, 'Price');
    if (!priceValidation.ok) {
      newErrors.pricePaise = priceValidation.error;
    }

    if (formData.lowStockLevel < 0) {
      newErrors.lowStockLevel = 'Low stock level cannot be negative';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleInputChange = (field: keyof ProductFormData, value: string | number | boolean) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error for this field when user starts typing
    if (errors[field]) {
      setErrors(prev => {
        const newErrors = { ...prev };
        delete newErrors[field];
        return newErrors;
      });
    }
  };

  const handleSubmit = async (e: Event, id?: number) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setLoading(true);
    setSuccess(false);

    try {
      await onSave(formData, id);
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        onCancel();
      }, 2000);
    } catch (err) {
      if (err instanceof Error) {
        setErrors({ submit: err.message });
      } else {
        setErrors({ submit: 'Failed to save product' });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <form class="card" onSubmit={handleSubmit}>
      <h2 class="card-title mb-4">{isEditing ? 'Edit product' : 'Create product'}</h2>

      {success && (
        <div class="text-center text-success font-semibold mb-4" role="status" aria-live="polite">
          ✓ {isEditing ? 'Product updated' : 'Product created'}
        </div>
      )}

      {errors.submit && (
        <div class="error-message mb-4" role="alert">
          {errors.submit}
        </div>
      )}

      <div class="form-group">
        <label class="form-label" for="name">Product name *</label>
        <input
          id="name"
          type="text"
          class={`form-input ${errors.name ? 'form-input-error' : ''}`}
          value={formData.name}
          onInput={(e) => handleInputChange('name', (e.target as HTMLInputElement).value)}
          placeholder="Enter product name"
          required
          disabled={loading}
        />
        {errors.name && <span class="text-error text-sm mt-1 block">{errors.name}</span>}
      </div>

      <div class="form-group">
        <label class="form-label" for="sku">SKU (optional)</label>
        <input
          id="sku"
          type="text"
          class={`form-input ${errors.sku ? 'form-input-error' : ''}`}
          value={formData.sku || ''}
          onInput={(e) => handleInputChange('sku', (e.target as HTMLInputElement).value)}
          placeholder="Enter SKU (e.g., SKU001)"
          disabled={loading}
        />
        {errors.sku && <span class="text-error text-sm mt-1 block">{errors.sku}</span>}
      </div>

      <div class="form-group">
        <label class="form-label" for="category">Category (optional)</label>
        <input
          id="category"
          type="text"
          class="form-input"
          value={formData.category || ''}
          onInput={(e) => handleInputChange('category', (e.target as HTMLInputElement).value)}
          placeholder="Enter category"
          disabled={loading}
        />
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div class="form-group">
          <label class="form-label" for="price">Price (₹) *</label>
          <input
            id="price"
            type="number"
            class={`form-input ${errors.pricePaise ? 'form-input-error' : ''}`}
            value={formData.pricePaise > 0 ? (formData.pricePaise / 100).toFixed(2) : ''}
            onInput={(e) => {
              const value = (e.target as HTMLInputElement).value;
              const paise = Math.round(parseFloat(value || '0') * 100);
              handleInputChange('pricePaise', paise);
            }}
            min="0"
            step="0.01"
            inputMode="decimal"
            placeholder="0.00"
            required
            disabled={loading}
          />
          {errors.pricePaise && <span class="text-error text-sm mt-1 block">{errors.pricePaise}</span>}
          <span class="text-sm text-ink-light">Base price in INR</span>
        </div>

        <div class="form-group">
          <label class="form-label" for="quantity">Quantity *</label>
          <input
            id="quantity"
            type="number"
            class={`form-input ${errors.quantity ? 'form-input-error' : ''}`}
            value={formData.quantity}
            onInput={(e) => handleInputChange('quantity', parseInt((e.target as HTMLInputElement).value, 10) || 0)}
            min="0"
            inputMode="numeric"
            placeholder="0"
            required
            disabled={loading}
          />
          {errors.quantity && <span class="text-error text-sm mt-1 block">{errors.quantity}</span>}
          <span class="text-sm text-ink-light">Current stock</span>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label" for="lowStockLevel">Low stock level *</label>
        <input
          id="lowStockLevel"
          type="number"
          class={`form-input ${errors.lowStockLevel ? 'form-input-error' : ''}`}
          value={formData.lowStockLevel}
          onInput={(e) => handleInputChange('lowStockLevel', parseInt((e.target as HTMLInputElement).value, 10) || 0)}
          min="0"
          inputMode="numeric"
          placeholder="5"
          required
          disabled={loading}
        />
        {errors.lowStockLevel && <span class="text-error text-sm mt-1 block">{errors.lowStockLevel}</span>}
        <span class="text-sm text-ink-light">Alert when stock falls below this amount</span>
      </div>

      <div class="form-group">
        <label class="form-label" for="active">Status</label>
        <div class="flex items-center gap-2 mt-2">
          <input
            id="active"
            type="checkbox"
            class="form-checkbox"
            checked={formData.active}
            onInput={(e) => handleInputChange('active', (e.target as HTMLInputElement).checked)}
            disabled={loading}
          />
          <label for="active" class="text-sm text-ink-light">Product is active</label>
        </div>
      </div>

      <div class="flex gap-3 mt-6">
        <button
          type="button"
          class="btn btn-secondary flex-1"
          onClick={onCancel}
          disabled={loading}
        >
          Cancel
        </button>
        <button
          type="submit"
          class="btn btn-primary flex-1"
          disabled={loading}
        >
          {loading ? 'Saving...' : isEditing ? 'Save changes' : 'Create product'}
        </button>
      </div>
    </form>
  );
}

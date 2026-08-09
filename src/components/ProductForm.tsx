import { useState } from 'preact/hooks';
import type { LocationDTO } from '../../shared/contracts';
import { validateQuantity, validateWholeNumber } from '../domain';

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

interface ProductFormProps {
  initialData?: Partial<ProductFormData>;
  locations: readonly LocationDTO[];
  locationsLoading?: boolean;
  onSave: (data: ProductFormData) => Promise<void>;
  onCancel: () => void;
  isEditing?: boolean;
}

function rupeesValue(paise: number | null): string {
  return paise !== null ? (paise / 100).toFixed(2) : '';
}

function parseRupees(value: string): number | null {
  if (value.trim() === '') return null;
  return Math.round(Number(value) * 100);
}

export function ProductForm({
  initialData,
  locations,
  locationsLoading = false,
  onSave,
  onCancel,
  isEditing = false,
}: ProductFormProps) {
  const [formData, setFormData] = useState<ProductFormData>(() => ({
    name: initialData?.name ?? '',
    sku: initialData?.sku ?? '',
    category: initialData?.category ?? '',
    colour: initialData?.colour ?? '',
    size: initialData?.size ?? '',
    pricePaise: initialData?.pricePaise ?? 0,
    mrpPaise: initialData?.mrpPaise ?? null,
    consultantPricePaise: initialData?.consultantPricePaise ?? null,
    quantity: initialData?.quantity ?? 0,
    setStockQuantity: initialData?.setStockQuantity ?? 0,
    lowStockLevel: initialData?.lowStockLevel ?? 5,
    locationId: initialData?.locationId ?? null,
    personalUse: initialData?.personalUse ?? false,
    active: initialData?.active ?? true,
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const setField = <K extends keyof ProductFormData>(field: K, value: ProductFormData[K]) => {
    setFormData((previous) => ({ ...previous, [field]: value }));
    if (errors[field]) {
      setErrors((previous) => {
        const next = { ...previous };
        delete next[field];
        return next;
      });
    }
  };

  const validateForm = (): boolean => {
    const next: Record<string, string> = {};
    if (!formData.name.trim()) next.name = 'Product name is required';

    const quantity = validateQuantity(formData.quantity, 'Quantity');
    if (!quantity.ok) next.quantity = quantity.error;

    if (!Number.isFinite(formData.setStockQuantity) || formData.setStockQuantity < 0) {
      next.setStockQuantity = 'Stock cannot be negative';
    }

    const lowStock = validateWholeNumber(formData.lowStockLevel, 'Low stock level');
    if (!lowStock.ok || formData.lowStockLevel < 0) {
      next.lowStockLevel = lowStock.ok
        ? 'Low stock level cannot be negative'
        : lowStock.error;
    }

    const prices: Array<[keyof ProductFormData, number | null, string]> = [
      ['pricePaise', formData.pricePaise, 'SRP'],
      ['mrpPaise', formData.mrpPaise, 'MRP'],
      ['consultantPricePaise', formData.consultantPricePaise, 'CP'],
    ];
    for (const [field, value, label] of prices) {
      if (value === null && field !== 'pricePaise') continue;
      if (value === null || !Number.isSafeInteger(value) || value < 0) {
        next[field] = `${label} must be a valid non-negative amount`;
      }
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (event: Event) => {
    event.preventDefault();
    if (!validateForm()) return;
    setLoading(true);
    try {
      await onSave(formData);
    } catch (error) {
      setErrors({ submit: error instanceof Error ? error.message : 'Failed to save product' });
    } finally {
      setLoading(false);
    }
  };

  const priceInput = (
    id: string,
    label: string,
    field: 'pricePaise' | 'mrpPaise' | 'consultantPricePaise',
    required = false,
  ) => (
    <div class="form-group">
      <label class="form-label" for={id}>
        {label} (₹){required ? <span class="required-asterisk">*</span> : ''}
      </label>
      <input
        id={id}
        type="number"
        class={`form-input ${errors[field] ? 'form-input-error' : ''}`}
        value={rupeesValue(formData[field])}
        onInput={(event) => setField(field, parseRupees((event.target as HTMLInputElement).value))}
        min="0"
        step="0.01"
        inputMode="decimal"
        placeholder="0.00"
        required={required}
        disabled={loading}
      />
      {errors[field] && <span class="text-error text-sm mt-1 block">{errors[field]}</span>}
    </div>
  );

  return (
    <form class="card" onSubmit={handleSubmit}>
      <h2 class="card-title mb-4">{isEditing ? 'Edit product' : 'Create product'}</h2>

      {errors.submit && <div class="error-message mb-4" role="alert">{errors.submit}</div>}

      <div class="form-group">
        <label class="form-label" for="name">
          Product name <span class="required-asterisk">*</span>
        </label>
        <input
          id="name"
          type="text"
          class={`form-input ${errors.name ? 'form-input-error' : ''}`}
          value={formData.name}
          onInput={(event) => setField('name', (event.target as HTMLInputElement).value)}
          required
          disabled={loading}
        />
        {errors.name && <span class="text-error text-sm mt-1 block">{errors.name}</span>}
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div class="form-group">
          <label class="form-label" for="colour">Colour(s)</label>
          <input id="colour" class="form-input" value={formData.colour} onInput={(event) => setField('colour', (event.target as HTMLInputElement).value)} placeholder="e.g. Pink and green" disabled={loading} />
        </div>
        <div class="form-group">
          <label class="form-label" for="size">Size(s)</label>
          <input id="size" class="form-input" value={formData.size} onInput={(event) => setField('size', (event.target as HTMLInputElement).value)} placeholder="Leave blank if not applicable" disabled={loading} />
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div class="form-group">
          <label class="form-label" for="sku">SKU (optional)</label>
          <input id="sku" class="form-input" value={formData.sku} onInput={(event) => setField('sku', (event.target as HTMLInputElement).value)} disabled={loading} />
        </div>
        <div class="form-group">
          <label class="form-label" for="category">Category (optional)</label>
          <input id="category" class="form-input" value={formData.category} onInput={(event) => setField('category', (event.target as HTMLInputElement).value)} disabled={loading} />
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4">
        {priceInput('mrp', 'MRP per Stock/set', 'mrpPaise')}
        {priceInput('srp', 'SRP per Stock/set', 'pricePaise', true)}
      </div>
      {priceInput('cp', 'Consultant price (CP) per Stock/set', 'consultantPricePaise')}

      <div class="grid grid-cols-2 gap-4">
        <div class="form-group">
          <label class="form-label" for="quantity">
            Individual quantity <span class="required-asterisk">*</span>
          </label>
          <input id="quantity" type="number" class={`form-input ${errors.quantity ? 'form-input-error' : ''}`} value={formData.quantity} onInput={(event) => setField('quantity', Number((event.target as HTMLInputElement).value))} min="0" step="1" inputMode="numeric" required disabled={loading || isEditing} />
          {errors.quantity && <span class="text-error text-sm mt-1 block">{errors.quantity}</span>}
          {isEditing && <span class="form-hint block">Use a stock action to change QTY.</span>}
        </div>
        <div class="form-group">
          <label class="form-label" for="setStockQuantity">
            Stock (sets) <span class="required-asterisk">*</span>
          </label>
          <input id="setStockQuantity" type="number" class={`form-input ${errors.setStockQuantity ? 'form-input-error' : ''}`} value={formData.setStockQuantity} onInput={(event) => setField('setStockQuantity', Number((event.target as HTMLInputElement).value))} min="0" step="0.5" inputMode="decimal" required disabled={loading || isEditing} />
          {errors.setStockQuantity && <span class="text-error text-sm mt-1 block">{errors.setStockQuantity}</span>}
          {isEditing && <span class="form-hint block">Stock changes will use the sale or stock flow.</span>}
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div class="form-group">
          <label class="form-label" for="location">Location</label>
          <select id="location" class="form-input" value={formData.locationId ?? ''} onInput={(event) => setField('locationId', (event.target as HTMLSelectElement).value ? Number((event.target as HTMLSelectElement).value) : null)} disabled={loading || locationsLoading}>
            <option value="">No location</option>
            {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="lowStockLevel">Low-stock alert *</label>
          <input id="lowStockLevel" type="number" class={`form-input ${errors.lowStockLevel ? 'form-input-error' : ''}`} value={formData.lowStockLevel} onInput={(event) => setField('lowStockLevel', Number((event.target as HTMLInputElement).value))} min="0" step="1" inputMode="numeric" required disabled={loading} />
          {errors.lowStockLevel && <span class="text-error text-sm mt-1 block">{errors.lowStockLevel}</span>}
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">Product flags</label>
        <label class="flex items-center gap-2 mt-2" for="personalUse">
          <input id="personalUse" type="checkbox" class="form-checkbox" checked={formData.personalUse} onInput={(event) => setField('personalUse', (event.target as HTMLInputElement).checked)} disabled={loading} />
          <span class="text-sm">Keep aside for personal use (can still be sold)</span>
        </label>
        <label class="flex items-center gap-2 mt-2" for="active">
          <input id="active" type="checkbox" class="form-checkbox" checked={formData.active} onInput={(event) => setField('active', (event.target as HTMLInputElement).checked)} disabled={loading} />
          <span class="text-sm">Product is active</span>
        </label>
      </div>

      <div class="flex gap-3 mt-6">
        <button type="button" class="btn btn-secondary flex-1" onClick={onCancel} disabled={loading}>Cancel</button>
        <button type="submit" class="btn btn-primary flex-1" disabled={loading}>{loading ? 'Saving…' : isEditing ? 'Save changes' : 'Create product'}</button>
      </div>
    </form>
  );
}

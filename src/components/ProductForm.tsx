import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { LidReferenceDTO, LocationDTO, ProductDTO } from '../../shared/contracts';
import { formatInr, validateQuantity, validateWholeNumber, type Product } from '../domain';
import type { ProductFormData } from '../hooks/useProducts';
import { ChevronLeftIcon } from '../icons';
import { apiGetJson } from '../api';

interface ProductFormProps {
  initialData?: Partial<ProductFormData>;
  locations: readonly LocationDTO[];
  locationsLoading?: boolean;
  onSave: (data: ProductFormData) => Promise<void>;
  onCancel: () => void;
  isEditing?: boolean;
  onChangeStock?: () => void;
  products?: readonly Product[];
}

export function formatRupeesInput(paise: number | null): string {
  return paise !== null ? String(paise / 100) : '';
}

export function calculateDiscountedPrice(basePricePaise: number | null, discountPercent: number): number | null {
  if (basePricePaise === null || !Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) return null;
  return Math.round(basePricePaise * (100 - discountPercent) / 100);
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
  onChangeStock,
  products = [],
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
    unitsPerSet: initialData?.unitsPerSet ?? null,
    lowStockLevel: initialData?.lowStockLevel ?? 5,
    locationId: initialData?.locationId ?? null,
    personalUse: initialData?.personalUse ?? false,
    active: initialData?.active ?? true,
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [checkingExisting, setCheckingExisting] = useState(false);
  const [existingCheck, setExistingCheck] = useState<{ product: ProductDTO | null; error?: string } | null>(null);
  const existingCheckRevision = useRef(0);
  const [cpDiscount, setCpDiscount] = useState(() => {
    const srp = initialData?.pricePaise;
    const cp = initialData?.consultantPricePaise;
    const discount = srp && cp !== null && cp !== undefined
      ? Math.round((1 - cp / srp) * 10_000) / 100
      : 24;
    return String(discount >= 0 && discount <= 100 ? discount : 24);
  });
  const [priceText, setPriceText] = useState(() => ({
    pricePaise: formatRupeesInput(initialData?.pricePaise ?? 0),
    mrpPaise: formatRupeesInput(initialData?.mrpPaise ?? null),
  }));

  const setField = <K extends keyof ProductFormData>(field: K, value: ProductFormData[K]) => {
    setFormData((previous) => ({ ...previous, [field]: value }));
    if (field === 'name' || field === 'colour' || field === 'size') {
      existingCheckRevision.current += 1;
      setExistingCheck(null);
      setCheckingExisting(false);
    }
    if (errors[field]) {
      setErrors((previous) => {
        const next = { ...previous };
        delete next[field];
        return next;
      });
    }
  };

  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [lidMatches, setLidMatches] = useState<LidReferenceDTO[]>([]);
  const lowStockTouched = useRef(isEditing);
  const nameQuery = formData.name.trim().toLowerCase();

  const productMatches = useMemo(() => {
    if (isEditing || nameQuery.length < 2) return [];
    return products.filter((product) => product.name.toLowerCase().includes(nameQuery)).slice(0, 4);
  }, [products, nameQuery, isEditing]);

  // Reference-price suggestions from LIDS; debounced, failures just hide the group.
  useEffect(() => {
    if (isEditing || nameQuery.length < 2) { setLidMatches([]); return; }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      apiGetJson<{ items: LidReferenceDTO[] }>(`/lids?q=${encodeURIComponent(nameQuery)}&limit=4&offset=0`)
        .then((data) => { if (!controller.signal.aborted) setLidMatches(data.items); })
        .catch(() => { if (!controller.signal.aborted) setLidMatches([]); });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [nameQuery, isEditing]);

  // Existing values from the catalogue, most used first, for datalist suggestions.
  const valueOptions = (pick: (product: Product) => string | null | undefined) => {
    const counts = new Map<string, number>();
    for (const product of products) {
      const value = pick(product)?.trim();
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([value]) => value);
  };
  const colourOptions = useMemo(() => valueOptions((p) => p.colour), [products]);
  const sizeOptions = useMemo(() => valueOptions((p) => p.size), [products]);
  const categoryOptions = useMemo(() => valueOptions((p) => p.category), [products]);

  const applyCategory = (category: string) => {
    setField('category', category);
    if (lowStockTouched.current) return;
    const levels = products.filter((p) => p.category === category).map((p) => p.lowStockLevel);
    if (levels.length === 0) return;
    const counts = new Map<number, number>();
    for (const level of levels) counts.set(level, (counts.get(level) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) setField('lowStockLevel', top[0]);
  };

  // Copy every descriptive and price field so a new colour or size only needs the changed values.
  // SKU (unique) and stock quantities are not copied: a new variant has its own.
  const pickProduct = (product: Product) => {
    setSuggestOpen(false);
    setFormData((previous) => ({
      ...previous,
      name: product.name,
      category: product.category ?? '',
      colour: product.colour ?? '',
      size: product.size ?? '',
      pricePaise: product.pricePaise,
      mrpPaise: product.mrpPaise ?? null,
      consultantPricePaise: product.consultantPricePaise ?? null,
      unitsPerSet: product.unitsPerSet ?? null,
      lowStockLevel: product.lowStockLevel,
      locationId: product.locationId ?? null,
      personalUse: product.personalUse ?? false,
      active: product.active,
    }));
    setPriceText({ pricePaise: formatRupeesInput(product.pricePaise), mrpPaise: formatRupeesInput(product.mrpPaise ?? null) });
    if (product.consultantPricePaise !== null && product.consultantPricePaise !== undefined && product.pricePaise > 0) {
      const discount = Math.round((1 - product.consultantPricePaise / product.pricePaise) * 10_000) / 100;
      if (discount >= 0 && discount <= 100) setCpDiscount(String(discount));
    }
    lowStockTouched.current = true;
  };

  const pickLid = (item: LidReferenceDTO) => {
    setSuggestOpen(false);
    setFormData((previous) => ({
      ...previous,
      name: item.description,
      sku: item.itemCode,
      mrpPaise: item.mrpPaise,
      pricePaise: item.displayPricePaise,
      consultantPricePaise: item.consultantPricePaise,
    }));
    setPriceText({ pricePaise: formatRupeesInput(item.displayPricePaise), mrpPaise: formatRupeesInput(item.mrpPaise) });
    const discount = Math.round((1 - item.consultantPricePaise / item.displayPricePaise) * 10_000) / 100;
    if (Number.isFinite(discount) && discount >= 0 && discount <= 100) setCpDiscount(String(discount));
    existingCheckRevision.current += 1;
    setExistingCheck(null);
  };

  const checkExistingProduct = async () => {
    if (!formData.name.trim()) {
      setErrors((previous) => ({ ...previous, name: 'Enter a product name before checking' }));
      return;
    }
    const revision = ++existingCheckRevision.current;
    setCheckingExisting(true);
    setExistingCheck(null);
    try {
      const params = new URLSearchParams({
        name: formData.name,
        colour: formData.colour ?? '',
        size: formData.size ?? '',
      });
      const result = await apiGetJson<{ exists: boolean; product: ProductDTO | null }>(`/products/check-existing?${params}`);
      if (existingCheckRevision.current === revision) {
        setExistingCheck({ product: result.product });
      }
    } catch (error) {
      if (existingCheckRevision.current === revision) {
        setExistingCheck({ product: null, error: error instanceof Error ? error.message : 'Could not check products' });
      }
    } finally {
      if (existingCheckRevision.current === revision) {
        setCheckingExisting(false);
      }
    }
  };

  // Re-check for a duplicate automatically while the user types a new product.
  useEffect(() => {
    if (isEditing || formData.name.trim().length < 2) return;
    const timer = setTimeout(() => { void checkExistingProduct(); }, 600);
    return () => clearTimeout(timer);
  }, [formData.name, formData.colour, formData.size, isEditing]);

  const validateForm = (): boolean => {
    const next: Record<string, string> = {};
    if (!formData.name.trim()) next.name = 'Product name is required';

    const quantity = validateQuantity(formData.quantity, 'Quantity');
    if (!quantity.ok) next.quantity = quantity.error;

    if (!Number.isFinite(formData.setStockQuantity) || formData.setStockQuantity < 0) {
      next.setStockQuantity = 'Stock cannot be negative';
    }

    if (formData.unitsPerSet !== null && (!Number.isSafeInteger(formData.unitsPerSet) || formData.unitsPerSet <= 0)) {
      next.unitsPerSet = 'Pieces per set must be a positive whole number';
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
  ) => {
    const keepRawText = field === 'pricePaise' || field === 'mrpPaise';
    return (
    <div class="form-group">
      <label class="form-label" for={id}>
        {label} (₹){required ? <span class="required-asterisk">*</span> : ''}
      </label>
      <input
        id={id}
        type="number"
        class={`form-input ${errors[field] ? 'form-input-error' : ''}`}
        value={keepRawText ? priceText[field] : formatRupeesInput(formData[field])}
        onInput={(event) => {
          const value = (event.target as HTMLInputElement).value;
          if (keepRawText) setPriceText((previous) => ({ ...previous, [field]: value }));
          const paise = parseRupees(value);
          setField(field, paise);
          if (field === 'pricePaise') {
            const calculated = calculateDiscountedPrice(paise, cpDiscount.trim() === '' ? Number.NaN : Number(cpDiscount));
            if (calculated !== null) setField('consultantPricePaise', calculated);
          } else if (field === 'consultantPricePaise' && formData.pricePaise && paise !== null) {
            const discount = Math.round((1 - paise / formData.pricePaise) * 10_000) / 100;
            if (discount >= 0 && discount <= 100) setCpDiscount(String(discount));
          }
        }}
        onFocus={(event) => {
          if (keepRawText) (event.target as HTMLInputElement).select();
        }}
        onBlur={() => {
          if (keepRawText) setPriceText((previous) => ({ ...previous, [field]: formatRupeesInput(formData[field]) }));
        }}
        min="0"
        step="0.01"
        inputMode="decimal"
        placeholder="0"
        required={required}
        disabled={loading}
      />
      {errors[field] && <span class="text-error text-sm mt-1 block">{errors[field]}</span>}
    </div>
    );
  };

  return (
    <form class="card product-form-card" onSubmit={handleSubmit}>
      <button type="button" class="btn btn-ghost btn-sm mb-4" onClick={onCancel} disabled={loading}>
        <ChevronLeftIcon /> Back to products
      </button>
      <h2 class="card-title mb-4">{isEditing ? 'Edit product' : 'Create product'}</h2>

      {errors.submit && <div class="error-message mb-4" role="alert">{errors.submit}</div>}

      <div class="form-group">
        <label class="form-label" for="name">
          Product name <span class="required-asterisk">*</span>
        </label>
        <div class="suggest-wrap">
          <input
            id="name"
            type="text"
            class={`form-input ${errors.name ? 'form-input-error' : ''}`}
            value={formData.name}
            onInput={(event) => { setField('name', (event.target as HTMLInputElement).value); setSuggestOpen(true); setActiveIndex(-1); }}
            onFocus={() => setSuggestOpen(true)}
            onBlur={() => setTimeout(() => setSuggestOpen(false), 150)}
            onKeyDown={(event) => {
              const total = productMatches.length + lidMatches.length;
              if (event.key === 'Escape') { setSuggestOpen(false); return; }
              if (!suggestOpen || total === 0) return;
              if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((i) => (i + 1) % total); }
              else if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((i) => (i <= 0 ? total - 1 : i - 1)); }
              else if (event.key === 'Enter' && activeIndex >= 0) {
                event.preventDefault();
                const product = productMatches[activeIndex];
                if (product) pickProduct(product);
                else { const item = lidMatches[activeIndex - productMatches.length]; if (item) pickLid(item); }
                setActiveIndex(-1);
              }
            }}
            autocomplete="off"
            aria-autocomplete="list"
            aria-expanded={suggestOpen && (productMatches.length > 0 || lidMatches.length > 0)}
            aria-controls="name-suggestions"
            required
            disabled={loading}
          />
          {suggestOpen && (productMatches.length > 0 || lidMatches.length > 0) && (
            <ul class="suggest-list" id="name-suggestions" role="listbox" aria-label="Name suggestions">
              {productMatches.length > 0 && <li class="suggest-group" role="presentation">Already in your products</li>}
              {productMatches.map((product, index) => (
                <li key={`p${product.id}`} role="presentation">
                  <button type="button" class={`suggest-item ${activeIndex === index ? 'is-active' : ''}`} role="option" aria-selected={activeIndex === index} onMouseDown={(event) => event.preventDefault()} onClick={() => pickProduct(product)}>
                    <span>{product.name}<small>{[product.colour, product.size].filter(Boolean).join(' · ') || 'No colour or size'} · QTY {product.quantity}</small></span>
                    <span class="suggest-price">{formatInr(product.pricePaise)}</span>
                  </button>
                </li>
              ))}
              {lidMatches.length > 0 && <li class="suggest-group" role="presentation">LIDS price list</li>}
              {lidMatches.map((item, index) => (
                <li key={`l${item.id}`} role="presentation">
                  <button type="button" class={`suggest-item ${activeIndex === productMatches.length + index ? 'is-active' : ''}`} role="option" aria-selected={activeIndex === productMatches.length + index} onMouseDown={(event) => event.preventDefault()} onClick={() => pickLid(item)}>
                    <span>{item.description}<small>Item code {item.itemCode}</small></span>
                    <span class="suggest-price">{formatInr(item.displayPricePaise)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {errors.name && <span class="text-error text-sm mt-1 block">{errors.name}</span>}
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div class="form-group">
          <label class="form-label" for="colour">Colour(s)</label>
          <input id="colour" class="form-input" value={formData.colour} onInput={(event) => setField('colour', (event.target as HTMLInputElement).value)} placeholder="e.g. Pink and green" list="colour-options" disabled={loading} />
          <datalist id="colour-options">{colourOptions.map((value) => <option key={value} value={value} />)}</datalist>
        </div>
        <div class="form-group">
          <label class="form-label" for="size">Size(s)</label>
          <input id="size" class="form-input" value={formData.size} onInput={(event) => setField('size', (event.target as HTMLInputElement).value)} placeholder="Leave blank if not applicable" list="size-options" disabled={loading} />
          <datalist id="size-options">{sizeOptions.map((value) => <option key={value} value={value} />)}</datalist>
        </div>
      </div>

      {!isEditing && (
        <div class="form-group">
          <button
            type="button"
            class="btn btn-soft-blue w-full"
            onClick={() => void checkExistingProduct()}
            disabled={loading || checkingExisting || !formData.name.trim()}
          >
            {checkingExisting ? 'Checking…' : 'Check if product exists'}
          </button>
          {existingCheck?.error && <div class="error-message mt-2" role="alert">{existingCheck.error}</div>}
          {existingCheck && !existingCheck.error && existingCheck.product && (
            <div class="error-message mt-2" role="status">
              Product already exists: {existingCheck.product.name}
              {(existingCheck.product.colour || existingCheck.product.size) && ` · ${[existingCheck.product.colour, existingCheck.product.size].filter(Boolean).join(' · ')}`}
              {' · '}QTY {existingCheck.product.quantity} · Stock/set {existingCheck.product.setStockQuantity} · SRP {formatInr(existingCheck.product.pricePaise)}
              {!existingCheck.product.active && ' · Inactive'}
            </div>
          )}
          {existingCheck && !existingCheck.error && !existingCheck.product && (
            <div class="success-message mt-2" role="status">No matching product found. You can continue.</div>
          )}
        </div>
      )}

      <div class="grid grid-cols-2 gap-4">
        <div class="form-group">
          <label class="form-label" for="sku">SKU (optional)</label>
          <input id="sku" class="form-input" value={formData.sku} onInput={(event) => setField('sku', (event.target as HTMLInputElement).value)} disabled={loading} />
        </div>
        <div class="form-group">
          <label class="form-label" for="category">Category (optional)</label>
          <input id="category" class="form-input" value={formData.category} onInput={(event) => applyCategory((event.target as HTMLInputElement).value)} list="category-options" disabled={loading} />
          <datalist id="category-options">{categoryOptions.map((value) => <option key={value} value={value} />)}</datalist>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4">
        {priceInput('mrp', 'MRP per Stock/set', 'mrpPaise')}
        {priceInput('srp', 'SRP per Stock/set', 'pricePaise', true)}
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div class="form-group">
          <label class="form-label" for="cpDiscount">CP discount from SRP (%)</label>
          <input
            id="cpDiscount"
            type="number"
            class="form-input"
            value={cpDiscount}
            onInput={(event) => {
              const value = (event.target as HTMLInputElement).value;
              setCpDiscount(value);
              const calculated = calculateDiscountedPrice(formData.pricePaise, value.trim() === '' ? Number.NaN : Number(value));
              if (calculated !== null) setField('consultantPricePaise', calculated);
            }}
            min="0"
            max="100"
            step="0.01"
            inputMode="decimal"
            disabled={loading}
          />
          <span class="form-hint block">Defaults to 24% less than SRP.</span>
        </div>
        {priceInput('cp', 'Consultant price (CP) per Stock/set', 'consultantPricePaise')}
      </div>
      {formData.consultantPricePaise !== null && formData.pricePaise > 0 && formData.pricePaise >= formData.consultantPricePaise && (
        <div class="margin-line" aria-live="polite">
          Margin {formatInr(formData.pricePaise - formData.consultantPricePaise)} ({Math.round((1 - formData.consultantPricePaise / formData.pricePaise) * 1000) / 10}%) per set
        </div>
      )}

      <div class="grid grid-cols-2 gap-4">
        <div class="form-group">
          <label class="form-label" for="quantity">
            Individual quantity <span class="required-asterisk">*</span>
          </label>
          <input id="quantity" type="number" class={`form-input ${errors.quantity ? 'form-input-error' : ''}`} value={formData.quantity} onInput={(event) => setField('quantity', Number((event.target as HTMLInputElement).value))} min="0" step="1" inputMode="numeric" required disabled={loading || isEditing} />
          {errors.quantity && <span class="text-error text-sm mt-1 block">{errors.quantity}</span>}
          {isEditing && <span class="form-hint block">Stock changes are recorded separately.</span>}
        </div>
        <div class="form-group">
          <label class="form-label" for="setStockQuantity">
            Stock (sets) <span class="required-asterisk">*</span>
          </label>
          <input id="setStockQuantity" type="number" class={`form-input ${errors.setStockQuantity ? 'form-input-error' : ''}`} value={formData.setStockQuantity} onInput={(event) => setField('setStockQuantity', Number((event.target as HTMLInputElement).value))} min="0" step="0.5" inputMode="decimal" required disabled={loading || isEditing} />
          {errors.setStockQuantity && <span class="text-error text-sm mt-1 block">{errors.setStockQuantity}</span>}
          {isEditing && <span class="form-hint block">Stock changes are recorded separately.</span>}
        </div>
      </div>

      <div class="form-group">
        <label class="form-label" for="unitsPerSet">Pieces in one set (optional)</label>
        <input
          id="unitsPerSet"
          type="number"
          class={`form-input ${errors.unitsPerSet ? 'form-input-error' : ''}`}
          value={formData.unitsPerSet ?? ''}
          onInput={(event) => {
            const value = (event.target as HTMLInputElement).value;
            setField('unitsPerSet', value === '' ? null : Number(value));
          }}
          min="1"
          step="1"
          inputMode="numeric"
          placeholder="e.g. 4"
          disabled={loading}
        />
        {errors.unitsPerSet && <span class="text-error text-sm mt-1 block">{errors.unitsPerSet}</span>}
        {formData.unitsPerSet !== null && Number.isSafeInteger(formData.unitsPerSet) && formData.unitsPerSet > 0 ? (
          <span class="form-hint block">
            {formData.quantity} individual piece{formData.quantity === 1 ? '' : 's'} = {formData.quantity / formData.unitsPerSet} set{formData.quantity / formData.unitsPerSet === 1 ? '' : 's'}.
          </span>
        ) : (
          <span class="form-hint block">Set this when catalogue prices cover more than one piece.</span>
        )}
      </div>

      {isEditing && onChangeStock && (
        <button type="button" class="btn btn-soft-blue w-full mb-4" onClick={onChangeStock} disabled={loading}>
          Change stock
        </button>
      )}

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
          <input id="lowStockLevel" type="number" class={`form-input ${errors.lowStockLevel ? 'form-input-error' : ''}`} value={formData.lowStockLevel} onInput={(event) => { lowStockTouched.current = true; setField('lowStockLevel', Number((event.target as HTMLInputElement).value)); }} min="0" step="1" inputMode="numeric" required disabled={loading} />
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

      <div class="form-actions-sticky">
        <button type="button" class="btn btn-secondary flex-1" onClick={onCancel} disabled={loading}>Cancel</button>
        <button type="submit" class="btn btn-primary flex-1" disabled={loading || (!isEditing && Boolean(existingCheck?.product))}>{loading ? 'Saving…' : isEditing ? 'Save changes' : 'Create product'}</button>
      </div>
    </form>
  );
}

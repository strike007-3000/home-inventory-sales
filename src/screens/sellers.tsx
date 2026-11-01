import { useCallback, useEffect, useState } from 'preact/hooks';
import type {
  CreateProductRequest, ProductDTO, SellerDTO, SellerPaymentRequest, SellerSummaryDTO, SellerTransferRequest,
} from '../../shared/contracts';
import { apiGetJson, apiPostJson } from '../api';
import { formatInr, PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type PaymentMethod } from '../domain';

const toPaise = (rupees: string) => Math.round((parseFloat(rupees) || 0) * 100);
const fmtDate = (value: string) => new Date(value).toLocaleDateString('en-IN', { dateStyle: 'medium' });
const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

function balanceText(paise: number): string {
  if (paise === 0) return 'Settled';
  return paise > 0 ? `They owe you ${formatInr(paise)}` : `You owe ${formatInr(-paise)}`;
}

export function SellersScreen() {
  const [sellers, setSellers] = useState<readonly SellerSummaryDTO[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSellers((await apiGetJson<{ items: SellerSummaryDTO[] }>('/sellers')).items);
    } catch (e) {
      setError(errText(e, 'Sellers could not be loaded'));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (selected !== null) return <SellerDetail id={selected} onBack={() => { setSelected(null); void load(); }} />;

  const add = async () => {
    setError(null);
    try {
      const seller = await apiPostJson<SellerDTO>('/sellers', { name });
      setName('');
      setSelected(seller.id);
    } catch (e) {
      setError(errText(e, 'Seller could not be saved'));
    }
  };

  return (
    <div class="screen">
      <div class="main no-sticky-action">
        <h1 class="text-2xl font-semibold mb-3">Sellers</h1>
        <div class="text-sm text-ink-light mb-3">Stock borrowed from or lent to other sellers, and what is left to settle.</div>
        <div class="card mb-4">
          <label class="form-label" for="seller-name">New seller</label>
          <input id="seller-name" class="form-input mb-3" value={name} maxLength={200} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          <button class="btn btn-primary btn-lg" type="button" disabled={!name.trim()} onClick={() => void add()}>Add seller</button>
        </div>
        {error && <div class="error-message mb-3" role="alert">{error}</div>}
        {sellers.map((s) => (
          <button key={s.id} type="button" class="card mb-3 w-full text-left" onClick={() => setSelected(s.id)}>
            <div class="flex justify-between">
              <span class="font-semibold">{s.name}</span>
              <span class={s.balancePaise < 0 ? 'text-sm font-semibold text-danger' : 'text-sm text-ink-light'}>{balanceText(s.balancePaise)}</span>
            </div>
          </button>
        ))}
        {sellers.length === 0 && !error && <div class="text-ink-light">No sellers yet.</div>}
      </div>
    </div>
  );
}

type Line = { productId: string; quantity: string; value: string };
const NEW_PRODUCT = 'new';

function TransferForm({ sellerId, direction, onDone, onCancel }: {
  sellerId: number; direction: 'in' | 'out'; onDone: (seller: SellerDTO) => void; onCancel: () => void;
}) {
  const [products, setProducts] = useState<readonly ProductDTO[]>([]);
  const [lines, setLines] = useState<Line[]>([{ productId: '', quantity: '1', value: '' }]);
  const [newName, setNewName] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGetJson<{ items: ProductDTO[] }>('/products?active=active&limit=1000').then((r) => setProducts(r.items)).catch((e) => setError(errText(e, 'Products could not be loaded')));
  }, []);

  const update = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pick = (i: number, productId: string) => {
    const product = products.find((p) => String(p.id) === productId);
    update(i, { productId, value: product ? String(product.pricePaise / 100) : lines[i]!.value });
  };

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      // A product we have never stocked is created empty first; the transfer then brings the stock in.
      const items: SellerTransferRequest['items'][number][] = [];
      for (const l of lines) {
        let productId = Number(l.productId);
        if (l.productId === NEW_PRODUCT) {
          const created: CreateProductRequest = { sku: null, name: newName, category: null, pricePaise: toPaise(l.value), lowStockLevel: 0, quantity: 0, active: true };
          productId = (await apiPostJson<ProductDTO>('/products', created)).id;
        }
        items.push({ productId, quantity: Number(l.quantity), unitValuePaise: toPaise(l.value) });
      }
      const request: SellerTransferRequest = { direction, items, note };
      onDone(await apiPostJson<SellerDTO>(`/sellers/${sellerId}/transfers`, request));
    } catch (e) {
      setError(errText(e, 'Could not save'));
      setBusy(false);
    }
  };

  const hasNew = lines.some((l) => l.productId === NEW_PRODUCT);
  return (
    <div class="card mb-4">
      <h2 class="text-md font-semibold mb-3">{direction === 'in' ? 'Stock received from seller' : 'Stock given to seller'}</h2>
      {lines.map((l, i) => (
        <div key={i} class="mb-3 pb-3 border-b border-line">
          <label class="form-label" for={`line-product-${i}`}>Product</label>
          <select id={`line-product-${i}`} class="form-input mb-2" value={l.productId} onChange={(e) => pick(i, (e.target as HTMLSelectElement).value)}>
            <option value="">Choose…</option>
            {direction === 'in' && <option value={NEW_PRODUCT}>+ New product (not in my stock)</option>}
            {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.quantity} in stock)</option>)}
          </select>
          <div class="flex gap-2">
            <div class="flex-1">
              <label class="form-label" for={`line-qty-${i}`}>Quantity</label>
              <input id={`line-qty-${i}`} type="number" class="form-input" min={1} step={1} inputMode="numeric" value={l.quantity}
                onInput={(e) => update(i, { quantity: (e.target as HTMLInputElement).value })} />
            </div>
            <div class="flex-1">
              <label class="form-label" for={`line-value-${i}`}>Value each (₹)</label>
              <input id={`line-value-${i}`} type="number" class="form-input" min={0} step="0.01" inputMode="decimal" value={l.value}
                onInput={(e) => update(i, { value: (e.target as HTMLInputElement).value })} />
            </div>
          </div>
          {lines.length > 1 && <button class="btn btn-ghost btn-sm mt-2" type="button" onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove</button>}
        </div>
      ))}
      {hasNew && (
        <div class="form-group">
          <label class="form-label" for="new-product-name">New product name</label>
          <input id="new-product-name" class="form-input" value={newName} maxLength={200} onInput={(e) => setNewName((e.target as HTMLInputElement).value)} />
          <div class="text-xs text-ink-light">Created with this value as its selling price; edit it later in Products.</div>
        </div>
      )}
      <button class="btn btn-secondary btn-sm mb-3" type="button" onClick={() => setLines([...lines, { productId: '', quantity: '1', value: '' }])}>Add another product</button>
      <div class="form-group">
        <label class="form-label" for="transfer-note">Note (optional)</label>
        <input id="transfer-note" class="form-input" value={note} maxLength={500} onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
      </div>
      {error && <div class="error-message mb-3" role="alert">{error}</div>}
      <button class="btn btn-primary btn-lg" type="button" disabled={busy || lines.some((l) => !l.productId)} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
      <button class="btn btn-secondary btn-lg mt-3" type="button" disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
  );
}

function SellerDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const [seller, setSeller] = useState<SellerDTO | null>(null);
  const [form, setForm] = useState<'in' | 'out' | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('upi');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGetJson<SellerDTO>(`/sellers/${id}`).then(setSeller).catch((e) => setError(errText(e, 'Seller could not be loaded')));
  }, [id]);

  if (!seller) {
    return <div class="screen"><div class="main no-sticky-action">{error ? <div class="error-message" role="alert">{error}</div> : 'Loading…'}</div></div>;
  }

  const pay = async () => {
    setError(null);
    setBusy(true);
    // Money always moves toward zero: if we owe them we pay, otherwise they pay us.
    const request: SellerPaymentRequest = {
      direction: seller.balancePaise < 0 ? 'paid' : 'received', amountPaise: toPaise(amount), paymentMethod: method,
    };
    try {
      setSeller(await apiPostJson<SellerDTO>(`/sellers/${id}/payments`, request));
      setAmount('');
    } catch (e) {
      setError(errText(e, 'Could not save'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="screen">
      <div class="main no-sticky-action">
        <button class="btn btn-ghost btn-sm mb-3" type="button" onClick={onBack}>← All sellers</button>
        <h1 class="text-2xl font-semibold mb-3">{seller.name}</h1>
        <div class="card mb-4">
          <div class="font-semibold">{balanceText(seller.balancePaise)}</div>
          <div class="text-xs text-ink-light">Settle with stock either way, or with cash/UPI below.</div>
        </div>

        {form ? (
          <TransferForm sellerId={id} direction={form} onCancel={() => setForm(null)} onDone={(s) => { setSeller(s); setForm(null); }} />
        ) : (
          <div class="flex gap-2 mb-4">
            <button class="btn btn-primary flex-1" type="button" onClick={() => setForm('in')}>Received stock</button>
            <button class="btn btn-primary flex-1" type="button" onClick={() => setForm('out')}>Gave stock</button>
          </div>
        )}

        {seller.balancePaise !== 0 && (
          <div class="card mb-4">
            <h2 class="text-md font-semibold mb-3">{seller.balancePaise < 0 ? 'Pay seller' : 'Seller paid you'}</h2>
            <div class="form-group">
              <label class="form-label" for="seller-amount">Amount (₹)</label>
              <input id="seller-amount" type="number" class="form-input" min={0.01} step="0.01" inputMode="decimal" value={amount}
                onInput={(e) => setAmount((e.target as HTMLInputElement).value)} />
              <button class="btn btn-ghost btn-sm mt-1" type="button" onClick={() => setAmount(String(Math.abs(seller.balancePaise) / 100))}>Full balance</button>
            </div>
            <div class="form-group">
              <label class="form-label" for="seller-method">Method</label>
              <select id="seller-method" class="form-input" value={method} onChange={(e) => setMethod((e.target as HTMLSelectElement).value as PaymentMethod)}>
                {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}
              </select>
            </div>
            <button class="btn btn-primary btn-lg" type="button" disabled={busy || toPaise(amount) <= 0} onClick={() => void pay()}>Record payment</button>
          </div>
        )}
        {error && <div class="error-message mb-3" role="alert">{error}</div>}

        <div class="card mb-4">
          <h2 class="text-md font-semibold mb-3">History</h2>
          {seller.entries.length === 0 && <div class="text-sm text-ink-light">Nothing yet</div>}
          {seller.entries.map((e) => (
            <div key={`${e.type}-${e.id}`} class="py-2 border-b border-line last:border-b-0">
              {e.type === 'transfer' ? (
                <>
                  <div class="font-semibold">{e.direction === 'in' ? 'Received' : 'Gave'} · {formatInr(e.valuePaise)}</div>
                  {e.items.map((it, i) => <div key={i} class="text-sm">{it.quantity} × {it.productName} @ {formatInr(it.unitValuePaise)}</div>)}
                  {e.note && <div class="text-sm text-ink-light">{e.note}</div>}
                </>
              ) : (
                <div class="font-semibold">
                  {e.direction === 'paid' ? 'You paid' : 'They paid'} {formatInr(e.amountPaise)} · {PAYMENT_METHOD_LABELS[e.paymentMethod as PaymentMethod] ?? e.paymentMethod}
                </div>
              )}
              <div class="text-xs text-ink-light">{fmtDate(e.occurredAt)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'preact/hooks';
import type { LidReferenceDTO } from '../../shared/contracts';
import { apiGetJson } from '../api';
import { formatInr } from '../domain';
import { SearchIcon } from '../icons';

type LidResponse = { items: LidReferenceDTO[]; total: number };

export function LidLookup() {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<LidReferenceDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (nextQuery: string, offset = 0) => {
    offset === 0 ? setLoading(true) : setLoadingMore(true);
    setError(null);
    try {
      const data = await apiGetJson<LidResponse>(`/lids?q=${encodeURIComponent(nextQuery)}&limit=50&offset=${offset}`);
      setItems((current) => offset === 0 ? data.items : [...current, ...data.items]);
      setTotal(data.total);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load LIDS prices');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => { void load(''); }, []);

  const submit = (event: Event) => {
    event.preventDefault();
    const nextQuery = input.trim();
    setQuery(nextQuery);
    void load(nextQuery);
  };

  const reset = () => {
    setInput('');
    setQuery('');
    void load('');
  };

  return (
    <div class="screen">
      <div class="main no-sticky-action">
        <h1 class="text-2xl font-semibold mb-2">LIDS price lookup</h1>
        <p class="text-sm text-ink-light mb-4">Reference prices only. These items are not inventory stock.</p>

        <form class="sales-search-form mb-4" onSubmit={submit} role="search">
          <div class="search-input">
            <SearchIcon />
            <input type="search" class="form-input" value={input}
              onInput={(event) => setInput((event.target as HTMLInputElement).value)}
              placeholder="Search description, item code or order code…" aria-label="Search LIDS prices" />
          </div>
          <div class="sales-search-actions">
            <button class="btn btn-navy" type="submit">Search</button>
            <button class="btn btn-secondary" type="button" onClick={reset}
              disabled={!input && !query}>Reset</button>
          </div>
        </form>

        {error && <div class="error-message mb-4" role="alert">{error}</div>}
        {!loading && !error && <p class="text-sm text-ink-light mb-4">{total} {total === 1 ? 'result' : 'results'}{query ? ` for “${query}”` : ''}</p>}

        {loading ? <p class="text-ink-light" role="status">Loading LIDS prices…</p> : items.length === 0 && !error ? (
          <div class="empty-state"><h2 class="empty-state-title">No LIDS item found</h2><p class="empty-state-message">Try part of the description or an item code.</p></div>
        ) : items.map((item) => (
          <article key={item.id} class="card mb-3">
            <div class="flex justify-between items-start gap-3">
              <div>
                <h2 class="font-semibold">{item.description}</h2>
                <div class="text-sm text-ink-light">Item code: {item.itemCode}</div>
                {item.orderCode && <div class="text-sm text-ink-light">Order code: {item.orderCode}</div>}
              </div>
              <div class="font-semibold text-lg">{formatInr(item.displayPricePaise)}</div>
            </div>
            {item.promotion && <p class="text-sm mt-3">{item.promotion}</p>}
            <div class="text-sm text-ink-light mt-3">
              MRP {formatInr(item.mrpPaise)} · SP {item.specialPricePaise === 0 ? 'not listed' : formatInr(item.specialPricePaise)} · CP {formatInr(item.consultantPricePaise)}
              {item.specialPricePaise === 0 && ' · Showing MRP'}
            </div>
          </article>
        ))}

        {items.length < total && (
          <button class="btn btn-secondary btn-lg" type="button" disabled={loadingMore}
            onClick={() => void load(query, items.length)}>{loadingMore ? 'Loading…' : 'Load more'}</button>
        )}
      </div>
    </div>
  );
}

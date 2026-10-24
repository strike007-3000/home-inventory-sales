import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ReportsDTO } from '../../shared/contracts';
import { apiGetJson } from '../api';
import { formatInr } from '../domain';

type Tab = 'sales' | 'products' | 'outstanding';
type Preset = 'this-month' | 'last-month' | 'last-30' | 'custom';
type Bucket = 'day' | 'week' | 'month';

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'last-30', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom' },
];

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

function presetRange(preset: Exclude<Preset, 'custom'>): [string, string] {
  const now = new Date();
  if (preset === 'this-month') return [iso(new Date(now.getFullYear(), now.getMonth(), 1)), iso(now)];
  if (preset === 'last-month') {
    return [iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)), iso(new Date(now.getFullYear(), now.getMonth(), 0))];
  }
  return [iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29)), iso(now)];
}

function bucketKey(date: string, bucket: Bucket): string {
  if (bucket === 'day') return date;
  if (bucket === 'month') return date.slice(0, 7);
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // Monday of that week
  return d.toISOString().slice(0, 10);
}

// Prefix risky leading characters so spreadsheets don't evaluate user-entered text as formulas.
function csvCell(value: string | number): string {
  const text = String(value);
  const safe = /^[=+\-@\t\r]/.test(text) && typeof value === 'string' ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function downloadCsv(filename: string, header: string[], rows: (string | number)[][]) {
  const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const rupees = (paise: number) => (paise / 100).toFixed(2);

function Delta({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) return <span class="summary-label">{current === 0 ? 'No prior sales' : 'New vs prior period'}</span>;
  const pct = Math.round(((current - previous) / previous) * 100);
  return <span class={`status-chip ${pct >= 0 ? 'status-chip-success' : 'status-chip-out-of-stock'}`}>{pct >= 0 ? '+' : ''}{pct}% vs prior</span>;
}

interface ReportsScreenProps {
  onOpenSale: (saleId: number) => void;
}

export function ReportsScreen({ onOpenSale }: ReportsScreenProps) {
  const [tab, setTab] = useState<Tab>('sales');
  const [preset, setPreset] = useState<Preset>('this-month');
  const [range, setRange] = useState<[string, string]>(() => presetRange('this-month'));
  const [bucket, setBucket] = useState<Bucket>('day');
  const [data, setData] = useState<ReportsDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [from, to] = range;

  useEffect(() => {
    if (!from || !to || from > to) return;
    let cancelled = false;
    setError(null);
    apiGetJson<ReportsDTO>(`/reports?from=${from}&to=${to}`)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((err: Error) => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [from, to]);

  const series = useMemo(() => {
    const map = new Map<string, { count: number; totalPaise: number }>();
    for (const row of data?.daily ?? []) {
      const key = bucketKey(row.date, bucket);
      const entry = map.get(key) ?? { count: 0, totalPaise: 0 };
      entry.count += row.count;
      entry.totalPaise += row.totalPaise;
      map.set(key, entry);
    }
    return [...map].map(([key, v]) => ({ key, ...v }));
  }, [data, bucket]);
  const maxBar = Math.max(1, ...series.map((r) => r.totalPaise));

  const choosePreset = (next: Preset) => {
    setPreset(next);
    if (next !== 'custom') setRange(presetRange(next));
  };

  const exportCurrent = () => {
    if (!data) return;
    const stamp = `${data.from}_${data.to}`;
    if (tab === 'sales') {
      downloadCsv(`sales-${bucket}-${stamp}.csv`, [bucket === 'day' ? 'Date' : bucket === 'week' ? 'Week starting' : 'Month', 'Sales', 'Revenue (INR)'],
        series.map((r) => [r.key, r.count, rupees(r.totalPaise)]));
    } else if (tab === 'products') {
      downloadCsv(`top-products-${stamp}.csv`, ['Product', 'Units sold', 'Revenue (INR)'],
        data.topProducts.map((r) => [r.name, r.units, rupees(r.revenuePaise)]));
    } else {
      downloadCsv(`outstanding-${iso(new Date())}.csv`, ['Sale', 'Date', 'Customer', 'Total (INR)', 'Paid (INR)', 'Balance (INR)'],
        data.outstanding.map((r) => [r.saleNumber, r.saleDate, r.customerName ?? '', rupees(r.totalPaise), rupees(r.paidPaise), rupees(r.balancePaise)]));
    }
  };

  const outstandingTotal = data?.outstanding.reduce((sum, r) => sum + r.balancePaise, 0) ?? 0;
  const avg = data && data.summary.count > 0 ? Math.round(data.summary.revenuePaise / data.summary.count) : 0;

  return (
    <div class="screen">
      <div class="main no-sticky-action">
        <div class="page-header">
          <h1 class="text-2xl font-semibold">Reports</h1>
          <div class="header-actions">
            <button class="btn btn-navy btn-sm" type="button" onClick={exportCurrent} disabled={!data}>Export CSV</button>
          </div>
        </div>

        <div class="sales-filter-pills report-pills" role="group" aria-label="Date range">
          {PRESETS.map((p) => (
            <button key={p.value} type="button" class={`filter-pill ${preset === p.value ? 'selected' : ''}`} onClick={() => choosePreset(p.value)}>{p.label}</button>
          ))}
        </div>
        {preset === 'custom' && (
          <div class="report-range">
            <input type="date" class="form-input" aria-label="From date" value={from} max={to} onInput={(e) => setRange([(e.target as HTMLInputElement).value, to])} />
            <input type="date" class="form-input" aria-label="To date" value={to} min={from} onInput={(e) => setRange([from, (e.target as HTMLInputElement).value])} />
          </div>
        )}

        <div class="sales-filter-pills report-pills" role="tablist" aria-label="Report">
          {(['sales', 'products', 'outstanding'] as Tab[]).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} class={`filter-pill ${tab === t ? 'selected' : ''}`} onClick={() => setTab(t)}>
              {t === 'sales' ? 'Sales' : t === 'products' ? 'Products' : 'Outstanding'}
            </button>
          ))}
        </div>

        {error && <p class="dashboard-refresh-message" role="alert">{error}</p>}
        {!data && !error && <p class="text-ink-light">Loading…</p>}

        {data && tab === 'sales' && (
          <>
            <div class="report-stats">
              <div class="card"><div class="summary-value">{formatInr(data.summary.revenuePaise)}</div><div class="summary-label">Revenue</div><Delta current={data.summary.revenuePaise} previous={data.previous.revenuePaise} /></div>
              <div class="card"><div class="summary-value">{data.summary.count}</div><div class="summary-label">Sales</div><Delta current={data.summary.count} previous={data.previous.count} /></div>
              <div class="card"><div class="summary-value">{formatInr(avg)}</div><div class="summary-label">Average sale</div></div>
              <div class="card"><div class="summary-value">{formatInr(data.summary.discountPaise)}</div><div class="summary-label">Discounts</div></div>
            </div>
            <div class="sales-filter-pills report-pills" role="group" aria-label="Group by">
              {(['day', 'week', 'month'] as Bucket[]).map((b) => (
                <button key={b} type="button" class={`filter-pill ${bucket === b ? 'selected' : ''}`} onClick={() => setBucket(b)}>{b === 'day' ? 'Daily' : b === 'week' ? 'Weekly' : 'Monthly'}</button>
              ))}
            </div>
            {series.length === 0 ? <p class="empty-state">No sales in this period.</p> : (
              <div class="report-rows">
                {series.map((r) => (
                  <div class="report-row" key={r.key}>
                    <div class="report-row-head"><span>{r.key}</span><strong>{formatInr(r.totalPaise)}</strong></div>
                    <div class="report-bar" aria-hidden="true"><span style={{ width: `${(r.totalPaise / maxBar) * 100}%` }} /></div>
                    <div class="summary-label">{r.count} {r.count === 1 ? 'sale' : 'sales'}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {data && tab === 'products' && (
          <>
            <h2 class="report-heading">Top sellers</h2>
            {data.topProducts.length === 0 ? <p class="empty-state">No product sales in this period.</p> : (
              <div class="report-rows">
                {data.topProducts.map((r, i) => (
                  <div class="report-row" key={r.productId}>
                    <div class="report-row-head"><span>{i + 1}. {r.name}</span><strong>{formatInr(r.revenuePaise)}</strong></div>
                    <div class="summary-label">{r.units} sold</div>
                  </div>
                ))}
              </div>
            )}
            <h2 class="report-heading">Not sold in {data.slowDays} days</h2>
            {data.slowProducts.length === 0 ? <p class="empty-state">Everything in stock has sold recently.</p> : (
              <div class="report-rows">
                {data.slowProducts.map((r) => (
                  <div class="report-row" key={r.productId}>
                    <div class="report-row-head"><span>{r.name}</span><span>{r.stock} in stock</span></div>
                    <div class="summary-label">{r.lastSoldDate ? `Last sold ${r.lastSoldDate}` : 'Never sold'}</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {data && tab === 'outstanding' && (
          <>
            <div class="report-stats">
              <div class="card"><div class="summary-value">{formatInr(outstandingTotal)}</div><div class="summary-label">Total outstanding</div></div>
              <div class="card"><div class="summary-value">{data.outstanding.length}</div><div class="summary-label">Unpaid sales</div></div>
            </div>
            {data.outstanding.length === 0 ? <p class="empty-state">No unpaid balances.</p> : (
              <div class="report-rows">
                {data.outstanding.map((r) => (
                  <button type="button" class="report-row report-row-button" key={r.saleId} onClick={() => onOpenSale(r.saleId)}>
                    <div class="report-row-head"><span>{r.customerName || 'No name'}</span><strong>{formatInr(r.balancePaise)}</strong></div>
                    <div class="summary-label">{r.saleNumber} · {r.saleDate} · paid {formatInr(r.paidPaise)} of {formatInr(r.totalPaise)}</div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

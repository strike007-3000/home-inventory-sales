import { useCallback, useEffect, useState } from 'preact/hooks';
import type { CreatePlanRequest, PlanDepositRequest, PlanDTO, PlanSummaryDTO } from '../../shared/contracts';
import { apiGetJson, apiPostJson } from '../api';
import { formatInr, PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type PaymentMethod } from '../domain';

const today = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};
const toPaise = (rupees: string) => Math.round((parseFloat(rupees) || 0) * 100);
const fmtDate = (value: string) => new Date(value).toLocaleDateString('en-IN', { dateStyle: 'medium' });
const STATUS_LABEL = { open: 'Open', redeemed: 'Redeemed', cancelled: 'Cancelled' } as const;

interface PlansScreenProps {
  onRedeem: (plan: PlanDTO) => void;
  onOpenSale: (id: number) => void;
}

export function PlansScreen({ onRedeem, onOpenSale }: PlansScreenProps) {
  const [plans, setPlans] = useState<readonly PlanSummaryDTO[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPlans((await apiGetJson<{ items: PlanSummaryDTO[] }>('/plans')).items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Plans could not be loaded');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (selected !== null) {
    return <PlanDetail id={selected} onBack={() => { setSelected(null); void load(); }} onRedeem={onRedeem} onOpenSale={onOpenSale} />;
  }
  if (creating) {
    return <CreatePlan onCancel={() => setCreating(false)} onCreated={(plan) => { setCreating(false); setSelected(plan.id); }} />;
  }

  const open = plans.filter((p) => p.status === 'open');
  const held = open.reduce((sum, p) => sum + p.savedPaise, 0);
  return (
    <div class="screen">
      <div class="main no-sticky-action">
        <h1 class="text-2xl font-semibold mb-3">Savings plans</h1>
        <div class="text-sm text-ink-light mb-3">
          Customers saving a fixed amount; the product is chosen at the end.
          {open.length > 0 && <> {open.length} open · {formatInr(held)} held.</>}
        </div>
        <button class="btn btn-primary btn-lg mb-4" type="button" onClick={() => setCreating(true)}>New plan</button>
        {error && <div class="error-message mb-3" role="alert">{error}</div>}
        {plans.map((p) => (
          <button key={p.id} type="button" class="card mb-3 w-full text-left" onClick={() => setSelected(p.id)}>
            <div class="flex justify-between">
              <span class="font-semibold">{p.customerName}</span>
              <span class="text-sm text-ink-light">{STATUS_LABEL[p.status]}</span>
            </div>
            <div class="text-sm text-ink-light">
              {formatInr(p.monthlyPaise)}/month · started {fmtDate(p.startDate)} · saved {formatInr(p.savedPaise)}
              {p.months ? ` of ${formatInr(p.monthlyPaise * p.months)}` : ''}
            </div>
          </button>
        ))}
        {plans.length === 0 && !error && <div class="text-ink-light">No plans yet.</div>}
      </div>
    </div>
  );
}

function CreatePlan({ onCancel, onCreated }: { onCancel: () => void; onCreated: (plan: PlanDTO) => void }) {
  const [name, setName] = useState('');
  const [monthly, setMonthly] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [months, setMonths] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const request: CreatePlanRequest = {
        customerName: name, monthlyPaise: toPaise(monthly), startDate, months: months ? Number(months) : null,
      };
      onCreated(await apiPostJson<PlanDTO>('/plans', request));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Plan could not be saved');
      setSaving(false);
    }
  };

  return (
    <div class="screen">
      <div class="main no-sticky-action">
        <h1 class="text-2xl font-semibold mb-3">New savings plan</h1>
        <div class="card">
          <div class="form-group">
            <label class="form-label" for="plan-name">Customer name</label>
            <input id="plan-name" class="form-input" value={name} maxLength={200} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          </div>
          <div class="form-group">
            <label class="form-label" for="plan-monthly">Amount per month (₹)</label>
            <input id="plan-monthly" type="number" class="form-input" min={0.01} step="0.01" inputMode="decimal" value={monthly}
              onInput={(e) => setMonthly((e.target as HTMLInputElement).value)} />
          </div>
          <div class="form-group">
            <label class="form-label" for="plan-start">Start date</label>
            <input id="plan-start" type="date" class="form-input" value={startDate} onInput={(e) => setStartDate((e.target as HTMLInputElement).value)} />
          </div>
          <div class="form-group">
            <label class="form-label" for="plan-months">Number of months (optional)</label>
            <input id="plan-months" type="number" class="form-input" min={1} max={120} step={1} inputMode="numeric" value={months}
              onInput={(e) => setMonths((e.target as HTMLInputElement).value)} />
          </div>
          {error && <div class="error-message mb-3" role="alert">{error}</div>}
          <button class="btn btn-primary btn-lg" type="button" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Create plan'}</button>
          <button class="btn btn-secondary btn-lg mt-3" type="button" disabled={saving} onClick={onCancel}>Back</button>
        </div>
      </div>
    </div>
  );
}

interface PlanDetailProps {
  id: number;
  onBack: () => void;
  onRedeem: (plan: PlanDTO) => void;
  onOpenSale: (id: number) => void;
}

function PlanDetail({ id, onBack, onRedeem, onOpenSale }: PlanDetailProps) {
  const [plan, setPlan] = useState<PlanDTO | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('upi');
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiGetJson<PlanDTO>(`/plans/${id}`).then(setPlan).catch((e) => setError(e instanceof Error ? e.message : 'Plan could not be loaded'));
  }, [id]);

  const run = async (action: () => Promise<PlanDTO>, done?: () => void) => {
    setError(null);
    setBusy(true);
    try {
      setPlan(await action());
      done?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const addDeposit = () => {
    const request: PlanDepositRequest = { amountPaise: toPaise(amount), paymentMethod: method, receivedDate: date };
    return run(() => apiPostJson<PlanDTO>(`/plans/${id}/deposits`, request), () => setAmount(''));
  };

  if (!plan) {
    return <div class="screen"><div class="main no-sticky-action">{error ? <div class="error-message" role="alert">{error}</div> : 'Loading…'}</div></div>;
  }

  const isOpen = plan.status === 'open';
  const target = plan.months ? plan.monthlyPaise * plan.months : null;
  let running = 0;
  return (
    <div class="screen">
      <div class="main no-sticky-action">
        <button class="btn btn-ghost btn-sm mb-3" type="button" onClick={onBack}>← All plans</button>
        <h1 class="text-2xl font-semibold mb-3">{plan.customerName}</h1>
        <div class="card mb-4">
          <div class="flex justify-between"><span>Status</span><span class="font-semibold">{STATUS_LABEL[plan.status]}</span></div>
          <div class="flex justify-between"><span>Per month</span><span>{formatInr(plan.monthlyPaise)}</span></div>
          <div class="flex justify-between"><span>Started</span><span>{fmtDate(plan.startDate)}</span></div>
          <div class="flex justify-between font-semibold border-t border-line pt-2 mt-2">
            <span>Saved</span><span>{formatInr(plan.savedPaise)}{target ? ` of ${formatInr(target)}` : ''}</span>
          </div>
          <div class="text-sm text-ink-light">{Math.floor(plan.savedPaise / plan.monthlyPaise)} monthly instalments covered{plan.months ? ` of ${plan.months}` : ''}</div>
          {plan.refundPaise > 0 && <div class="mt-2 font-semibold">Refund due to customer: {formatInr(plan.refundPaise)}</div>}
          {plan.cancellationReason && <div class="text-sm mt-2">Reason: {plan.cancellationReason}</div>}
          {plan.saleId && <button class="btn btn-secondary btn-sm mt-3" type="button" onClick={() => onOpenSale(plan.saleId!)}>View sale</button>}
        </div>

        <div class="card mb-4">
          <h2 class="text-md font-semibold mb-3">Deposits</h2>
          {plan.deposits.length === 0 && <div class="text-sm text-ink-light">No deposits yet</div>}
          {plan.deposits.map((d) => {
            running += d.amountPaise;
            return (
              <div key={d.id} class="py-2 border-b border-line last:border-b-0">
                <div class="font-semibold">{formatInr(d.amountPaise)} · {PAYMENT_METHOD_LABELS[d.paymentMethod as PaymentMethod] ?? d.paymentMethod}</div>
                <div class="text-xs text-ink-light">{fmtDate(d.receivedAt)} · Saved so far {formatInr(running)}</div>
              </div>
            );
          })}
        </div>

        {error && <div class="error-message mb-3" role="alert">{error}</div>}

        {isOpen && (
          <>
            <div class="card mb-4">
              <h2 class="text-lg font-semibold mb-3">Add deposit</h2>
              <div class="form-group">
                <label class="form-label" for="deposit-amount">Amount received (₹)</label>
                <input id="deposit-amount" type="number" class="form-input" min={0.01} step="0.01" inputMode="decimal"
                  value={amount} placeholder={(plan.monthlyPaise / 100).toFixed(2)} onInput={(e) => setAmount((e.target as HTMLInputElement).value)} />
              </div>
              <div class="form-group">
                <label class="form-label" for="deposit-date">Date received</label>
                <input id="deposit-date" type="date" class="form-input" max={today()} value={date} onInput={(e) => setDate((e.target as HTMLInputElement).value)} />
              </div>
              <div class="payment-methods" role="group" aria-label="Payment method">
                {PAYMENT_METHODS.map((m) => (
                  <button key={m} type="button" class={`payment-pill ${method === m ? 'selected' : ''}`} aria-pressed={method === m} onClick={() => setMethod(m)}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </button>
                ))}
              </div>
              <button class="btn btn-primary btn-lg mt-4" type="button" disabled={busy} onClick={() => void addDeposit()}>Save deposit</button>
            </div>

            <button class="btn btn-primary btn-lg" type="button" disabled={plan.savedPaise === 0} onClick={() => onRedeem(plan)}>
              Redeem — choose products
            </button>

            {reason === null ? (
              <button class="btn btn-danger btn-lg mt-4" type="button" onClick={() => setReason('')}>Cancel plan</button>
            ) : (
              <div class="card mt-4">
                <label class="form-label" for="plan-cancel-reason">Reason for cancelling</label>
                <input id="plan-cancel-reason" class="form-input" value={reason} maxLength={500} onInput={(e) => setReason((e.target as HTMLInputElement).value)} />
                <div class="text-sm text-ink-light mt-2">The full {formatInr(plan.savedPaise)} will be marked as refund due.</div>
                <button class="btn btn-danger btn-lg mt-3" type="button" disabled={busy}
                  onClick={() => void run(() => apiPostJson<PlanDTO>(`/plans/${id}/cancel`, { reason }), () => setReason(null))}>
                  Confirm cancel plan
                </button>
                <button class="btn btn-secondary btn-lg mt-3" type="button" onClick={() => setReason(null)}>Keep plan</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

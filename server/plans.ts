import type { CancelSaleRequest, CreatePlanRequest, PlanDepositRequest, PlanDTO, PlanSummaryDTO } from '../shared/contracts';
import { errorResponse, jsonResponse, requireJsonBody } from './validation';

type PlanRow = {
  id: number;
  customer_name: string;
  monthly_minor: number;
  start_date: string;
  months: number | null;
  status: 'open' | 'redeemed' | 'cancelled';
  sale_id: number | null;
  refund_minor: number;
  cancellation_reason: string | null;
  saved_minor: number;
};

const PAYMENT_METHODS = new Set(['upi', 'cash', 'card', 'bank-transfer', 'other']);
const PLAN_SELECT = `SELECT p.id, p.customer_name, p.monthly_minor, p.start_date, p.months, p.status, p.sale_id,
    p.refund_minor, p.cancellation_reason,
    COALESCE((SELECT SUM(amount_minor) FROM plan_deposits WHERE plan_id = p.id), 0) AS saved_minor
  FROM plans p`;

function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function toSummary(row: PlanRow): PlanSummaryDTO {
  return {
    id: row.id,
    customerName: row.customer_name,
    monthlyPaise: row.monthly_minor,
    startDate: row.start_date,
    months: row.months,
    status: row.status,
    savedPaise: row.saved_minor,
    refundPaise: row.refund_minor,
    saleId: row.sale_id,
  };
}

async function readPlan(id: number, env: Env): Promise<PlanDTO | null> {
  const row = await env.DB.prepare(`${PLAN_SELECT} WHERE p.id = ?`).bind(id).first<PlanRow>();
  if (!row) return null;
  const deposits = await env.DB.prepare(
    'SELECT id, amount_minor, payment_method, received_at FROM plan_deposits WHERE plan_id = ? ORDER BY received_at, id',
  ).bind(id).all<{ id: number; amount_minor: number; payment_method: string; received_at: string }>();
  return {
    ...toSummary(row),
    ...(row.cancellation_reason ? { cancellationReason: row.cancellation_reason } : {}),
    deposits: deposits.results.map((d) => ({
      id: d.id, amountPaise: d.amount_minor, paymentMethod: d.payment_method, receivedAt: d.received_at,
    })),
  };
}

export async function handleListPlans(env: Env): Promise<Response> {
  const rows = await env.DB.prepare(`${PLAN_SELECT} ORDER BY (p.status = 'open') DESC, p.id DESC LIMIT 500`).all<PlanRow>();
  return jsonResponse({ items: rows.results.map(toSummary) });
}

export async function handleGetPlan(id: number, env: Env): Promise<Response> {
  const plan = await readPlan(id, env);
  return plan ? jsonResponse(plan) : errorResponse('Plan not found', 404);
}

export async function handleCreatePlan(request: Request, env: Env): Promise<Response> {
  const body = await requireJsonBody<CreatePlanRequest>(request);
  if (body instanceof Response) return body;
  const name = typeof body.customerName === 'string' ? body.customerName.trim() : '';
  if (!name || name.length > 200) return errorResponse('Customer name is required and must be at most 200 characters', 400, 'customerName');
  if (!Number.isSafeInteger(body.monthlyPaise) || body.monthlyPaise <= 0) {
    return errorResponse('Monthly amount must be a positive safe integer', 400, 'monthlyPaise');
  }
  if (!isValidDate(body.startDate)) return errorResponse('Start date must be a valid date', 400, 'startDate');
  const months = body.months ?? null;
  if (months !== null && (!Number.isSafeInteger(months) || months <= 0 || months > 120)) {
    return errorResponse('Months must be between 1 and 120', 400, 'months');
  }
  const result = await env.DB.prepare(
    'INSERT INTO plans (customer_name, monthly_minor, start_date, months, created_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(name, body.monthlyPaise, body.startDate, months, new Date().toISOString()).run();
  return jsonResponse(await readPlan(result.meta.last_row_id, env), 201);
}

export async function handleAddDeposit(id: number, request: Request, env: Env): Promise<Response> {
  const body = await requireJsonBody<PlanDepositRequest>(request);
  if (body instanceof Response) return body;
  if (!Number.isSafeInteger(body.amountPaise) || body.amountPaise <= 0) {
    return errorResponse('Deposit amount must be a positive safe integer', 400, 'amountPaise');
  }
  if (!PAYMENT_METHODS.has(body.paymentMethod)) return errorResponse('Invalid payment method', 400, 'paymentMethod');
  if (body.receivedDate !== undefined && !isValidDate(body.receivedDate)) {
    return errorResponse('Date must be a valid date', 400, 'receivedDate');
  }
  const now = new Date().toISOString();
  if (body.receivedDate && body.receivedDate > now.slice(0, 10)) return errorResponse('Date cannot be in the future', 400, 'receivedDate');
  // shortcut: a backdated deposit is stored at noon UTC, so only its date is meaningful.
  const receivedAt = body.receivedDate && body.receivedDate !== now.slice(0, 10) ? `${body.receivedDate}T12:00:00.000Z` : now;

  const inserted = await env.DB.prepare(
    `INSERT INTO plan_deposits (plan_id, amount_minor, payment_method, received_at)
     SELECT id, ?, ?, ? FROM plans WHERE id = ? AND status = 'open'`,
  ).bind(body.amountPaise, body.paymentMethod, receivedAt, id).run();
  if ((inserted.meta.changes ?? 0) !== 1) {
    const plan = await readPlan(id, env);
    return plan ? errorResponse('Plan is closed', 409) : errorResponse('Plan not found', 404);
  }
  return jsonResponse(await readPlan(id, env), 201);
}

export async function handleCancelPlan(id: number, request: Request, env: Env): Promise<Response> {
  const body = await requireJsonBody<CancelSaleRequest>(request);
  if (body instanceof Response) return body;
  const reason = body.reason?.trim();
  if (!reason || reason.length > 500) return errorResponse('Cancellation reason is required and must be at most 500 characters', 400, 'reason');
  // The whole saved amount is owed back to the customer.
  const result = await env.DB.prepare(
    `UPDATE plans SET status = 'cancelled', cancellation_reason = ?, closed_at = ?,
       refund_minor = (SELECT COALESCE(SUM(amount_minor), 0) FROM plan_deposits WHERE plan_id = plans.id)
     WHERE id = ? AND status = 'open'`,
  ).bind(reason, new Date().toISOString(), id).run();
  if ((result.meta.changes ?? 0) !== 1) {
    const plan = await readPlan(id, env);
    return plan ? errorResponse('Plan is closed', 409) : errorResponse('Plan not found', 404);
  }
  return jsonResponse(await readPlan(id, env));
}

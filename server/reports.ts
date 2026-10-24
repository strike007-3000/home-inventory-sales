import type { ReportsDTO } from '../shared/contracts';
import { errorResponse, jsonResponse } from './validation';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const SLOW_DAYS = 60;
const TOP_LIMIT = 50;

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

async function summarise(env: Env, from: string, to: string) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS count, COALESCE(SUM(total_minor), 0) AS revenue,
            COALESCE(SUM(discount_minor), 0) AS discount
     FROM sales WHERE status = 'completed' AND sale_date BETWEEN ? AND ?`,
  ).bind(from, to).first<{ count: number; revenue: number; discount: number }>();
  return { count: row?.count ?? 0, revenuePaise: row?.revenue ?? 0, discountPaise: row?.discount ?? 0 };
}

export async function handleReports(url: URL, env: Env): Promise<Response> {
  const from = url.searchParams.get('from') ?? '';
  const to = url.searchParams.get('to') ?? '';
  if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
    return errorResponse('Report range must use YYYY-MM-DD with from <= to', 400, 'from');
  }
  const spanDays = Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
  if (spanDays > 1100) return errorResponse('Report range is too long', 400, 'to');
  const prevTo = shiftDate(from, -1);
  const prevFrom = shiftDate(from, -spanDays);

  const [summary, previous, daily, top, slow, outstanding, outstandingTotals] = await Promise.all([
    summarise(env, from, to),
    summarise(env, prevFrom, prevTo),
    env.DB.prepare(
      `SELECT sale_date AS date, COUNT(*) AS count, SUM(total_minor) AS total
       FROM sales WHERE status = 'completed' AND sale_date BETWEEN ? AND ?
       GROUP BY sale_date ORDER BY sale_date`,
    ).bind(from, to).all<{ date: string; count: number; total: number }>(),
    env.DB.prepare(
      `SELECT i.product_id AS id, MAX(i.product_name_snapshot) AS name,
              SUM(i.quantity) AS units, SUM(ROUND(i.line_total_minor * 1.0 * s.total_minor / COALESCE(NULLIF(s.subtotal_minor, 0), 1))) AS revenue
       FROM sale_items i JOIN sales s ON s.id = i.sale_id
       WHERE s.status = 'completed' AND s.sale_date BETWEEN ? AND ?
       GROUP BY i.product_id ORDER BY revenue DESC, units DESC LIMIT ?`,
    ).bind(from, to, TOP_LIMIT).all<{ id: number; name: string; units: number; revenue: number }>(),
    // Revenue above is each line's share of the sale's net total, so discounts and gifts are reflected.
    // In-stock sellable products with no completed sale in the SLOW_DAYS before `to`.
    env.DB.prepare(
      `SELECT p.id, p.name, p.stock_quantity AS stock,
              (SELECT MAX(s.sale_date) FROM sale_items i JOIN sales s ON s.id = i.sale_id
               WHERE i.product_id = p.id AND s.status = 'completed' AND s.sale_date <= ?) AS last_sold
       FROM products p
       WHERE p.active = 1 AND p.personal_use = 0 AND p.stock_quantity > 0
         AND substr(p.created_at, 1, 10) <= ?
         AND NOT EXISTS (SELECT 1 FROM sale_items i JOIN sales s ON s.id = i.sale_id
                         WHERE i.product_id = p.id AND s.status = 'completed'
                           AND s.sale_date BETWEEN ? AND ?)
       ORDER BY last_sold IS NOT NULL, last_sold, p.name LIMIT 200`,
    ).bind(to, to, shiftDate(to, -(SLOW_DAYS - 1)), to).all<{ id: number; name: string; stock: number; last_sold: string | null }>(),
    env.DB.prepare(
      `SELECT s.id, s.sale_number, s.sale_date, s.customer_name, s.total_minor,
              COALESCE(SUM(p.amount_minor), 0) AS paid
       FROM sales s LEFT JOIN sale_payments p ON p.sale_id = s.id
       WHERE s.status = 'completed' AND s.is_gift = 0
       GROUP BY s.id HAVING s.total_minor > paid
       ORDER BY s.sale_date, s.id LIMIT 500`,
    ).all<{ id: number; sale_number: string; sale_date: string; customer_name: string | null; total_minor: number; paid: number }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total_minor - paid), 0) AS balance FROM (
         SELECT s.total_minor, COALESCE(SUM(p.amount_minor), 0) AS paid
         FROM sales s LEFT JOIN sale_payments p ON p.sale_id = s.id
         WHERE s.status = 'completed' AND s.is_gift = 0
         GROUP BY s.id HAVING s.total_minor > paid)`,
    ).first<{ count: number; balance: number }>(),
  ]);

  const body: ReportsDTO = {
    from,
    to,
    summary,
    previous,
    daily: daily.results.map((r) => ({ date: r.date, count: r.count, totalPaise: r.total })),
    topProducts: top.results.map((r) => ({ productId: r.id, name: r.name, units: r.units, revenuePaise: r.revenue })),
    slowDays: SLOW_DAYS,
    slowProducts: slow.results.map((r) => ({ productId: r.id, name: r.name, stock: r.stock, lastSoldDate: r.last_sold })),
    outstandingTotal: { count: outstandingTotals?.count ?? 0, balancePaise: outstandingTotals?.balance ?? 0 },
    outstanding: outstanding.results.map((r) => ({
      saleId: r.id,
      saleNumber: r.sale_number,
      saleDate: r.sale_date,
      customerName: r.customer_name,
      totalPaise: r.total_minor,
      paidPaise: r.paid,
      balancePaise: r.total_minor - r.paid,
    })),
  };
  return jsonResponse(body);
}

import type { LidReferenceDTO } from '../shared/contracts';
import { errorResponse, getQueryParam, jsonResponse } from './validation';

type LidRow = {
  id: number;
  order_code: string | null;
  item_code: string;
  description: string;
  promotion: string | null;
  mrp_minor: number;
  special_price_minor: number;
  consultant_price_minor: number;
  display_price_minor: number;
};

function parseBoundedInteger(url: URL, name: string, fallback: number, minimum: number, maximum: number): number | null {
  const value = url.searchParams.get(name);
  if (value === null) return fallback;
  if (!/^(0|[1-9]\d*)$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function toDTO(row: LidRow): LidReferenceDTO {
  return {
    id: row.id,
    orderCode: row.order_code,
    itemCode: row.item_code,
    description: row.description,
    promotion: row.promotion,
    mrpPaise: row.mrp_minor,
    specialPricePaise: row.special_price_minor,
    consultantPricePaise: row.consultant_price_minor,
    displayPricePaise: row.display_price_minor,
  };
}

export async function handleListLids(url: URL, env: Env): Promise<Response> {
  const query = getQueryParam(url, 'q').trim();
  if (query.length > 100) return errorResponse('Search query must be 100 characters or fewer', 400, 'q');
  const limit = parseBoundedInteger(url, 'limit', 50, 1, 100);
  const offset = parseBoundedInteger(url, 'offset', 0, 0, Number.MAX_SAFE_INTEGER);
  if (limit === null || offset === null) return errorResponse('Invalid pagination parameters', 400);

  const where = query
    ? `WHERE description LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR item_code LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR order_code LIKE ? ESCAPE '\\' COLLATE NOCASE
        OR promotion LIKE ? ESCAPE '\\' COLLATE NOCASE`
    : '';
  const pattern = `%${escapeLike(query)}%`;
  const bindings = query ? [pattern, pattern, pattern, pattern] : [];

  try {
    const [rows, count] = await env.DB.batch([
      env.DB.prepare(
        `SELECT id, order_code, item_code, description, promotion, mrp_minor,
                special_price_minor, consultant_price_minor, display_price_minor
         FROM lid_price_lookup ${where}
         ORDER BY description COLLATE NOCASE, item_code COLLATE NOCASE LIMIT ? OFFSET ?`,
      ).bind(...bindings, limit, offset),
      env.DB.prepare(`SELECT COUNT(*) AS total FROM lid_price_lookup ${where}`).bind(...bindings),
    ]);
    if (!rows || !count) throw new Error('D1 returned an incomplete lookup result');
    const items = (rows.results as LidRow[]).map(toDTO);
    const total = Number((count.results[0] as { total?: number } | undefined)?.total ?? 0);
    return jsonResponse({ items, total, limit, offset });
  } catch (error) {
    console.error('LIDS lookup failed', error instanceof Error ? { name: error.name, message: error.message } : { valueType: typeof error });
    return errorResponse('LIDS lookup failed', 500);
  }
}

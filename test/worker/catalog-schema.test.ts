import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('inventory catalogue schema', () => {
  it('keeps product identity internal while allowing repeated descriptive variants', async () => {
    const location = await env.DB.prepare(
      'SELECT id FROM locations WHERE name = ? COLLATE NOCASE',
    )
      .bind('Test Shelf A')
      .first<{ id: number }>();

    expect(location?.id).toBeTypeOf('number');

    const now = new Date().toISOString();
    const insert = `
      INSERT INTO products (
        name, colour, size, selling_price_minor, cost_price_minor,
        stock_quantity, set_stock_quantity, mrp_minor, location_id,
        personal_use, import_source, import_row_number, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const statements = [1, 2].map((rowNumber) =>
      env.DB.prepare(insert).bind(
        'Clear Bowl',
        'Blue and transparent',
        '210 ml and 480 ml',
        85_000,
        64_600,
        3,
        2,
        90_000,
        location!.id,
        0,
        'stock-july-2026',
        rowNumber,
        now,
        now,
      ),
    );

    await env.DB.batch(statements);

    const duplicates = await env.DB.prepare(
      `SELECT id, stock_quantity, set_stock_quantity
       FROM products
       WHERE name = ? AND colour = ? AND size = ?
       ORDER BY id`,
    )
      .bind('Clear Bowl', 'Blue and transparent', '210 ml and 480 ml')
      .all<{ id: number; stock_quantity: number; set_stock_quantity: number }>();

    expect(duplicates.results).toHaveLength(2);
    expect(duplicates.results[0]?.id).not.toBe(duplicates.results[1]?.id);
    expect(duplicates.results[0]?.stock_quantity).toBe(3);
    expect(duplicates.results[0]?.set_stock_quantity).toBe(2);
  });

  it('supports nullable colour and size plus fractional set stock', async () => {
    const now = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO products (
         name, selling_price_minor, stock_quantity, set_stock_quantity,
         personal_use, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind('Bamboo Glass Canister', 240_000, 3, 1.5, 1, now, now)
      .run();

    const product = await env.DB.prepare(
      `SELECT colour, size, stock_quantity, set_stock_quantity, personal_use
       FROM products WHERE name = ?`,
    )
      .bind('Bamboo Glass Canister')
      .first<{
        colour: string | null;
        size: string | null;
        stock_quantity: number;
        set_stock_quantity: number;
        personal_use: number;
      }>();

    expect(product).toEqual({
      colour: null,
      size: null,
      stock_quantity: 3,
      set_stock_quantity: 1.5,
      personal_use: 1,
    });
  });

  it('keeps LIDS outside inventory and falls back to MRP when SP is zero', async () => {
    const now = new Date().toISOString();
    const insert = `
      INSERT INTO lid_references (
        order_code, item_code, description, promotion, mrp_minor,
        special_price_minor, consultant_price_minor, import_source,
        import_row_number, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await env.DB.batch([
      env.DB.prepare(insert).bind(
        null,
        '21016140024',
        'Mod Mates Oval IV Base',
        'Spare Items',
        48_000,
        0,
        36_500,
        'lids-july-2026',
        4,
        now,
        now,
      ),
      env.DB.prepare(insert).bind(
        '618',
        '980650003401',
        'SS Bowl 600ml',
        'Limited Offer',
        174_000,
        121_800,
        92_600,
        'lids-july-2026',
        20,
        now,
        now,
      ),
    ]);

    const lookup = await env.DB.prepare(
      `SELECT item_code, display_price_minor
       FROM lid_price_lookup ORDER BY item_code`,
    ).all<{ item_code: string; display_price_minor: number }>();

    expect(lookup.results).toEqual([
      { item_code: '21016140024', display_price_minor: 48_000 },
      { item_code: '980650003401', display_price_minor: 121_800 },
    ]);

    const productCount = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM products',
    ).first<{ count: number }>();
    expect(productCount?.count).toBe(0);
  });

  it('supports isolated test locations without production data', async () => {
    const locations = await env.DB.prepare(
      'SELECT name FROM locations ORDER BY name COLLATE NOCASE',
    ).all<{ name: string }>();

    expect(locations.results.map(({ name }) => name)).toEqual(['Test Shelf A', 'Test Shelf B']);
  });
});

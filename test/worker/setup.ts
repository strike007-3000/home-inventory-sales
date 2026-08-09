import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeEach } from 'vitest';

// Clear all tables between tests to guarantee isolation.
// Order respects foreign-key dependencies (children first).
beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sale_items'),
    env.DB.prepare('DELETE FROM sale_cancellations'),
    env.DB.prepare('DELETE FROM stock_entry_items'),
    env.DB.prepare('DELETE FROM stock_movements'),
    env.DB.prepare('DELETE FROM sales'),
    env.DB.prepare('DELETE FROM stock_entries'),
    env.DB.prepare('DELETE FROM import_staging'),
    env.DB.prepare('DELETE FROM products'),
    env.DB.prepare('DELETE FROM login_attempts'),
  ]);
});

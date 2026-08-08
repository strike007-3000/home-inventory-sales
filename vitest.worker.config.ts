import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/worker/**/*.test.ts'],
    setupFiles: ['./test/worker/setup.ts'],
  },
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, 'migrations')),
          PASSWORD_HASH:
            'pbkdf2$sha256$210000$7KNd2M28x7TAlTKg2GWm_g$2MO5lq919TO03d6GhgxZeIdbKumMP__HFOQHXrZ1DuU',
          SESSION_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          SESSION_MAX_AGE_SECONDS: '3600',
          ALLOWED_ORIGINS: 'https://inventory.example.test,http://localhost:5173',
        },
      },
    })),
  ],
});

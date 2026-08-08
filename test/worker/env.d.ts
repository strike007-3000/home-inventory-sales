declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
    PASSWORD_HASH: string;
    SESSION_SECRET: string;
    SESSION_MAX_AGE_SECONDS: string;
    ALLOWED_ORIGINS: string;
  }

  interface Exports {
    default: Fetcher;
  }
}

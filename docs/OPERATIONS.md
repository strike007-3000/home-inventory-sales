# Operations and Deployment

## Deployment resources

Each fork must create and configure its own:

- Cloudflare Worker name and deployment URL
- D1 database and `DB` binding
- allowed production origin
- runtime secrets
- Git repository and production branch

Do not copy another deployment's URL, database identifier, token, or secrets.

## Automatic deployment

Connect Cloudflare Workers Builds to your fork.

- Build command: `npm run check`
- Deploy command: `npx wrangler d1 migrations apply YOUR_D1_DATABASE --remote && npx wrangler deploy`
- Root directory: `/`
- Non-production builds: disabled
- Build cache: enabled

Every push to `main` runs the TypeScript build, unit tests, Worker/D1 tests, applies pending schema migrations, and deploys the Worker. Do not put business-data inserts into committed migrations.

## Secrets and configuration

Runtime secrets are managed in Cloudflare and never committed:

- `PASSWORD_HASH`
- `SESSION_SECRET`

Non-secret settings and the D1 binding are in `wrangler.jsonc`. `.dev.vars` is for local development and is ignored by Git.

Generate a password hash locally:

```bash
node scripts/generate-password-hash.mjs
```

Set production secrets manually when rotating them:

```bash
npx wrangler secret put PASSWORD_HASH
npx wrangler secret put SESSION_SECRET
```

## Database migrations

Create schema migrations in `migrations/` with monotonically increasing names. Validate them locally through `npm run check` before merging. Workers Builds applies pending migrations before deploying dependent code.

One-time inventory, LIDS, customer, sales, payment, or location data must not be committed. Local-only data belongs under `.private/`; production rows are managed directly in D1 or through the application.

## Manual emergency deployment

Use only when Git deployment is unavailable and the change is already verified:

```bash
npm run check
npx wrangler d1 migrations apply YOUR_D1_DATABASE --remote
npx wrangler deploy
```

## Verification

After deployment:

1. Confirm the Workers Build completed.
2. Open your deployment URL and sign in.
3. Verify Home, Products, Sales, LIDS, and Stock navigation.
4. Avoid creating test transactions in production. If an exceptional test record is necessary, cancel it through the application; direct deletion is not a normal workflow.

Useful read-only checks:

```bash
npx wrangler deployments list
npx wrangler d1 migrations list YOUR_D1_DATABASE --remote
```

## Backup and recovery

Cloudflare D1 is the production system of record. User-facing export/restore is not implemented yet, so operational backup and restoration procedures remain a known gap. Do not describe committed migrations as a backup of business data: they restore schema only.

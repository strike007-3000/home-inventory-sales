# Contributing and Local Development

## Ground rules

- Keep interface language plain and touch targets at least 44 CSS pixels.
- Store INR amounts as integer paise.
- Keep QTY authoritative; change stock through sale or stock workflows.
- Preserve audit history. Do not add ordinary delete operations for sales or movements.
- Keep LIDS separate from inventory.
- Avoid new dependencies unless the platform cannot reasonably solve the need.
- Never commit real business data, exports, credentials, or local databases.

## Setup

```bash
npm install
cp .dev.vars.example .dev.vars
node scripts/generate-password-hash.mjs
```

Add the generated password hash and a random session secret to `.dev.vars`.

Run the Worker API and frontend in separate terminals:

```bash
npx wrangler dev --local --port 8787
npm run dev
```

The production D1 database is never used by normal local development.

## Tests

```bash
npm run build
npm run test:unit
npm run test:worker
npm run check
```

Add the smallest relevant test for changes involving stock, sales, money, validation, authentication, migrations, or payment state. Test meaningful UI changes at phone, iPad, and desktop widths.

Synthetic unit fixtures live in `test/fixtures/`. Worker tests create isolated D1 rows in their setup. Do not copy production rows into tests.

## Pull requests

Use a focused branch and explain the problem, change, validation, migration impact, and known limitations. A merge to `main` automatically runs checks, applies pending schema migrations, and deploys production.

Because deployment is automatic, do not merge a schema-dependent code change unless its migration is committed and locally verified.

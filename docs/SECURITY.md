# Security Policy

## Current security model

Home Inventory is a private hosted application for a very small trusted user group.

- Authentication uses one shared password whose PBKDF2 hash is a Cloudflare secret.
- Sessions are signed, `HttpOnly`, `Secure`, and `SameSite=Strict` cookies.
- Mutating API requests require an allowed origin and matching CSRF token.
- Login attempts are rate-limited.
- Production data lives in D1 and is never committed to GitHub.
- Secrets live in Cloudflare or local ignored `.dev.vars` files.

There are no user accounts, roles, registration, invitations, or password-reset flows. Anyone with the shared password has full application access.

## Data handling

Never commit or attach to a public issue:

- production D1 data or exports
- inventory and LIDS business-data seeds
- customer names, sales, or payment records
- real storage-location records
- passwords, hashes, session secrets, cookies, or API tokens
- `.dev.vars`, local SQLite/D1 files, or backups

Use synthetic fixtures in tests. Schema-only migrations are safe to version.

## Reporting a vulnerability

Use GitHub private vulnerability reporting when available. Otherwise request a private contact channel without publishing exploit details. Include the affected commit, reproduction steps, impact, and suggested remediation.

Do not access, change, or retain data that does not belong to you while investigating.

## Supported version

Only the current production deployment from the latest successful `main` build is supported.

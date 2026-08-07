# Cloud Deployment and Operations

## Architecture

```text
Phone / iPad / laptop
        |
        | HTTPS
        v
Cloudflare Worker
  - web UI and application routes
  - shared-password session
  - validation and business logic
        |
        v
Cloudflare D1
  - products
  - sales
  - stock movements
```

Use one TypeScript project and one deployment. A separate frontend host, API proxy, backend service, authentication provider, or realtime service is not required.

## Cost model

The target is EUR 0 using:

- A free `*.workers.dev` address
- Cloudflare Workers Free
- Cloudflare D1 Free
- GitHub Free for source control

The expected workload of two users and roughly 1,000 products is far below the published free quotas at the time of this plan. Free-tier terms can change, so check the official limits before deployment and avoid attaching a paid plan unless intentionally approved.

Useful references:

- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare D1 pricing and limits](https://developers.cloudflare.com/d1/platform/pricing/)
- [Cloudflare D1 documentation](https://developers.cloudflare.com/d1/)

A custom domain is optional and normally costs money; it is not part of the zero-cost design.

## Authentication

There is one shared business login for one or two users.

- Store only a slow password hash as a Cloudflare secret, never in source control or D1.
- Compare passwords server-side with a timing-safe method.
- On success, issue a signed, `HttpOnly`, `Secure`, `SameSite=Lax` cookie.
- Give sessions a fixed maximum lifetime, such as 30 days.
- Rotate the session-signing secret to invalidate all sessions.
- Protect login with rate limiting and generic error messages.
- Require authentication for all application and export routes.
- Protect state-changing requests against cross-site request forgery.

Do not store authentication tokens in `localStorage`. Do not expose registration, password reset, invitations, or a user list.

Required secrets:

```text
PASSWORD_HASH
SESSION_SECRET
```

## Environments

Maintain two D1 databases:

- Local D1 for development and automated tests
- Production D1 for the parents' real data

Never test destructive workflows against production. Apply committed migrations through the deployment process.

## Deployment outline

1. Create the Cloudflare Worker project.
2. Create and bind the production D1 database.
3. Apply committed migrations.
4. Add `PASSWORD_HASH` and `SESSION_SECRET` as encrypted secrets.
5. Deploy to the generated `workers.dev` address.
6. Log in on a phone and iPad and install the PWA shortcut.
7. Import the pilot product CSV.
8. Run the acceptance checklist before importing all products.

Exact CLI commands should be added when the project scaffold and package manager exist; documenting speculative commands now would become stale.

## Backups and recovery

Free hosting is not a backup strategy.

### User-accessible exports

The **More > Export data** screen provides:

- Products CSV
- Sales CSV
- Sale items CSV
- Stock movements CSV
- A complete versioned JSON export

CSV supports inspection and spreadsheet use. The JSON export supports faithful application restoration.

### Operational routine

- Download a complete export weekly during the pilot.
- Keep at least four dated exports outside Cloudflare.
- Commit schema migrations and any seed/reference data to Git.
- Perform a restore rehearsal before full catalogue rollout and after schema changes.
- Document who downloads backups and where they are kept.

## Monitoring

Keep operations minimal:

- Review Worker errors after each release.
- Check Worker requests and D1 row/storage usage monthly.
- Display a simple authenticated diagnostics page with deployed version, database reachability, and last successful write time.
- Never log passwords, cookies, complete exports, or unnecessary customer details.

Do not add third-party analytics or monitoring until a real support need appears.

## Release checklist

- [ ] Tests pass against local D1
- [ ] Migration tested on a copy of representative data
- [ ] No secrets or export files are committed
- [ ] Login, logout, and session expiry work
- [ ] Product search works with 1,000 records
- [ ] Sale, cancellation, delivery, count, and adjustment work
- [ ] Duplicate submission is rejected safely
- [ ] Concurrent sale test cannot produce negative stock
- [ ] Export downloads and restores successfully
- [ ] Phone portrait and iPad landscape checks pass
- [ ] Production version and rollback commit are recorded

## Portability

Keep business logic independent of Cloudflare-specific request objects where practical, and use ordinary SQL migrations. If free-tier terms become unsuitable, export the data and move the application deliberately. Do not build a second database adapter before that need exists.

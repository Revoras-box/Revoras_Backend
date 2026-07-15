# Deployment Guide

This is a from-scratch guide, not a description of existing CI/CD — see [Current state](#current-state) for what actually exists today versus what's still needed. For the full pre-launch audit this guide summarizes, see [`PRODUCTION_READINESS.md`](../PRODUCTION_READINESS.md) (all 4 Critical findings fixed 2026-07-12; 5 High findings — rate limiting, tests, CI/`.env.example`, email fallback safety, deployment tooling — still open).

## Current state

- A `Dockerfile` and `Jenkinsfile` exist at the repo root — **not audited as part of this documentation pass**; verify they're current and working before relying on them.
- No `.github/workflows` or other CI pipeline.
- No `.env.example` existed before this doc — one now lives at `Revoras_Backend/.env.example`, generated from a full source grep of every `process.env.*` read in the codebase.
- No automated test suite is committed (`package.json`'s `test` script is still the placeholder).

## Required environment variables

See [`.env.example`](../.env.example) for the full, authoritative list with placeholder values. Summary:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string |
| `JWT_SECRET` | Yes | App fails to boot without it (fail-fast check in `server.js`) |
| `SESSION_SECRET` | Yes | App fails to boot without it (fail-fast check in `server.js`) |
| `FRONTEND_URL` | Yes | CORS origin allowlist + links in emails/OAuth redirects |
| `NODE_ENV` | Yes | Gates Knex environment selection, email dev-mode fallback, cookie `secure` flag — **must be explicitly `production` in production**, not left unset |
| `PORT` | No (default 5000) | |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_CALLBACK_URL` | Only if Google OAuth is enabled | |
| `RESEND_API_KEY` / `EMAIL_FROM` | Only if real email sending is needed | Missing in non-production → silent dev-mode console log, not a failure. Missing in production → typed failure result, not a crash |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | Only if payments are enabled | Payment endpoints return a clean 503 when absent |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET_NAME` / `R2_ENDPOINT` / `MEDIA_BASE_URL` | Only if media upload endpoints are used | Cloudflare R2 object storage (`config/r2.js` → `storage/providers/R2StorageProvider.js` → `services/media.service.js`). Missing account/key/secret → upload endpoints return a clean 503 rather than crashing on boot. `R2_ENDPOINT` defaults to `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com` if unset |
| `MEDIA_MAX_FILE_SIZE_MB` | No (default 5) | Per-file cap enforced by both the multer middleware and `media.service.js` |
| `REDIS_URL` | No | `config/redis.js` → `cache/providers/RedisCacheProvider.js`. Unset → `cache/index.js` falls back to the in-memory `InMemoryCacheProvider`, no external dependency required |
| `LOG_LEVEL` | No | Defaults `debug` outside production, `info` in production |
| `TEST_DATABASE_URL` | No | Only read by `knexfile.js`'s `test` environment |
| `KNEX_DEBUG` | No | Verbose Knex query logging when `"true"` |

The dev `.env` in this repo also still defines `EMAIL_USER`/`EMAIL_PASS` — leftovers from the removed `nodemailer` integration (see [`PRODUCTION_READINESS.md`](../PRODUCTION_READINESS.md) C3). Neither is read anywhere in `src/` anymore; they're not in `.env.example` and can be deleted from any local `.env`.

## Deployment checklist

- [ ] `.env` populated in the target environment from `.env.example` — never committed.
- [ ] `NODE_ENV=production` explicitly set — several behaviors silently degrade if it's merely unset rather than deliberately `production` (see `email.service.js`'s dev-mode fallback, which checks `NODE_ENV === "production"` by string equality, not a general "is this dev" heuristic).
- [ ] `npm run db:migrate` runs **before** the new app version starts serving traffic — a mid-deploy window where new code hits old schema is a real bug source, not a theoretical one.
- [ ] `db/seeds/06_dev_fixtures.js` is explicitly dev-only (creates test accounts with known passwords: `test.customer@example.dev`/`test.owner@example.dev`, password `DevTest123!`) — confirm the deploy pipeline never runs `db:seed` against production, or split dev-fixture seeding into a script excluded from any production seed step.
- [ ] Reverse proxy / TLS termination in front of the app (it has no HTTPS handling of its own).
- [ ] Process manager / restart-on-crash policy (PM2, systemd, or the orchestrator's native supervisor) — the app has no built-in one.
- [ ] Database connection uses TLS if Postgres isn't co-located with the app (check `DATABASE_URL`'s `sslmode`).
- [ ] Confirm the existing `Dockerfile`/`Jenkinsfile` are current — they predate this documentation pass and weren't verified as part of it.
- [ ] Automated backups configured at the hosting/Postgres-provider level (see [`PRODUCTION_READINESS.md`](../PRODUCTION_READINESS.md) §13) — not something this application configures itself.

## Migration & seed strategy

```bash
npm run db:migrate          # apply all pending migrations - run this on every deploy, before traffic switches over
npm run db:migrate:status   # verify what's applied
npm run db:migrate:rollback # roll back the most recent batch if a migration needs reverting
npm run db:seed             # roles/permissions/categories/dev-admin/dev-fixtures - dev-fixtures step is NOT safe for production
```

Migrations are idempotent by design where they touch shared reference data (`roles`, `permissions`, `categories` all use `insert(...).onConflict(...).merge()`, not `del()` + reinsert) specifically so re-seeding doesn't break once real rows reference them via `RESTRICT` foreign keys.

## Rate limiting caveat for multi-instance deployment

`rateLimit.middleware.js` is an **in-memory `Map`**, reset on process restart and **not shared across instances**. Running N instances behind a load balancer effectively multiplies every configured limit by N (5 login attempts/15min becomes `5×N` in practice). This is fine for a single-instance deployment but must move to a shared store (Redis via `rate-limiter-flexible` or similar) before scaling horizontally — see [`PRODUCTION_READINESS.md`](../PRODUCTION_READINESS.md) H1.

## Health check

`GET /api/health` runs a real `SELECT 1` against the database and returns `503` if unreachable — safe to use as a load balancer / orchestrator readiness probe as-is.

## Logging

Structured JSON to stdout (`utils/logger.js`) — no log shipping/aggregation configured. Capture stdout at the hosting-platform level (even basic log capture is enough to start); no APM/error-tracking (Sentry or equivalent) is wired in yet, which is currently the single highest-value observability gap for a small team operating this in production.

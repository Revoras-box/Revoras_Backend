# Revoras Backend — Production Readiness Report

**Date:** 2026-07-12
**Scope:** `Revoras_Backend` as of the end of Phase 2.5 (Admin migration). Full backend rewrite is complete: schema (Phase 1), Booking & Payments (2.1), Business Management (2.2), Authentication & Authorization (2.3), Customer Features (2.4), Admin (2.5).
**Purpose:** A final audit before the team shifts attention to the frontend (Phase 3). Every finding below was verified against the actual code/config in this repo — `npm audit`, live grep sweeps, and reading the real implementation — not inferred from memory of what was built.

Findings are graded **Critical** (fix before any real deployment), **High** (fix soon after launch), **Medium** (schedule), **Low** (nice to have), or **Info** (already good, noted for completeness).

---

## 1. Executive Summary

The architecture is sound: every domain follows `routes → controllers → services → repositories → Knex`, zero `pool.query()` or raw SQL string-building remains, input validation is consistent (Zod everywhere), and error handling is centralized. This is a genuinely solid foundation.

What's missing is entirely operational, not architectural — the things that don't matter until you actually deploy: no security headers middleware, an insecure default session secret, two unused dependencies with known high-severity CVEs, no distributed rate limiting, no observability stack, and no deployment tooling (Docker/CI) at all. None of this requires touching the domain logic; all of it is infrastructure and configuration.

**Do not deploy to production before resolving every item in §2 (Critical) and §3 (High).**

---

## 2. Critical — fix before any real deployment

**All four resolved 2026-07-12, verified end-to-end (clean boot + health check 200; DB-down → health check 503; unset `SESSION_SECRET`/`JWT_SECRET` → fails fast at boot instead of the old silent-fallback or first-request-crash behavior).**

| # | Finding | Where | Fix | Status |
|---|---|---|---|---|
| C1 | **Insecure default session secret.** `secret: process.env.SESSION_SECRET \|\| "session_secret_key"` — if `SESSION_SECRET` isn't set in the deploy environment, every instance uses the same publicly-visible fallback string, baked into the repo. | `src/server.js` | Fallback removed; app now throws at boot (`SESSION_SECRET environment variable is required`) if unset, matching the same fail-fast treatment applied to `JWT_SECRET` (which had no fallback but previously only failed on first token sign/verify, not at boot — tightened too). | ✅ Fixed |
| C2 | **No security headers middleware.** `helmet` was not installed or used anywhere. | `src/server.js` | `helmet` installed, `app.use(helmet())` added first in the middleware stack (before CORS). Verified via `curl -i` that CSP/HSTS/`X-Frame-Options`/etc. headers are present on responses. | ✅ Fixed |
| C3 | **Two installed dependencies were unused *and* carried known high-severity CVEs.** `multer` and `nodemailer` — confirmed zero imports in active `src/`. | `package.json` | `npm uninstall multer nodemailer`. Also ran `npm audit fix` (non-breaking) afterward, which cleared the remaining transitive `axios`/`form-data`/`qs`/`brace-expansion` findings too — `npm audit` now reports 0 vulnerabilities. | ✅ Fixed |
| C4 | **Health check doesn't check anything.** `GET /api/health` returned a static `{status:"ok"}` regardless of DB connectivity. | `src/server.js` | Now runs `knex.raw("select 1")` and returns 503 (`{status:"error"}`) on failure, 200 on success. Verified against both a healthy DB and a deliberately unreachable one. | ✅ Fixed |

---

## 3. High — fix soon after launch

| # | Finding | Where | Fix |
|---|---|---|---|
| H1 | **Rate limiting is in-memory and per-instance.** `rateLimit.middleware.js`'s own comment already says "For production, use Redis-based rate limiting." Confirmed still true: a plain `Map`, reset on restart, and — the concrete way this bit us during testing — **not actually distributed even conceptually**, since the real limit becomes `configured_limit × instance_count` the moment this runs behind more than one process. `authLimiter`'s shared `"auth"` scope (5 req/15min) across signup/login/register/forgot-password made even *our own* end-to-end testing this session need workarounds. | `src/middlewares/rateLimit.middleware.js` | Move to a Redis-backed limiter (`rate-limiter-flexible` or similar) before running more than one instance. Low effort, high payoff — this is the single biggest "works in dev, breaks under real multi-instance load" gap in the codebase. |
| H2 | ~~`qs` (moderate DoS) is a transitive dependency~~ | `package.json` (transitive) | **Resolved as a side effect of C3** — `npm audit fix` (non-breaking) cleared this along with `axios`/`form-data`/`brace-expansion`. `npm audit` now reports 0 vulnerabilities. |
| H3 | **No CI, no `.env.example`.** A `Dockerfile` and `Jenkinsfile` do exist at the repo root (this report's original claim of "no Docker" was wrong — not re-verified at the time) but no `.github/workflows`/CI and no `.env.example`. Every environment variable this app needs (§9) still has to be reverse-engineered from source. | repo root | See §8 (deployment checklist) — a `.env.example` and a basic CI job running `node --check` + the test suite on every push are both near-zero-effort and immediately valuable. Also worth reviewing whether the existing `Dockerfile`/`Jenkinsfile` are current/working, since they predate this audit and weren't part of it. |
| H4 | **Email delivery is currently non-functional in this environment**, and — more importantly for production — **the "dev mode" fallback in `email.service.js` silently treats a missing `RESEND_API_KEY`/`EMAIL_FROM` as success in any non-`production` `NODE_ENV`.** If `NODE_ENV` is ever misconfigured (or simply left unset) in a real deployment, OTP emails, password resets, and any future transactional email would silently "succeed" without ever being sent, with no error surfaced anywhere. | `src/services/email.service.js` | Don't gate this on `NODE_ENV` string equality alone — that's one env var away from a silent, hard-to-diagnose production outage. Prefer an explicit `EMAIL_DEV_MODE=true` flag that must be deliberately set locally, so production can never fall into it by accident (a missing/misconfigured `NODE_ENV` is a much easier mistake than someone deliberately setting a dev-only flag). |
| H5 | **No automated tests committed to the repo.** Every test this migration ran (hundreds of assertions across Phases 2.1-2.5) was written and executed ad hoc in a scratch directory outside the repo, then discarded — genuinely thorough at the time, but none of it persists to catch a future regression. `package.json`'s `test` script is still the placeholder `"echo \"Error: no test specified\" && exit 1"`. | `package.json`, no `test/` directory | Before Phase 3 frontend work starts consuming these APIs as a stable contract, port the highest-value scratch tests (auth lifecycle, booking conflict/race, payment webhook idempotency, RBAC permission resolution) into a real test suite (Vitest or Jest + a test database) that runs in CI. |

---

## 4. Security Review

**What's genuinely solid** (verified, not assumed):
- Passwords: `bcrypt`, cost factor 10 for users, 10 for admins. (OWASP currently recommends ≥12 for bcrypt on modern hardware — not urgent, but worth bumping opportunistically, e.g. next time the hashing code is touched, not as a standalone migration.)
- JWT: `JWT_SECRET` has no insecure fallback — confirmed via grep, the app fails to sign tokens rather than silently using a weak default. Minimal `{id, tv}` payload, no role/permissions baked in — permissions are always resolved fresh from the DB (report.md §2.0's design), which is the correct pattern against stale-privilege bugs.
- Revocation: `token_version` bump on password change/reset invalidates every prior token — a real, working lightweight revocation mechanism, verified by test.
- Account lockout: 5 failed logins → 15-minute lock, independent of IP-based rate limiting — verified by test, including that a correct password is still rejected while locked.
- SQL injection: every query goes through Knex's parameter binding. The only `db.raw()` calls that interpolate a JS variable directly into the SQL string (rather than passing it as a `?` binding) are (a) `date_trunc('${granularity}', ...)` in both analytics repositories, where `granularity` is only ever one of three hardcoded strings resolved from an already-Zod-validated `period` enum, never raw user input, and (b) a hardcoded numeric constant (`LOCKOUT_MINUTES`) in an interval literal. Verified safe today; recommend routing `granularity` through a lookup object (`{day: 'day', week: 'week', ...}[granularity]`) instead of string interpolation anyway, purely for defense-in-depth against a future refactor accidentally removing the upstream validation.
- Payment webhook: HMAC-SHA256 signature verification against Razorpay's raw request body, server-to-server, never trusts client-reported payment status. This is the correct pattern and was already in place before this migration.
- Duplicate-account prevention: DB-level `UNIQUE` constraints on `users.email`/`users.phone` are the real backstop (checked-then-insert races are caught via Postgres unique-violation codes and translated to clean 409s), not just an application-level pre-check.
- CORS: locked to a single configured origin (`FRONTEND_URL`), not a wildcard.
- Admin isolation: `admins` is a genuinely separate table/login/JWT shape from `users`, by design, confirmed unchanged through every phase of this migration — a compromised customer or business account has no path to admin privileges.

**Gaps** (beyond the Critical/High items already listed above):
- **No CSRF protection** — not currently exploitable (the API is pure bearer-token JSON, no cookie-based auth for any actual endpoint), but `express-session` cookies are set for the Google OAuth flow. Low priority as long as no endpoint ever starts trusting a session cookie for authentication instead of a bearer token.
- **No admin password-reset flow.** Admin accounts are provisioned directly by a super-admin (`createAdmin`) with no self-service forgot-password path. Reasonable for a small, trusted admin team; worth a deliberate decision (not an oversight) if the admin team grows.
- **`express.json()` has no explicit body size limit** — defaults to Express's built-in 100kb cap, which is reasonable for this API's actual payloads (no file uploads currently exist), but worth setting explicitly (`limit: "1mb"` or similar) so it's a documented decision rather than an implicit default.

---

## 5. Performance Review

- **N+1 queries were actively avoided throughout this migration** — verified by design and by test at every phase: dashboard/analytics aggregates run via `Promise.all`, not sequentially; list endpoints that need per-row related data (booking service line-items, review lists) batch-fetch in one extra query rather than looping. This discipline held from Phase 2.1 through 2.5.
- **Every list endpoint paginates** (bookings, reviews, notifications, businesses, users, activity log, discovery) — confirmed by reading every `list*` service function.
- **No caching layer** — dashboard/analytics aggregates recompute from scratch on every request. Fine at current scale; the first thing to add a cache in front of (Redis, short TTL) if these become hot paths under real traffic.
- **Geo search uses SQL-side Haversine** (computed in the query, not looped over in application code) but **no spatial index** (no PostGIS `GIST` index on lat/lng) — fine at hundreds/thousands of businesses, becomes a full-table scan bottleneck at tens of thousands. Not urgent given current data volume; revisit if/when business count grows an order of magnitude.
- **Connection pooling**: `knexfile.js`'s `production` environment sets `pool: {min: 2, max: 10}` — reasonable defaults, but should be tuned against actual instance count × expected concurrency once real infrastructure is chosen (e.g., if running N instances behind a load balancer, the *database's* max connection limit needs to comfortably exceed `N × 10`).
- **No response compression** (`compression` middleware not installed) — low priority for a JSON API with generally small payloads, but trivial to add if response sizes grow (e.g., large discovery result sets).

---

## 6. Database Review

- Schema is 100% Knex-managed via versioned migrations — no runtime schema sync, no Prisma, confirmed via repo-wide grep (only historical comments referencing the old `modelAttributeSync.js` remain, no actual code).
- Foreign keys consistently use the correct `ON DELETE` behavior for their relationship (`CASCADE` for genuinely dependent rows like `booking_services`, `RESTRICT` for rows that should block deletion of something still referenced like `bookings.business_member_id`, `SET NULL` for optional references like `businesses.approved_by`) — reviewed table-by-table across all 5 phases, no inconsistencies found.
- `bookings` has a real Postgres `EXCLUDE USING gist` constraint preventing double-booking at the database level, not just application logic — a genuinely strong guarantee, tested under actual concurrent load (6 simultaneous requests for the same slot → exactly 1 succeeds) back in Phase 2.1.
- Migration rollback was verified once, thoroughly, in Phase 1 (`migrate:rollback` then re-`migrate:latest`, confirmed the schema was correctly restored). Individual migrations added in later phases have **not** each had their `down()` independently tested — low risk (they're mechanical drops/reversions) but worth a full rollback drill before considering the schema "battle-tested."
- **No documented backup/recovery strategy** — this is infrastructure, not code, and depends entirely on hosting choice (see §8).

---

## 7. API Consistency

Verified by reading every controller across all 5 phases:
- Response envelopes are consistent: single resources as `{resourceName: {...}}`, lists as `{resourceNamePlural: [...], pagination: {page, limit, total, pages}}`, mutations as `{message, resourceName}`.
- Error responses are uniformly `{error: "message"}` (or `{error: "Validation failed", details: [...]}` for Zod failures), all funneled through one `errorHandler.middleware.js` — no controller has its own ad hoc error shape.
- HTTP status codes are used correctly and consistently: 400 (validation), 401 (auth), 403 (authorization), 404 (not found), 409 (conflict/duplicate), 500 (unhandled), 502 (upstream failure, e.g. email send), 503 (service not configured, e.g. Razorpay without keys).
- Terminology is consistent with the Business/Professional/Category model in every response body across Phases 2.2-2.5 — no "studio"/"barber" language leaks into any JSON payload written during this migration (verified by grep).

---

## 8. Deployment Checklist

Nothing here exists yet — this is a from-scratch list, not a review of existing tooling.

- [ ] `.env.example` documenting every variable in §9, with placeholder values and a one-line comment on what each does and where to get it.
- [ ] `Dockerfile` (multi-stage: install deps, copy source, run as non-root user, `CMD ["node", "src/server.js"]`).
- [ ] CI pipeline (GitHub Actions or equivalent): `node --check` on every file, run the test suite (once §3/H5 exists), `npm audit` as a gate.
- [ ] Migration step in the deploy pipeline: `npm run db:migrate` must run *before* the new app version starts serving traffic, not after (a mid-deploy window where new code hits old schema is a real bug source).
- [x] Seed data: dev/demo fixtures (test accounts, showcase + map businesses) are split into `db/seeds/dev/` and run only via the opt-in `npm run db:seed:dev` (which refuses when `NODE_ENV=production`). The default `npm run db:seed` seeds reference data only, so it is production-safe. Deploy pipeline should run `db:seed`, never `db:seed:dev`.
- [ ] Reverse proxy / TLS termination (this app has no HTTPS handling of its own, as expected — needs a load balancer or reverse proxy in front of it in any real deployment).
- [ ] Process manager / restart policy (PM2, systemd, or the orchestrator's native restart-on-crash) — the app has no built-in supervisor.
- [ ] Confirm `NODE_ENV=production` is actually set in the deploy environment — multiple behaviors depend on it (email dev-mode fallback per H4, Knex environment selection, cookie `secure` flag).
- [ ] Database connection uses TLS/SSL if the Postgres host is not co-located with the app (check `DATABASE_URL`'s `sslmode`).

---

## 9. Environment Variables

Every variable the app actually reads, compiled from a full source grep (not the old, now-nonexistent `.env.example`):

| Variable | Required | Used for |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string (Knex) |
| `JWT_SECRET` | Yes | Signs/verifies every JWT (customer, business, admin) — app fails to sign tokens without it, by design |
| `SESSION_SECRET` | Yes | `express-session` — app fails to boot without it (fallback removed, see C1) |
| `FRONTEND_URL` | Yes | CORS origin allowlist + email link generation (password reset, etc.) |
| `PORT` | No (defaults 5000) | HTTP listen port |
| `NODE_ENV` | Yes (see H4) | Gates Knex environment selection, email dev-mode fallback, cookie `secure` flag |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_CALLBACK_URL` | Only if Google OAuth is enabled | Passport Google strategy |
| `RESEND_API_KEY` / `EMAIL_FROM` | Only if real email sending is needed | Transactional email (OTP, password reset) — see H4, currently non-functional in this dev environment |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | Only if payments are enabled | Order creation, client-side verification, webhook signature check — payment endpoints return a clean 503 when absent, confirmed by test, not a crash |
| `LOG_LEVEL` | No (defaults `debug` outside production, `info` in production) | Structured logger verbosity |
| `TEST_DATABASE_URL` | No | Only read by `knexfile.js`'s `test` environment, falls back to `DATABASE_URL` |
| `KNEX_DEBUG` | No | Verbose Knex query logging in development |

No variable currently has a production-unsafe fallback — `SESSION_SECRET` and `JWT_SECRET` both fail fast at boot if unset (C1).

---

## 10. Rate Limiting

Current state (in-memory, per-IP, per-scope — see H1 for the production-blocking gap):

| Limiter | Window | Max | Scope |
|---|---|---|---|
| `authLimiter` | 15 min | 5 | Shared across ALL of: customer/business login+register, password reset, verification send, admin login |
| `apiLimiter` | 1 min | 100 | General-purpose, applied broadly |
| `strictLimiter` | 1 min | 20 | Sensitive mutations (profile changes, reviews, bookings) |

The shared `authLimiter` scope across every login-adjacent endpoint is a real usability constraint even in normal operation, not just a testing inconvenience — a user who fumbles their password a few times, then tries to re-register a second account, then their business partner tries to log in from the same office IP, can hit this shared budget for reasons that have nothing to do with an actual attack. Worth splitting into per-endpoint scopes (or at least per-action-type) when this moves to Redis (H1), not just relocating the same shared-bucket design to a new backing store.

---

## 11. Logging & Observability

- **Logging**: a custom structured JSON logger (`utils/logger.js`) writes to stdout with `timestamp`/`level`/`message`/`meta`. Used consistently by the global error handler and by the notification-failure/audit-log-failure catch blocks added during this migration. Not used inside every service function — most success-path operations produce no log line at all, which is fine for a request/response API (the HTTP request logger already captures method/path/status/duration for every call) but means diagnosing *why* a particular business-logic decision was made (e.g., "why was this booking auto-cancelled") currently requires reading code, not logs.
- **No log shipping/aggregation** — stdout only. Fine for local dev; a real deployment needs these captured somewhere queryable (even basic hosted-platform log capture, e.g. whatever the eventual host provides, is enough to start).
- **No APM / error tracking** (Sentry, or equivalent) — right now, an unhandled exception in production is only visible if someone is actively watching stdout. This is the single highest-value observability addition for a small team: near-zero setup cost, immediate visibility into real production errors.
- **No metrics** (request rate, latency percentiles, error rate, DB pool utilization) — no Prometheus/StatsD integration. Not urgent pre-launch; becomes valuable once there's real traffic to reason about.
- **No uptime monitoring** configured (external ping/synthetic check) — trivial to add against `/api/health` once that endpoint actually checks DB connectivity (C4).

---

## 12. Error Handling

Genuinely consistent across the whole codebase, verified by reading every controller: controllers never `try`/`catch` — Express 5 forwards rejected async-handler promises to the single `errorHandler.middleware.js`, which translates a thrown `ServiceError(statusCode, message)` into the right HTTP response, a `ZodError` into a 400 with field-level detail, and anything else into a logged 500. This pattern was established in Phase 2.1 and held without exception through Phase 2.5 — no controller anywhere reinvents its own try/catch/error-shape.

One deliberate refinement made *during* this migration, worth restating here since it's easy to reintroduce by accident in future work: **any side effect fired after an operation has already committed (notifications, in this codebase's case) must catch-and-log its own failures, never let them propagate and turn a successful primary operation into an apparent failure.** Found and fixed in Phase 2.4 (see that phase's memory/report notes) — the fix pattern (`notifySafely` in `booking.service.js`, inlined try/catch in `payment.service.js`) should be the template for any future post-commit side effect (e.g., an admin-approval email, once that's built).

---

## 13. Backup & Recovery Considerations

Entirely a hosting/infrastructure decision, not something resolved in code — flagged here so it isn't silently skipped:

- Automated Postgres backups (daily snapshots at minimum) — whatever the eventual hosting provider offers (managed Postgres services like RDS/Supabase/Neon/Cloud SQL all provide this; a self-hosted instance needs `pg_dump`/WAL archiving set up explicitly).
- Point-in-time recovery (PITR), if the provider supports it — matters more once there's real customer/payment data to protect.
- **A tested restore drill** — a backup that has never been restored is not a verified backup. This should happen at least once before launch, and periodically after.
- Retention policy — how long backups are kept, and whether that satisfies any applicable data-retention/compliance expectations for the markets Revoras operates in.
- The `payments` table and Razorpay are the highest-stakes data in this schema — any backup/recovery plan should be explicitly tested against "can we reconstruct payment state after a restore" rather than just "does the restore complete without error."

---

## 14. Remaining Technical Debt (consolidated across all phases)

Everything below was already individually flagged during its originating phase; collected here as one list so nothing has to be re-discovered by re-reading five phases of notes.

- **No refresh-token rotation** — a deliberate scope decision (Phase 2.3), not an oversight. Users re-authenticate after 7 days (business/customer) or 12 hours (admin). Revisit if session-length complaints become a real product signal.
- **No job scheduler/cron exists anywhere in this codebase.** `notifyBookingReminder` (Phase 2.4) is fully implemented and ready to call, but nothing calls it — there's no infrastructure to run "check for bookings starting in N hours" on a schedule. This is the one piece of the notifications scope that needs actual new infrastructure (a queue or cron runner), not just more application code.
- **`addBarberToStudio` in the frontend (`lib/api.ts`) is orphaned** — it calls a route (`/api/studios/auth/barbers`) that no longer exists after Phase 2.3's auth consolidation. Team-member management needs to be rewired to Phase 2.2's `/api/business/:studioId/members` endpoints as part of whatever frontend work touches the Business Dashboard's team page.
- **No un-suspend path for a suspended *business*** (only users got a symmetric suspend/activate pair in Phase 2.5). A suspended business currently requires a direct `PUT`/manual DB update to restore, not a dedicated endpoint. Deliberately not added in Phase 2.5 per "don't add new features" — worth a real decision (not silent omission) whenever business moderation gets frontend UI.
- **Email delivery is non-functional in this dev environment** (populated but invalid `RESEND_API_KEY`/`EMAIL_FROM`) — needs real, verified credentials before any email-dependent flow (OTP signup, password reset) can be demonstrated end-to-end, dev-mode fallback aside.
- **No spatial index on business lat/lng** — fine at current scale, flagged in §5 for when it isn't.
- **`bcrypt` cost factor is 10**, OWASP's current baseline recommendation is 12+ — low urgency, opportunistic fix.
- **Migration `down()` functions are largely untested** beyond Phase 1's initial verification — see §6.

---

## 15. Sign-off Summary

| Area | Status |
|---|---|
| Architecture consistency | ✅ Complete — one pattern, zero exceptions, verified by repo-wide grep |
| `pool.query()` / legacy tables | ✅ Zero remaining, verified |
| Input validation | ✅ Zod on every mutation endpoint |
| Error handling | ✅ Centralized, consistent |
| Security headers | ✅ helmet added (C2) |
| Session secret | ✅ Fail-fast, no insecure fallback (C1) |
| Dependency vulnerabilities | ✅ 0 reported by `npm audit` (C3, H2) |
| Health check | ✅ Checks DB connectivity (C4) |
| Rate limiting | ⚠️ Works, but in-memory/per-instance (H1) |
| Automated tests | ❌ None committed (H5) |
| Deployment tooling | ⚠️ Dockerfile/Jenkinsfile exist but unaudited; no CI/`.env.example` (H3, §8) |
| Backup/recovery | ⚠️ Infrastructure decision, not yet made (§13) |
| Observability | ⚠️ Logging exists, no APM/metrics/alerting (§11) |

**Recommendation:** resolve §2 (Critical) before any deployment reachable by real users; resolve §3 (High) within the first post-launch iteration. Everything else in this report is real but not launch-blocking — track it, don't let it silently become permanent.

# Revoras Backend Documentation

Written 2026-07-13, immediately after the backend architecture migration (Knex + clean-architecture rewrite, Phases 1–2.5) and its production-readiness Critical fixes were both complete, and before Frontend V3 work begins. This is the technical reference for that finished backend — read it before extending or integrating with the API, and re-verify anything load-bearing against the actual code if significant time has passed (the migration progress notes and production-readiness report both flag this same caveat: small details drift).

## Start here

| Doc | What it covers |
|---|---|
| [`architecture.md`](./architecture.md) | System diagram, the `routes → controllers → services → repositories → Knex` layering, folder-by-folder purpose, error-handling conventions, request/response shape rules |
| [`database-schema.md`](./database-schema.md) | Full ER diagram, every table, FK/constraint design decisions, migration history, roles/permissions/categories seed data |

## Flows

| Doc | What it covers |
|---|---|
| [`auth-flow.md`](./auth-flow.md) | Two identities (Person vs Admin), JWT shapes, customer/business/admin login+register, Google OAuth, password reset, token revocation, account lockout |
| [`rbac-model.md`](./rbac-model.md) | The three-middleware authorization chain, role→permission→override resolution, permission key reference, why Admin is deliberately separate |
| [`booking-lifecycle.md`](./booking-lifecycle.md) | Booking states, double-booking prevention (advisory lock + DB EXCLUDE constraint), cancel/reschedule, availability |
| [`payment-lifecycle.md`](./payment-lifecycle.md) | Razorpay order creation, the client-verify vs webhook race (webhook is authoritative), signature verification, idempotency |
| [`business-onboarding.md`](./business-onboarding.md) | Registration transaction, pending→approved/rejected/suspended admin review (with auto-geocoding), team member onboarding |
| [`business-lifecycle-state-machine.md`](./business-lifecycle-state-machine.md) | **Phase 1.5 DESIGN (not yet implemented):** the canonical `business_status` lifecycle (draft→onboarding→payment_pending→pending_review→under_review→approved→active→suspended/rejected), how it reconciles with today's `approval_status`+`is_active`, and why it stays orthogonal to 1.4b trust verification |

## Operating it

| Doc | What it covers |
|---|---|
| [`api-reference.md`](./api-reference.md) | Every route, method, auth requirement, and body/response shape, organized by domain |
| [`deployment.md`](./deployment.md) | Environment variables, deployment checklist, migration/seed strategy, rate-limiting caveat for multi-instance deployment |
| [`../.env.example`](../.env.example) | Every environment variable the app actually reads, with placeholder values and inline explanations |
| [`../PRODUCTION_READINESS.md`](../PRODUCTION_READINESS.md) | The full pre-launch audit — Critical findings fixed 2026-07-12, High findings (rate limiting, tests, CI, email fallback safety) still open |

## Engineering standards

Process standards for the ongoing V4 build. All external infrastructure integrations (Cloudflare R2, Redis, Stripe/Razorpay, Maps, AI providers, etc.) and every phase from 1.2 onward must follow these.

| Doc | What it covers |
|---|---|
| [`engineering/development-workflow.md`](./engineering/development-workflow.md) | The per-phase lifecycle: Design → Implement → Migrate → Verify infra → Verify app → Regression → Performance → Document → Complete → Next |
| [`engineering/infra-verification-sop.md`](./engineering/infra-verification-sop.md) | Infra-first verification gate for any external dependency — config fingerprint, config validation, infra sanity, the A/B/C/D decision matrix |
| [`engineering/testing-standards.md`](./engineering/testing-standards.md) | What application verification must cover: unit/integration/API/auth/authz/error/rollback/cleanup/performance/regression, plus the standard regression surface |
| [`engineering/release-checklist.md`](./engineering/release-checklist.md) | Definition of Done + pre-completion release checklist + the phase-status vocabulary (✅ / ⏳ / ⛔ / ☐) |

## What's deliberately not here

- **No generated OpenAPI/Swagger spec** — `api-reference.md` is hand-written from the route/controller/validator source. See that doc's closing note on why a future spec should generate from the Zod validators rather than being hand-maintained separately.
- **No frontend documentation** — this set covers `Revoras_Backend` only. Frontend work (Design System → Customer Experience → Business Dashboard → Admin UI → Polish) is the next phase and has its own separate context.
- **No load-testing / capacity-planning doc** — nothing in this codebase has been load-tested against realistic traffic yet.

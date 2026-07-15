# Development Workflow

**Status:** Official standard for Revoras V4. Every phase (1.2 onward) follows this exact lifecycle. Phases do not overlap — an unfinished phase is not left partially done while the next one starts.

```
Design
  ↓
Implementation
  ↓
Migration (if schema changes)
  ↓
Infrastructure Verification   → docs/engineering/infra-verification-sop.md
  ↓
Application Verification      → docs/engineering/testing-standards.md
  ↓
Regression Testing
  ↓
Performance Validation
  ↓
Documentation Update
  ↓
Phase Completion              → docs/engineering/release-checklist.md
  ↓
Next Phase
```

## Stage detail

1. **Design** — confirm scope and acceptance criteria *before* writing code. Capture the acceptance criteria in the phase's entry in `report.md` §V4.6. If the phase depends on an external service or a schema change, name it here.
2. **Implementation** — modular, consistent with the existing `routes → controllers → services → repositories → Knex` architecture. No business logic or raw SQL in controllers. Reuse the existing provider abstractions (`StorageProvider`, `SearchProvider`, `CacheProvider`) rather than forking parallel ones.
3. **Migration** — if the schema changes, write a Knex migration with a working `down`. Migrations are the only source of schema truth (there is no runtime sync). Verify the migration **and its rollback** against a live database.
4. **Infrastructure verification** — for any external dependency, run the [Infrastructure Verification SOP](./infra-verification-sop.md) to green before touching application tests.
5. **Application verification** — exercise the real endpoints/services end-to-end against live infrastructure per [testing-standards](./testing-standards.md). "Implemented" and "verified" are tracked separately; a checkbox is ticked only when the path was actually exercised.
6. **Regression testing** — re-run the previously-working surfaces the change could touch (see testing-standards). Zero regressions is a hard requirement.
7. **Performance validation** — the sanity checks in testing-standards (latency reasonable, no N+1, no leaks/unhandled rejections). Not a load test.
8. **Documentation update** — `report.md`, `docs/api-reference.md`, `docs/database-schema.md`, `docs/deployment.md`, migration history, and `.env.example` as applicable.
9. **Phase completion** — only when the [Definition of Done](./release-checklist.md) is fully satisfied. Otherwise the phase stays **In Progress** or **Blocked**.
10. **Next phase** — begins only after the current phase is marked Complete.

## Per-feature lifecycle (the tracked dimensions)

Track **every** feature through the same lifecycle, so each has an identical, measurable Definition of Done and progress is easy to review at a glance. These map 1:1 to the status rows in [`release-checklist.md`](./release-checklist.md):

```
Design
  ↓
Database              (migration + rollback, live DB)
  ↓
Backend API           (endpoints, validation, integration — live-verified)
  ↓
Frontend Dashboard    (tsc + eslint clean)
  ↓
Customer UI           (tsc + eslint clean)
  ↓
Integration Verification   (service↔repo, discovery/public composition, persistence — live DB)
  ↓
Browser QA            (batched to the UI verification sprint)
  ↓
Infrastructure Verification   (R2 / Redis / Maps / Payments — batched to the release pass)
  ↓
Production Ready
```

Browser QA and Infrastructure Verification are **batched** (a dimension being ⏳ doesn't block the next feature) — see the release-gate policy in `release-checklist.md`. Everything above them is done per-feature, in order.

## Engineering standards (apply throughout)

- Modular architecture, clear separation of concerns.
- Reusable service/provider abstractions.
- Backend-first unless the frontend is explicitly in the phase scope.
- Backward compatibility for existing APIs.
- Validation, authorization, and structured error handling everywhere.
- Infrastructure validated before application validated.
- Production-ready code quality over implementation speed.
- Every phase independently deployable, testable, and documented.

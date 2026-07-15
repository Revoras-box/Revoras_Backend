# Release Checklist & Definition of Done

**Status:** Official standard for Revoras V4. A phase reaches **Production Ready** only when every applicable item in the Definition of Done is satisfied. Feature development, however, is **not** gated on external-service verification — see "Development gate vs. release gate" below.

## Two milestones per phase

Track two distinct milestones, not one:

- **Feature-Complete** — implementation, code review, schema (migration + rollback), application logic (DB/API/business rules), and frontend are done and verified against everything *except* external infrastructure that needs live credentials. A phase can be Feature-Complete while an external service is still unverified.
- **Production Ready** — the full Definition of Done, including live external-infrastructure verification. This is the bar for deploy.

## Development gate vs. release gate

Infrastructure verification for an external dependency (R2 upload/delete round-trip, CDN, etc.) is a **release gate, not a development gate.**

This is safe *only because of the storage abstraction*: `MediaService` is the single layer that talks to storage (`Controller → MediaService → StorageProvider → R2StorageProvider`). Every media feature — gallery, certificates, portfolio, offers, business logo, review images — flows through it. So:

- Build APIs, tables, business logic, and UI against `MediaService` without a working R2 connection.
- Deferring credential verification adds **no** redesign debt — it delays one integration test, nothing else.
- Verify all MediaService-dependent features together in **one comprehensive pre-production pass** (infra SOP first, then gallery → certificates → portfolio → offers → business logo → review images), rather than blocking each phase on R2 as it's built.

**Comprehensive Browser / UI QA is batched the same way.** Rendering every screen, driving dashboard save-flows, responsive/cross-browser/accessibility passes — these are run in a **dedicated UI verification sprint after a milestone group** (e.g. Phases 1.3–1.5 together), not re-run after every phase. Re-testing the same screens after each incremental phase gets more wasteful as the UI grows. During development a UI surface is "done" when it **builds clean** (`tsc` + `eslint`); its browser QA is pending until the sprint. This holds Browser QA — and therefore Production Ready — but does not block the next phase.

A phase whose only outstanding items are external-service verification and/or batched Browser QA is **Feature-Complete with verification pending**, *not* Blocked. Reserve **⛔ Blocked** for things that actually stop building (an undecided product question, a hard dependency on unbuilt code).

## Definition of Done (Production Ready)

A phase is Production Ready only when:

- [ ] Implementation complete
- [ ] Code review complete
- [ ] Database migrations verified — **including rollback** (if schema changed)
- [ ] Infrastructure verification passed ([SOP](./infra-verification-sop.md) Step 2 green)
- [ ] Application verification passed ([testing-standards](./testing-standards.md))
- [ ] Regression tests passed (standard regression surface)
- [ ] Performance sanity check completed
- [ ] Documentation updated
- [ ] No known defects remain
- [ ] Independently deployable

## Pre-completion release checklist

Before flipping a phase to ✅ in `report.md`:

- [ ] Database migration verified against live Postgres
- [ ] Rollback (`down`) tested
- [ ] External services verified (infra SOP passed for each dependency)
- [ ] `report.md` §V4.6 checklist fully ticked (no verification box left unchecked)
- [ ] `docs/api-reference.md` updated
- [ ] `docs/database-schema.md` updated (schema + migration history)
- [ ] `docs/deployment.md` / `.env.example` updated (new env vars)
- [ ] No known regressions across the standard regression surface
- [ ] Production configuration verified (no dev-only shortcuts, no placeholder creds)

## Per-dimension status (use this in `report.md`)

A single label hides what's actually left. Track each phase across these dimensions so it's obvious what remains without stopping feature work:

```
Phase X.Y — <name>
  Database:            ✅ / ⏳ / ☐ / n/a   (migration + rollback, live DB)
  Backend API:         ✅ / ⏳ / ☐ / n/a   (endpoints, validation, integration — live-verified)
  Frontend Dashboard:  ✅ / ⏳ / ☐ / n/a   (tsc + eslint clean)
  Customer UI:         ✅ / ⏳ / ☐ / n/a   (tsc + eslint clean)
  Browser QA:          ✅ / ⏳ Pending / n/a  (batched to the UI verification sprint)
  Infra Verification:  ✅ / ⏳ Pending (<service>) / n/a  (batched to the release pass)
  ──────────────────────────────────────────
  Production Ready:    ✅ / ❌ No
```

Track each phase across these consistent **dimensions** rather than one collapsed label — it's immediately clear what's done and what's outstanding, and avoids ambiguity around a single "Feature-Complete" flag. Neither `Browser QA ⏳` nor `Infra Verification ⏳` blocks the next phase — each only keeps **Production Ready = No** until its batched verification runs. ("Feature-Complete" remains useful shorthand in prose for *all non-batched dimensions ✅*, but the dimension rows are the source of truth.)

## Phase-status vocabulary

Use exactly these in `report.md` so status is unambiguous at a glance:

- **✅ Complete / Production Ready** — Definition of Done fully satisfied, both infra and app layers independently verified.
- **⏳ In Progress / Verification Pending** — implemented and/or partially verified; at least one dimension outstanding (including external-service verification deferred to the pre-production pass).
- **⛔ Blocked** — cannot *advance the build* due to an undecided product question or a hard dependency on unbuilt code; the specific blocker is named. **Not** used for external-service verification being deferred.
- **☐ Not Started.**

A phase whose application layers are done but whose external-service verification is deferred is **Feature-Complete, Production Ready = No** — not ⛔ Blocked and not ✅ Complete.

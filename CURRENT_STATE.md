# Revoras — Current State

**Canonical starting point.** Read this first, in any new session or as a new contributor, before reading anything else.

This file holds only high-level, durable facts: where the project is, what phase is active, and what gates production. It is deliberately short. Detail lives in the docs it points to — if you find yourself adding implementation notes here, they belong in `docs/` instead.

Last updated: 2026-07-19.

## Where we are

| | |
|---|---|
| **Frozen milestone** | `customer-experience-v1` — tagged on **both** repos (`Revoras` frontend, `Revoras_Backend`). The full customer journey (landing → search → business/professional → booking → checkout → success → my bookings) is built, QA'd, and frozen. Do not redesign customer pages. |
| **Active phase** | **Phase 3 — Business Experience** (see split below) |
| **Design system** | **Terra Jade v1 — FROZEN.** Jade primary + terracotta accent, Tailwind v4 CSS-first tokens, motion 150/250/400. Spec: [`../Revoras/docs/DESIGN_SYSTEM.md`](../Revoras/docs/DESIGN_SYSTEM.md); living reference at `/design-system` in the running frontend. All Phase 3 UI is built in this language. |
| **Backend** | Phases 0–2.6 complete (Knex + clean-architecture rewrite, discovery, filters, curation, favorites, offers, booking experience). Reference: [`docs/README.md`](./docs/README.md) |

## Phase 3 split

Phase 3 is split into three tracks. The split matters: **3A is a redesign, not a rebuild.** Those pages already exist and work — treat their logic and API integrations as done, and change only presentation. 3B is genuinely new UI over backends that already ship.

### 3A — Dashboard Redesign (existing UI)

Apply the frozen Terra Jade system; improve layout, responsiveness, interaction, and consistency. **Keep existing API integrations intact.**

Dashboard · Calendar · Appointments · Customers · Professionals · Services · Payments · Analytics · Reviews · Notifications · Settings

**These pages are already on Terra Jade.** They use semantic tokens (`text-on-surface`, `border-border`, `text-primary`), so the 07-15 palette swap propagated automatically — a grep for hardcoded palette colors across `app/business` + `components/business` hits only `StepGallery.tsx`, and those are deliberate scrims. The shared layout system also already exists in `components/ui` (`AppShell`, `Sidebar`, `TopNav`, `PageHeader`, `StatCard`, `Card`, `DataTable`, `EmptyState`, `Section`, `Badge`, `QuickAction`). **3A's remaining work is content and interaction gaps, not restyling** — e.g. appointments has no kanban, calendar has no drag.

Dashboard content gaps closed 2026-07-17: welcome header, quick actions, today's schedule preview, subscription status, verification status.

Interaction gaps closed 2026-07-19:

- **Appointments** — Table/Board toggle. The board is a 4-column pipeline (pending → confirmed → checked in → completed) with drag-to-change-status. A column only accepts a card when the booking's `allowedNextStatuses` contains that status, so the state machine stays the single authority and an illegal drop is never offered. Also gained a date-range filter and a Clear control.
- **Calendar** — drag-to-reschedule in day view. `ScheduleGrid` grew an opt-in `onEventDrop` + per-event `draggable`; drops snap to 15 min and can move a booking across professionals. Only pending/confirmed bookings drag, matching the drawer's existing rule.
- **Pending reviews** — now has backing data (see 3B). Surfaced as a count badge on the Reviews **nav item** rather than a 7th dashboard tile, which would have orphaned a row in the 6-column stat grid.

### 3B — New Business Features (new UI)

Corrected 2026-07-17 after reading the code: two of these three were already built. Verify against the repo before planning work here.

| Page | Backend | State |
|---|---|---|
| Verification Center | Phase 1.4b | ✅ Built — `app/business/verification/page.tsx`, in nav, full document upload/submit |
| Offers Management | Phase 2.4 (`offer.engine.js` is the single source of discount truth) | ✅ Built — `app/business/offers/page.tsx`, in nav, full CRUD, gated on `offers.manage` |
| Subscription Management | Phase 1.5d (₹99 Razorpay) | ✅ Built 2026-07-17 — `app/business/subscription/page.tsx`, in nav, gated on `settings.manage`. **Deliberately scoped to what the backend supports** (see below). |

**Review replies — BUILT 2026-07-19.** Previously missing everywhere (schema, repository, service, UI). Now shipped end to end:

- `20260719000001_add_review_replies` — `reply` / `replied_at` / `replied_by` **on `reviews`**, not a child table: a review gets at most one reply, so a join would cost the busiest read path in the app for nothing. Presence of `reply` **is** the state (null = unanswered), which is what makes the pending-reviews metric a plain `where reply is null` instead of a status column that can drift. Partial index `idx_reviews_awaiting_reply` covers exactly that predicate.
- `20260719000002_seed_reviews_respond_permission` — dedicated **`reviews.respond`**, same reasoning as `offers.manage`: a reply publishes text under the business's name, so it must be delegable without also handing over `settings.manage`. Migration (not just seed) because seeds run manually and an already-seeded environment would 403.
- `PUT`/`DELETE /api/business/:studioId/reviews/:reviewId/reply`. Mounted on the **business** router, not `/api/reviews` — the actor is the business, so authorization is "does this review belong to your studio", enforced by scoping the lookup to `studioId`. PUT because re-replying is an edit, not an error.
- Reviews page: composer, published reply with responder byline, edit/remove, and an "Awaiting reply" filter + stat.

Verified against a running server, 19/19 — including cross-tenant isolation (403), unauthenticated (401), and that `?awaitingReply=false` does **not** invert the filter (the `z.coerce.boolean()` bug Phase 2.2 shipped on `featuredOnly`).

The dashboard's existing **Average rating** tile still covers the reviews slot; the new count rides on the nav badge.

#### The subscription backend is three endpoints

`GET /subscription` · `POST /subscription/order` · `POST /subscription/verify`. That is the whole surface. The page ships **only** what these support: current plan, ₹99/month, status, renews-on date, payment history, and Renew.

Deliberately **not** built, because no backend exists and inventing it would expand scope:

| Wanted | Why not |
|---|---|
| Usage metering (businesses/bookings/storage) | No metering anywhere in the backend |
| Invoices | Zero invoice code; Invoice is deferred to V1.1 |
| Cancel | No endpoint, no status transition |
| Change payment method | No endpoint — Razorpay orders here are one-shot |

Each is a real product decision, not a styling gap. Don't add a tile for any of them without building the backend first.

#### Remaining 3B feature gaps (pages exist, specs don't fully)

- **Offers** — ~~status filter tabs, Duplicate, Pause~~ **done 2026-07-19**: tabs with per-status counts, and a row action menu (Edit / Duplicate / Pause–Resume / Delete). Pause is just `isActive: false`, since the server derives `status` from it; Resume is disabled on expired offers because their window is already past. Still missing: richer performance/analytics.
- **Verification** — ~~Verified Badge Preview~~ **done 2026-07-19**: `VerifiedBadgePreview` renders the badge on the two surfaces a customer actually meets it (search result card, profile header) using the business's real name/photo, dimmed pre-approval and live once approved. Deliberately a static mock, not the real `BusinessCard` — reusing that would couple the dashboard to the frozen customer-experience-v1 surface.

### 3C — Business Journey QA

Runs **after** the 3A/3B UI work and **before** any admin redesign. Browser QA across the full host funnel:

host signup → onboarding wizard → gallery upload *(needs R2)* → ₹99 subscription checkout *(needs Razorpay)* → verification submission → dashboard entry → subscription renewal *(needs scheduler)* → offers → Verification Center

## Infrastructure release gates

These are tracked separately from feature development. **None of them blocks frontend implementation — all of them must pass before Production Ready.**

| Gate | Blocks |
|---|---|
| 🔴 **Cloudflare R2 credentials** | Gallery uploads. Currently failing with 401. Gallery is required in onboarding, so this blocks the entire host funnel end-to-end. |
| 🔴 **Razorpay test credentials** | Real network checkout — ₹99 subscription and booking payment. |
| 🔴 **Scheduler / cron infrastructure** | Booking reminders, subscription renewals, expiry. `notifyBookingReminder` exists but nothing calls it. |

Verify each against [`docs/engineering/infra-verification-sop.md`](./docs/engineering/infra-verification-sop.md) before calling it passed.

## Also open

- **Production readiness** — 4 Critical findings fixed 2026-07-12; 5 High still open. See [`PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md).
- **Notifications (Phase 2.6)** — table, service, routes, and email service exist, but `notification.service` never actually sends email and most events are uncovered.
- **Invoice** — deferred to V1.1.
- **V2 redesign** (`report.md`) — a proposed Business/staff unification + DB-driven permissions rearchitecture. Proposed only, not implemented, 3 decisions still open. Do not treat it as the current architecture.

## Process

Per-phase lifecycle, verification requirements, and the Definition of Done live in [`docs/engineering/`](./docs/engineering/). Phase status vocabulary (✅ / ⏳ / ⛔ / ☐) is defined in [`docs/engineering/release-checklist.md`](./docs/engineering/release-checklist.md).

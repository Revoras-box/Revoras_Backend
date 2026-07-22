# Revoras — Current State

**Canonical starting point.** Read this first, in any new session or as a new contributor, before reading anything else.

This file holds only high-level, durable facts: where the project is, what phase is active, and what gates production. It is deliberately short. Detail lives in the docs it points to — if you find yourself adding implementation notes here, they belong in `docs/` instead.

Last updated: 2026-07-21.

## Where we are

| | |
|---|---|
| **Frozen milestone** | `customer-experience-v1` — tagged on **both** repos (`Revoras` frontend, `Revoras_Backend`), 2026-07-16. **Superseded 2026-07-20**: the user requested a full palette/component redesign (gold, replacing Terra Jade) applied everywhere, including the frozen customer pages — a deliberate, informed decision to break this freeze. Logic/APIs/routing were not touched, presentation only. The original QA bar (0 console errors, 0 overflow, light+dark, mobile+desktop) should be re-run before calling v2 done. |
| **Active phase** | **Phase 3 — Business Experience** (see split below) |
| **Design system** | **Gold v2** (supersedes Terra Jade v1). Single warm-gold accent on a black/white/neutral base, Tailwind v4 CSS-first tokens, motion 150/250/400 (unchanged). Spec: [`../Revoras/docs/DESIGN_SYSTEM.md`](../Revoras/docs/DESIGN_SYSTEM.md); living reference at `/design-system` in the running frontend. All Phase 3 UI is built in this language. |
| **Backend** | Phases 0–2.6 complete (Knex + clean-architecture rewrite, discovery, filters, curation, favorites, offers, booking experience). Reference: [`docs/README.md`](./docs/README.md) |

## Phase 3 split

Phase 3 is split into three tracks. The split matters: **3A is a redesign, not a rebuild.** Those pages already exist and work — treat their logic and API integrations as done, and change only presentation. 3B is genuinely new UI over backends that already ship.

### 3A — Dashboard Redesign (existing UI)

Apply the current Gold v2 system; improve layout, responsiveness, interaction, and consistency. **Keep existing API integrations intact.**

Dashboard · Calendar · Appointments · Customers · Professionals · Services · Payments · Analytics · Reviews · Notifications · Settings

**These pages are token-driven, not hardcoded.** They use semantic tokens (`text-on-surface`, `border-border`, `text-primary`), so the 2026-07-20 Gold v2 palette swap propagated automatically — the only hardcoded hex found here were 2 Razorpay widget `theme.color` values (`subscription/page.tsx`, `StepSubscription.tsx`), fixed in the same pass. The shared layout system also already exists in `components/ui` (`AppShell`, `Sidebar`, `TopNav`, `PageHeader`, `StatCard`, `Card`, `DataTable`, `EmptyState`, `Section`, `Badge`, `QuickAction`). **3A's remaining work is content and interaction gaps, not restyling** — e.g. appointments has no kanban, calendar has no drag.

Dashboard content gaps closed 2026-07-17: welcome header, quick actions, today's schedule preview, subscription status, verification status.

Mobile + correctness pass 2026-07-19:

- **`DataTable` is now mobile-first.** It was `min-w-max` inside `overflow-x-auto`, so every business table (Appointments, Customers, Professionals, Services, Payments) could only scroll sideways on a phone — and horizontal scroll inside a vertically scrolling page is close to undiscoverable, so columns past the second were effectively invisible. Below `md` it renders one card per row: first column is the identity header, the rest are label–value pairs, with `hideOnMobile` for low-signal columns. **Business owners here work from a phone, so cards are the primary layout, not a degraded one.**
- **Dark mode is now available on the business side.** `ThemeToggleButton` already existed and was wired into the customer navbar and admin layout, but never into `BusinessShell`.
- **Fixed a crash on the Professionals page.** `rating.toFixed is not a function` — node-postgres returns `decimal` columns as **strings**, so the API types saying `number` typechecked cleanly while throwing at runtime, and the `rating > 0` guard hid it because string coercion made it pass. It only fired for businesses that actually had a rating. Now `formatRating()` in `lib/format.ts` owns this; five call sites had the same latent bug.
- **Fixed three infinite-skeleton bugs.** `my-profile`, `settings` (profile + hours) and `verification` folded the error case into their loading check, so a failed request span forever. Settings was the worst: it rendered the form with every field blank, and saving that would have overwritten the owner's real profile with empty strings.
- Verification document types now name what an Indian business actually holds — Shop & Establishment licence, GST certificate, Aadhaar/PAN — with hints. The backend `value`s are unchanged.

**Auth rate limiting fixed 2026-07-19.** `authLimiter` was 5 attempts per 15 minutes, keyed by IP, counting every request including successes. Both halves were wrong, and it locked the dev out repeatedly during this session's QA:

- **Counting successes** meant five *correct* logins locked you out. A salon whose staff all sign in from one wifi connection would break itself on a normal morning. `rateLimit` gained `skipSuccessfulRequests`, which refunds the slot on a <400 response (re-reading from the store, so a window that rolled over mid-request doesn't hand out free attempts).
- **Keying by IP** punished shared/NAT'd connections while barely inconveniencing an attacker with a few IPs. Brute force attacks *an account*, so `authLimiter` now keys by the account being targeted (email/phone from the body, token for token-bearing endpoints) at 10/15min. A new `authFloodLimiter` keeps a generous per-IP ceiling (100/15min) to catch one source working through many accounts — the case per-account keying can't see.

Note this is the *second* line of defence: `user.repository`'s `recordFailedLogin` already locks an account in the database after 5 failures regardless of source IP, which is why the limiter doesn't need to be tight enough to stop a determined attacker on its own.

Registration is deliberately **not** refunded on success — a successful signup is exactly what account-spam looks like — so it moved to its own `registerLimiter` (10/hour/IP, counts everything). Splitting these was necessary: `skipSuccessfulRequests` is correct for sign-in and actively wrong for sign-up.

Verified 5/5: eight consecutive successful logins all allowed, failures still block (at 11, not 5), and one blocked account doesn't lock out another or the real owner.

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

**Team invites — BUILT 2026-07-19.** Before this, an owner could not add a professional at all unless that person already had a Revoras account: `addMember` 404'd with "they need to sign up first". That dead end also sat inside the onboarding wizard's Team step, i.e. at the moment an owner is *least* likely to be adding existing users.

- `20260719000003_create_business_invites_table` — a separate table, because `business_members.user_id` is NOT NULL and an invited person has no user row until they accept. **`email` is nullable on purpose**: a salon owner here usually has a barber's phone and nothing else, and requiring email would rebuild the dead end. Pending is derived from `accepted_at`/`revoked_at`/`expires_at` rather than a status column; two partial unique indexes enforce one live invite per person per business. Token handling mirrors `password_reset_tokens` (store SHA-256, never the token).
- Owner endpoints on the business router under `team.manage`; **public** `GET /api/invites/:token` and `POST /api/invites/:token/accept` mounted separately, since the invitee has no account and `requireBusinessMember` could never pass. Accept runs in a transaction — a partial failure would strand someone with an account but no membership and a consumed invite.
- **The invite link is the product, not the email.** The link is always shown and copyable, with a WhatsApp share when there's a phone; email is best-effort delivery and its failure does not fail the invite. This is the Indian-market path — most of these reach people over WhatsApp.
- One flow, not two: the Professionals page and onboarding StepTeam now share `InviteMemberModal`, and the old "must already have an account" modals are deleted. An owner shouldn't have to know which kind of person they're adding.

Verified 21/21 against a running server, plus a browser pass driving owner-invites → invitee-opens-link-in-a-clean-session → joins → appears on the team.

#### Remaining 3B feature gaps (pages exist, specs don't fully)

- **Offers** — ~~status filter tabs, Duplicate, Pause~~ **done 2026-07-19**: tabs with per-status counts, and a row action menu (Edit / Duplicate / Pause–Resume / Delete). Pause is just `isActive: false`, since the server derives `status` from it; Resume is disabled on expired offers because their window is already past. Still missing: richer performance/analytics.
- **Verification** — ~~Verified Badge Preview~~ **done 2026-07-19**: `VerifiedBadgePreview` renders the badge on the two surfaces a customer actually meets it (search result card, profile header) using the business's real name/photo, dimmed pre-approval and live once approved. Deliberately a static mock, not the real `BusinessCard` — reusing that would couple the dashboard to the frozen customer-experience-v1 surface.

### 3C — Business Journey QA

Runs **after** the 3A/3B UI work and **before** any admin redesign. Browser QA across the full host funnel:

host signup → onboarding wizard → gallery upload *(needs R2)* → ₹99 subscription checkout *(needs Razorpay)* → verification submission → dashboard entry → subscription renewal *(needs scheduler)* → offers → Verification Center

## Phase 4 — Explore Map Experience

Location as a first-class way to discover businesses: a split-screen list + live map on desktop, a full-screen map with a swipeable results sheet on mobile, powered by viewport-based loading. Framed as a product initiative, not "embed a map." Sequenced so the map is built on real coordinates, never placeholders.

**What already existed before Phase 4 (verified, not assumed):** the map endpoint `GET /api/discover/businesses/map` with bounding-box SQL (`listForMap`, `discovery.repository.js`), the `idx_businesses_lat_lng` index, Haversine distance + the featured/premium/trust ranking blend, and Leaflet as a frontend dependency. The backend viewport-loading story was ~80% done. **The blocker was never the map — it was that nothing had coordinates:** `lat`/`lng` were optional, no onboarding step captured them, and seeds had none, so the endpoint (which filters `whereNotNull` on both) returned almost nothing.

### 4A — Location Foundation ✅ (complete, 2026-07-21)

Every business that reaches ACTIVE must have real coordinates.

- ✅ **Geocoding provider layer** — mirrors the `SearchProvider`/`StorageProvider`/`CacheProvider` pattern. `src/geocoding/` has `GeocodingProvider` (contract), `NominatimGeocodingProvider`, and `index.js` (active-provider selector). Nominatim chosen because its ODbL licence is the only mainstream option that permits **permanently storing** coordinates (Google forbids >30-day caching; Mapbox reserves it for the paid permanent endpoint). Swapping to a paid provider later is one new class + one line. The provider serializes calls at 1 req/sec (deployment-wide budget), sets a real User-Agent, retries transient 5xx/network blips, and carries the required attribution string.
- ✅ **Geocoding service + routes** — `GET /api/geocoding/search` (forward) and `/reverse`, authenticated (`authenticate` + `strictLimiter` 20/min per user). Proxied through the backend, never called from the browser, because the User-Agent, the shared rate budget, and any future API key all have to live server-side. Results cached 7 days (address data changes on a monthly timescale, and the provider's 1 req/sec ceiling makes cache hits matter); reverse lookups round coordinates to ~11 m so a dragged pin doesn't spray cache misses. **Provider outages degrade to a 503 with an actionable message** ("set your location by placing the pin on the map"), never an opaque 500 — the funnel must not repeat the R2-401 freeze.
- ✅ **Coordinates required for ACTIVE** — new required onboarding step `location` (index 1, right after Basics), completion gated on `lat != null && lng != null` (`!= null`, not truthiness — lat/lng 0 is a valid point). Enforced through the existing required-step submit gate rather than a bespoke check on the active transition. Optional on a DRAFT. `updateBusiness` + the business validator already persisted `lat`/`lng`.
- ✅ **`LocationPicker.tsx` + `StepLocation.tsx`** — shared reusable picker (search → forward geocode → CARTO-light Leaflet map → draggable/tap-to-place gold pin → reverse geocode on `dragend` only, one request per drag). New required wizard step at index 1; the gate to continue is a placed pin, not a matched address, so unmapped-area owners aren't stuck. All step eyebrows renumbered to /10.
- ✅ **Profile location editor** — same `LocationPicker` in Settings › Profile; a moved pin mirrors its resolved address back into the text fields.
- ✅ **Seed/dev coordinate backfill** — `08_map_fixtures.js`: 12 active businesses across real Bengaluru neighbourhoods (dense, one city, so viewport/pan/"Search this area" are exercisable), plus the dev `test-barbershop` moved to Koramangala. **Verified end-to-end:** full-city bbox → 13, tight Koramangala box → 4, nearby+radius → distance-sorted. `/locations` (fictional Manhattan, never calls the API) still needs replacing when 4B builds the real Explore page. **Market confirmed: India.** Note: `06_dev_fixtures.js` does a destructive user-delete that now FK-conflicts with test bookings — reseeding it needs fixing (targeted update used for the dev DB).

### 4B — Explore Map (desktop) ☐

Split-screen list + live map, no page refresh. Viewport loading replaces markers on pan. **"Search this area" button — exactly one request per click, never continuous auto-fetch.** Custom markers (see open decision below), selected/hover state synchronized between card and pin.

### 4C — Mobile Explore ☐

Full-screen map + swipeable bottom-sheet of cards, instead of the split view.

### 4D — Smart Discovery ☐ (later)

Heat map / trending neighbourhoods / nearby-now, and clustering **only if** city density later demands it.

### Open decisions

- **Marker content** — price-pill (Airbnb) is a poor fit: a salon's "from ₹299" is its cheapest add-on, not what anyone pays, so every pin converges on the same low anchor. Prototype rating vs. category-glyph vs. price against real data before locking.
- **Clustering** — deferred. `listForMap` already has `limit` and the ranking blend, so "top N by rank in viewport" may beat clustering outright at our density. Add it only when density forces it.
- **Rate limiting** — `apiLimiter` is 100/min per IP shared across all `/api/discover` routes; a "Search this area"-heavy session sits on top of that. Review before 4B rollout. (Geocoding itself is isolated on `strictLimiter`.)

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
- ~~**`authLimiter` is 5 logins per 15 minutes per IP**~~ **FIXED 2026-07-19** — see below.
- **Notifications (Phase 2.6)** — table, service, routes, and email service exist, but `notification.service` never actually sends email and most events are uncovered.
- **Invoice** — deferred to V1.1.
- **V2 redesign** (`report.md`) — a proposed Business/staff unification + DB-driven permissions rearchitecture. Proposed only, not implemented, 3 decisions still open. Do not treat it as the current architecture.

## Process

Per-phase lifecycle, verification requirements, and the Definition of Done live in [`docs/engineering/`](./docs/engineering/). Phase status vocabulary (✅ / ⏳ / ⛔ / ☐) is defined in [`docs/engineering/release-checklist.md`](./docs/engineering/release-checklist.md).

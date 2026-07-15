# API Reference

Source: every file in `src/routes/`, cross-checked against their mount points in `src/server.js`. This is a markdown reference, not a generated OpenAPI spec — request/response shapes are summarized from the corresponding validator/service, not machine-verified against the code on every doc update. Treat request/response examples as accurate as of 2026-07-13; re-check the validator (`src/validators/*.validator.js`) for the authoritative shape before building a client against it.

**Base URL**: `{API_BASE}/api` — all paths below are relative to `/api`.

**Auth legend**:
- 🔓 Public — no token required
- 🔓* Optional auth — works without a token, uses one if present (`optionalAuth`)
- 🔑 Person — `Authorization: Bearer <token>` from a customer/business login (`authenticate`)
- 🔑👥 Person + Business Member — 🔑 plus active membership in `:studioId` (`requireBusinessMember`)
- 🔑👥🔒`key` — 🔑👥 plus the named permission key (`requirePermission("key")`)
- 🛡️ Admin — separate admin JWT (`authenticateAdmin` + `requireAdmin`)
- 🛡️⭐ Super admin only — 🛡️ plus `role === "super_admin"` (enforced in service, not route middleware)
- 🪝 Webhook — HMAC-signature authenticated, not a JWT

Every route additionally passes through a rate limiter (`authLimiter`: 5/15min, `apiLimiter`: 100/min, `strictLimiter`: 20/min) — see [`architecture.md`](./architecture.md) and [`PRODUCTION_READINESS.md`](../PRODUCTION_READINESS.md) H1 for the current in-memory/per-instance caveat.

---

## Health

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health` | 🔓 | Runs `SELECT 1` against the DB; `200 {status:"ok"}` or `503 {status:"error"}` |

## Customer auth (`/users`)

| Method | Path | Auth | Body | Notes |
|---|---|---|---|---|
| POST | `/users/signup` | 🔓 (authLimiter) | `{name, email, phone?, password}` | Requires a prior consumed email verification proof |
| POST | `/users/login` | 🔓 (authLimiter) | `{email\|phone, password}` | Subject to account lockout after 5 failed attempts |

## Business & shared person auth (`/auth`)

| Method | Path | Auth | Body | Notes |
|---|---|---|---|---|
| POST | `/auth/business/register` | 🔓 (authLimiter) | `{ownerName, email, phone, password, businessName, address, city, state, zipCode, country, designation?, providesServices?}` | Requires both email AND phone verified. One transaction: user + business + owner member + default working hours. See [`business-onboarding.md`](./business-onboarding.md) |
| POST | `/auth/business/login` | 🔓 (authLimiter) | `{email\|phone, password}` | One endpoint for owners and staff alike. Response includes `memberships[]` with resolved permissions per business |
| GET | `/auth/me` | 🔑 | — | Current person + `memberships[]` |
| POST | `/auth/change-password` | 🔑 | `{currentPassword, newPassword}` | Bumps `token_version` — revokes all other existing tokens |

## Google OAuth (`/auth/google`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/auth/google` | 🔓 | Redirects to Google consent screen |
| GET | `/auth/google/callback` | 🔓 | Google redirects here; on success redirects browser to `{FRONTEND_URL}/auth/success?token=...&user=...` |

## Verification (OTP) (`/verification`)

| Method | Path | Auth | Body | Notes |
|---|---|---|---|---|
| POST | `/verification/send-verification` | 🔓 (authLimiter) | `{identifier}` (email or phone) | Stores OTP in `verifications` table |
| POST | `/verification/verify-code` | 🔓 (authLimiter) | `{identifier, otp}` | Marks verified; consumed later by signup (single-use, 30-min window) |

## Password reset (`/password`)

| Method | Path | Auth | Body | Notes |
|---|---|---|---|---|
| POST | `/password/forgot-password` | 🔓 (authLimiter) | `{email}` | Always responds success-shaped regardless of whether the email exists (no account enumeration) |
| POST | `/password/reset-password` | 🔓 (authLimiter) | `{token, newPassword}` | Bumps `token_version` |

## Bookings (`/bookings`)

**Status lifecycle (Phase 2.5):** `pending → confirmed → checked_in → completed`, with `cancelled`/`no_show` branches. `bookingStateMachine.js` is the single authority for which moves are legal (`TRANSITIONS` matrix) — both the customer cancel path and the business status-update path route through it, and an illegal move (e.g. skipping straight to `completed`) is a 400 regardless of caller. Every transition, including the initial `null → pending` at creation, is logged to `booking_status_events` (the "timeline"). See [`booking-lifecycle.md`](./booking-lifecycle.md).

| Method | Path | Auth | Body/Query | Notes |
|---|---|---|---|---|
| GET | `/bookings/availability` | 🔓 (apiLimiter) | `?businessMemberId&date&duration` | Returns open slots for a professional/date |
| POST | `/bookings` | 🔑 (strictLimiter) | `{studioId, businessMemberId, serviceIds[], date, startTime, notes?}` | See [`booking-lifecycle.md`](./booking-lifecycle.md). Phase 2.4: the best applicable offer is auto-applied and snapshotted onto the booking (`offer_id`/`original_amount`/`discount_amount`; `total_amount` becomes post-discount) |
| POST | `/bookings/quote` | 🔑 (apiLimiter) | `{studioId, serviceIds[]}` | Phase 2.4 — price + applicable-offer preview, no booking created: `{quote:{originalAmount, discountAmount, total, offer}}`. Same engine that applies at booking |
| GET | `/bookings` | 🔑 (apiLimiter) | `?status&category&page&limit` | `category`: `upcoming\|past\|cancelled` |
| GET | `/bookings/:id` | 🔑 (apiLimiter) | — | Scoped to requester. Phase 2.5: includes `allowedNextStatuses` (the state machine's legal moves) |
| GET | `/bookings/:id/timeline` | 🔑 (apiLimiter) | — | Phase 2.5 — the status-event log (from/to status, actor, reason), oldest first |
| GET | `/bookings/:id/cancellation-quote` | 🔑 (apiLimiter) | — | Phase 2.5 — policy outcome without cancelling: `{tier: free\|fee\|blocked\|terminal, feeAmount, refundAmount, message, ...}` |
| PATCH | `/bookings/:id/cancel` | 🔑 (strictLimiter) | `{reason?}` | Policy-aware (Phase 2.5): free / late-fee / blocked per the business's `cancellation_policy`; records `cancellation_fee`. Returns the outcome |
| PATCH | `/bookings/:id/reschedule` | 🔑 (strictLimiter) | `{date, startTime}` | In-place (no new booking); re-runs the conflict check; refused past the no-cancel cutoff or once checked-in |

## Payments (`/payments`)

| Method | Path | Auth | Body | Notes |
|---|---|---|---|---|
| POST | `/payments/create-order` | 🔑 (apiLimiter) | `{bookingId}` | Creates a Razorpay order; 503 if Razorpay unconfigured |
| POST | `/payments/verify` | 🔑 (apiLimiter) | `{bookingId, razorpay_order_id, razorpay_payment_id, razorpay_signature}` | Client-side confirmation path — not the source of truth, see [`payment-lifecycle.md`](./payment-lifecycle.md) |
| POST | `/payments/webhook` | 🪝 | Razorpay event payload | HMAC-verified against raw body; always 200 to avoid retry storms |

## Discovery — public browsing (`/discover`)

Route order matters: `/businesses/map` is registered before `/businesses/:id` so Express doesn't capture `"map"` as an id.

| Method | Path | Auth | Query | Notes |
|---|---|---|---|---|
| GET | `/discover/businesses/map` | 🔓* (apiLimiter) | `?lat&lng&radius&categoryId` | Map-optimized result set |
| GET | `/discover/businesses/:id/services` | 🔓* | — | |
| GET | `/discover/businesses/:id/professionals` | 🔓* | — | Only members with `provides_services=true` |
| GET | `/discover/businesses/:id` | 🔓* | — | Full business detail, incl. `services`, `professionals` (each with `badges[]`), `workingHours`, `gallery`, the Phase 1.2 profile fields (`website`, `social_links`, `languages`, `payment_methods`, `policies`, `accessibility`, `house_rules`), `trust` (Phase 1.4a: `score`/`band` + metrics: cancellation/no-show rates, avg response minutes, business age, profile completion; `verified` boolean set by 1.4b), and `badges[]` (Phase 1.4c) |
| GET | `/discover/businesses` | 🔓* | `?search&categoryId&city&lat&lng&radiusKm&sortBy&page&limit` + filters below | Haversine geo search when `lat`/`lng` given. Each card carries `badges[]` + `rankScore` (Phase 1.4c) and `featured` (Phase 2.2) |
| GET | `/discover/professionals/:id` | 🔓* | — | Public professional profile, incl. Phase 1.3a fields (`bio`, `languages`, `education`, `certifications`, `awards`, `social_links`, `featured_service_ids`), `portfolio` and `certificates` (1.3b), and `badges[]` (1.4c) |
| GET | `/discover/collections` | 🔓* | `?city` | Phase 2.2 — active, in-window collections ordered by `display_order`. `city` matches against `target_city`. Metadata only, no businesses |
| GET | `/discover/collections/:slug` | 🔓* | `?page&limit` | Phase 2.2 — one resolved collection: `{collection, businesses[], pagination}`. Businesses are pinned picks first (each flagged `pinned:true`), then filter-matched auto-fill. **404** if the collection is inactive or outside its publish window |

### `GET /discover/businesses` — full query surface

`sortBy` ∈ `recommended`(default)\|`rating`\|`distance`\|`reviews`\|`name` (Phase 2 added `popular`\|`trending`\|`newest`; Phase 2.1 added `priceLow`\|`priceHigh`\|`fastestResponse`).

| Filter | Added | Notes |
|---|---|---|
| `minRating`, `priceMin`, `priceMax`, `serviceCategoryId` | 2.1 | Price filters test "has an active service in range", not a business-wide range |
| `amenities`, `paymentMethods`, `languages`, `accessibility` | 2.1 | Comma-separated; OR-within-facet via jsonb containment |
| `openNow`, `openToday` | 2 / 2.1 | Hard correctness filters, not sorts |
| `verifiedOnly`, `premiumOnly` | 2.1 | |
| `featuredOnly` | 2.2 | Restricts to businesses currently inside their featured window and matching region targeting |
| `hasOffers` | 2.4 | Restricts to businesses with at least one currently-live offer (powers the Offers rail + "Has offers" filter). Cards carry an `offer` summary badge when present |

**Boolean flags** (`openNow`, `openToday`, `verifiedOnly`, `premiumOnly`, `featuredOnly`) accept only literal `true`/`1` as true; any other value — including `false`, `0`, or omission — is false. They are *not* `z.coerce.boolean()`, which would treat the string `"false"` as `true` (see report.md §V4.11).

All discovery results are filtered server-side to `approval_status='approved' AND is_active=true` — see [`business-onboarding.md`](./business-onboarding.md).

**Phase 1.4c — badges & ranking.** Badges are *derived* (no table) from cached trust/business signals. Business badges: `verified`, `premium` (placeholder until 1.5), `top_rated`, `popular`, `trending`, `new`. Professional badges: `verified_professional`, `top`, and one experience tier (`senior`/`expert`/`master`). `sortBy=recommended` ranks by a weighted composite (trust 40 / rating 25 / popularity 15 / distance 15 / premium 5 — `verified` is not double-counted since it already feeds the trust score); the same weights drive both the SQL ordering and each card's `rankScore`. Only public signals are exposed — verification documents/notes never appear here.

## Categories (`/categories`)

| Method | Path | Auth | Query | Notes |
|---|---|---|---|---|
| GET | `/categories` | 🔓 (apiLimiter) | `?type=business\|service` | |

## Reviews (`/reviews`)

| Method | Path | Auth | Body | Notes |
|---|---|---|---|---|
| GET | `/reviews/business/:studioId` | 🔓* | `?page&limit` | |
| GET | `/reviews/professional/:memberId` | 🔓* | `?page&limit` | |
| GET | `/reviews/me` | 🔑 | — | |
| POST | `/reviews` | 🔑 (strictLimiter) | `{bookingId, rating, title?, comment?, photos?}` | `studioId`/`businessMemberId` derived from the booking, never accepted directly; one review per booking (DB `UNIQUE`) |
| PATCH | `/reviews/:id` | 🔑 (strictLimiter) | `{rating?, title?, comment?}` | Owner-only (enforced in service) |
| DELETE | `/reviews/:id` | 🔑 (strictLimiter) | — | Recalculates business/member rating |
| POST | `/reviews/:id/helpful` | 🔑 (strictLimiter) | — | |
| DELETE | `/reviews/:id/helpful` | 🔑 (strictLimiter) | — | |

## Profile & favorites (`/profile`)

| Method | Path | Auth | Body | Notes |
|---|---|---|---|---|
| GET | `/profile` | 🔑 (apiLimiter) | — | |
| PUT | `/profile` | 🔑 (strictLimiter) | profile fields | |
| DELETE | `/profile` | 🔑 (strictLimiter) | — | Soft deactivation, not a hard delete |
| PUT | `/profile/notifications` | 🔑 (strictLimiter) | notification prefs | |
| GET | `/profile/favorites` | 🔑 (apiLimiter) | — | Full business cards, newest-saved first |
| GET | `/profile/favorites/ids` | 🔑 (apiLimiter) | — | Phase 2.3 — `{studioIds[], memberIds[]}`. Id-only projection that fills the heart on discovery cards; prefer this over `/favorites` when you only need to know *whether* something is saved |
| POST | `/profile/favorites/:studioId` | 🔑 (strictLimiter) | — | **409** if already favorited, **404** if the business doesn't exist |
| DELETE | `/profile/favorites/:studioId` | 🔑 (strictLimiter) | — | **404** if not favorited |
| GET | `/profile/favorites/professionals` | 🔑 (apiLimiter) | — | Phase 2.3 — favorited professionals + their business |
| POST | `/profile/favorites/professionals/:memberId` | 🔑 (strictLimiter) | — | Phase 2.3 — **404** unless the professional is publicly discoverable (active member of an active business), **409** if already favorited |
| DELETE | `/profile/favorites/professionals/:memberId` | 🔑 (strictLimiter) | — | Phase 2.3 |
| GET | `/profile/recently-viewed` | 🔑 (apiLimiter) | `?limit` (default 12, max 50) | Phase 2.3 — most-recent-first; excludes businesses since de-listed |
| GET | `/profile/recently-viewed/professionals` | 🔑 (apiLimiter) | `?limit` | Phase 2.3 |
| POST | `/profile/recently-viewed/:studioId` | 🔑 (apiLimiter) | — | Phase 2.3 — **204**, no body. Idempotent: a repeat view UPSERTs `viewed_at` rather than inserting. Uses `apiLimiter`, not `strictLimiter`, because it fires on every page view — 20/min would trip during ordinary browsing |
| POST | `/profile/recently-viewed/professionals/:memberId` | 🔑 (apiLimiter) | — | Phase 2.3 — **204** |
| DELETE | `/profile/recently-viewed` | 🔑 (strictLimiter) | — | Phase 2.3 — "Clear history" |

> **Route order:** the `/professionals` routes are registered before their `/:studioId` siblings — see the note in `profile.routes.js`.
>
> **Recently-viewed is server-side for authenticated users only** (Phase 2.3 decision D2). Anonymous visitors fall back to a client-side localStorage store (`Revoras/src/lib/recently-viewed.ts`). See report.md §V4.12 for why that branch is currently unreachable.

## Notifications (`/notifications`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/notifications` | 🔑 (apiLimiter) | Paginated |
| GET | `/notifications/unread-count` | 🔑 | |
| PATCH | `/notifications/read-all` | 🔑 | |
| PATCH | `/notifications/:id/read` | 🔑 | |

## Business — creation & mine (`/business`)

Only the two genuinely flat paths live here — everything `:studioId`-scoped is in the next section. See `business.routes.js`'s own comment for why: a second router with a `:studioId`-shaped route at the same prefix is a real Express routing bug, not just style.

| Method | Path | Auth | Body | Notes |
|---|---|---|---|---|
| POST | `/business` | 🔑 (apiLimiter) | business fields | Existing user opens an additional business; becomes owner |
| GET | `/business/mine` | 🔑 (apiLimiter) | — | Every business the caller belongs to |

## Business operations (`/business/:studioId`)

All routes here run `apiLimiter → authenticate → requireBusinessMember` first; permission keys are additional, per mutation route. See [`rbac-model.md`](./rbac-model.md) for exactly what each key means.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/business/:studioId` | 🔑👥 | |
| PATCH | `/business/:studioId` | 🔑👥🔒`settings.manage` | Partial update. Phase 1.2 profile fields accepted alongside the basics: `website` (nullable), `socialLinks` (object: instagram/facebook/twitter/youtube/tiktok/linkedin/whatsapp), `languages`/`paymentMethods`/`accessibility` (string[]), `houseRules` (string[]), `policies` (object: cancellation/rescheduling/refund/general), `amenities` (string[]) |
| DELETE | `/business/:studioId` | 🔑👥🔒`settings.manage` | Deactivates, doesn't hard-delete |
| POST | `/business/:studioId/logo` | 🔑👥🔒`settings.manage` | Multipart (`file` field). Uploads to Cloudflare R2 via `media.service.js`, replaces the previous logo object if one exists |
| GET | `/business/:studioId/gallery` | 🔑👥 | Member-only view; the public-facing gallery is returned inline from `GET /discover/businesses/:id` instead |
| POST | `/business/:studioId/gallery` | 🔑👥🔒`settings.manage` | Multipart (`file` field). Max 20 images per business; first upload becomes the cover automatically |
| PATCH | `/business/:studioId/gallery/reorder` | 🔑👥🔒`settings.manage` | Body `{ orderedImageIds: uuid[] }` - full replace of the ordering, must include every existing image id exactly once |
| PATCH | `/business/:studioId/gallery/:imageId/cover` | 🔑👥🔒`settings.manage` | |
| DELETE | `/business/:studioId/gallery/:imageId` | 🔑👥🔒`settings.manage` | If the removed image was the cover, the next image (by sort order) is promoted automatically |
| GET | `/business/:studioId/members` | 🔑👥 | |
| GET | `/business/:studioId/members/:memberId` | 🔑👥 | Includes a computed `profile_completion` % |
| POST | `/business/:studioId/members` | 🔑👥🔒`team.manage` | Links an *existing* user by email — see [`business-onboarding.md`](./business-onboarding.md) |
| PATCH | `/business/:studioId/members/:memberId` | 🔑👥🔒`team.manage` | Blocked from demoting/removing the last owner. Phase 1.3 profile fields accepted: `bio` (nullable), `languages`/`education`/`certifications`/`awards` (arrays; education/cert/award are structured objects), `socialLinks` (object), `featuredServiceIds` (uuid[]), plus `specialties`/`experienceYears` |
| DELETE | `/business/:studioId/members/:memberId` | 🔑👥🔒`team.manage` | Soft-remove |
| GET | `/business/:studioId/members/:memberId/portfolio` | 🔑👥 | Member-only view; public view is inline on `GET /discover/professionals/:id` |
| POST | `/business/:studioId/members/:memberId/portfolio` | 🔑👥🔒`team.manage` | Multipart (`file`, optional `caption`). Max 30 images; first upload becomes cover |
| PATCH | `/business/:studioId/members/:memberId/portfolio/reorder` | 🔑👥🔒`team.manage` | Body `{ orderedImageIds: uuid[] }` — exact permutation of current set |
| PATCH | `/business/:studioId/members/:memberId/portfolio/:imageId/cover` | 🔑👥🔒`team.manage` | |
| PATCH | `/business/:studioId/members/:memberId/portfolio/:imageId` | 🔑👥🔒`team.manage` | Body `{ caption }` |
| DELETE | `/business/:studioId/members/:memberId/portfolio/:imageId` | 🔑👥🔒`team.manage` | Auto-promotes next cover if the removed image was cover |
| GET | `/business/:studioId/members/:memberId/certificates` | 🔑👥 | Member-only view |
| POST | `/business/:studioId/members/:memberId/certificates` | 🔑👥🔒`team.manage` | Multipart (optional `file`) + metadata: `title`*, `issuer`*, `issuedDate`, `expiryDate`, `credentialId`, `verificationUrl` |
| PATCH | `/business/:studioId/members/:memberId/certificates/:certId` | 🔑👥🔒`team.manage` | Multipart (optional `file`) + partial metadata |
| DELETE | `/business/:studioId/members/:memberId/certificates/:certId` | 🔑👥🔒`team.manage` | |

### Self-service — `/api/me/*` (Phase 1.3c)

Every route resolves the caller's **own** membership from the authenticated user + `studioId` (query param); no member id is ever accepted from the request. `🔑` = authenticated user (any active member of the given business).

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/me/profile?studioId=` | 🔑 | Own profile incl. computed `profile_completion` % and `profile_missing` hints |
| PATCH | `/me/profile?studioId=` | 🔑 | Self-editable only: `bio`, `languages`, `education`, `awards`, `socialLinks`. Business-controlled fields (role/permissions/designation/experience/featured services) are rejected |
| GET/POST/PATCH/DELETE | `/me/portfolio*?studioId=` | 🔑 | Own portfolio — same operations as the owner routes, resolved to the caller's membership |
| GET/POST/PATCH/DELETE | `/me/certificates*?studioId=` | 🔑 | Own certificates |
| GET | `/business/:studioId/services` | 🔑👥 | |
| GET | `/business/:studioId/services/:serviceId` | 🔑👥 | |
| POST | `/business/:studioId/services` | 🔑👥🔒`services.manage` | |
| PATCH | `/business/:studioId/services/:serviceId` | 🔑👥🔒`services.manage` | |
| DELETE | `/business/:studioId/services/:serviceId` | 🔑👥🔒`services.manage` | Deactivates |
| GET | `/business/:studioId/offers` | 🔑👥 | Phase 2.4 — all offers incl. scheduled/expired, each with derived `status` + `usageCount` |
| GET | `/business/:studioId/offers/:offerId` | 🔑👥 | Studio-scoped (404 from another studio) |
| POST | `/business/:studioId/offers` | 🔑👥🔒`offers.manage` | Phase 2.4 — `{title, discountType: flat\|percentage, discountValue, maxDiscountAmount?, minSpend?, appliesTo: business\|services, serviceIds?, startAt?, endAt?, isActive?, maxUses?, maxUsesPerUser?, firstTimeOnly?}`. Cross-field validation (percentage ≤ 100, serviceIds required when scoped, start<end) |
| PATCH | `/business/:studioId/offers/:offerId` | 🔑👥🔒`offers.manage` | Partial patch; switching `appliesTo` clears/sets service links |
| DELETE | `/business/:studioId/offers/:offerId` | 🔑👥🔒`offers.manage` | Past bookings keep their frozen discount (offer_id → null) |
| GET | `/business/:studioId/bookings` | 🔑👥 | `?search&from&to&businessMemberId&status&paymentStatus&page&limit`. Phase 2.5: each row carries `allowedNextStatuses` |
| PATCH | `/business/:studioId/bookings/:id` | 🔑👥🔒`bookings.manage` | Reschedule and/or reassign professional; in-place, re-runs the conflict check |
| PATCH | `/business/:studioId/bookings/:id/status` | 🔑👥🔒`bookings.manage` | Phase 2.5 — `{status: confirmed\|checked_in\|completed\|cancelled\|no_show, reason?}`. Legality decided by the booking state machine (single authority) — an illegal move (e.g. `pending→completed`) is a 400 regardless of permission |
| GET | `/business/:studioId/customers/:userId/bookings` | 🔑👥 | A customer's booking history at this business |
| GET | `/business/:studioId/dashboard` | 🔑👥 | Today-focused snapshot |
| GET | `/business/:studioId/analytics` | 🔑👥🔒`analytics.view` | Trends over time, distinct from dashboard |
| GET | `/business/:studioId/working-hours` | 🔑👥 | |
| PUT | `/business/:studioId/working-hours` | 🔑👥🔒`settings.manage` | Full replace, all 7 days |
| GET | `/business/:studioId/time-off` | 🔑👥 | |
| POST | `/business/:studioId/time-off` | 🔑👥 | No permission key — scoped to the caller's own time in the controller |
| DELETE | `/business/:studioId/time-off/:id` | 🔑👥 | Same as above |

### Onboarding wizard (Phase 1.5a)

Host signup creates a **DRAFT** business; the wizard walks it to `PAYMENT_PENDING`. Reads member-only; writes require `settings.manage`. Field saves reuse the business update logic; status only ever changes via `BusinessLifecycleService`. See [`business-lifecycle-state-machine.md`](./business-lifecycle-state-machine.md).

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/host/register` | 🔓 (authLimiter) | Host signup: `{ownerName, email, phone, password, businessName}` (both email+phone OTP-verified first). Creates a User + owner + **DRAFT** business (name only); returns token + memberships + business |
| GET | `/business/:studioId/onboarding` | 🔑👥 | Wizard state: `businessStatus`, `currentStep`, `steps[]` (key/label/required/complete/comingIn), `completionPercent`, `canSubmit`, `missing[]` |
| PATCH | `/business/:studioId/onboarding` | 🔑👥🔒`settings.manage` | Save a step: `{step?, data?}` — `data` is a partial business update (Basics/Information). First edit flips `draft → onboarding`. Services/gallery/hours/documents use their own endpoints |
| POST | `/business/:studioId/onboarding/submit` | 🔑👥🔒`settings.manage` | Requires all required steps complete → transitions to `PAYMENT_PENDING` (the ₹99 gate is wired in 1.5d) |

### Verification Center (Phase 1.4b — business trust verification, **distinct from signup OTP**)

Reads are member-only; mutations require `settings.manage`. Document uploads flow through MediaService (R2). Internal admin notes are **never** returned here.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/business/:studioId/verification` | 🔑👥 | Verification Center: `verified`, `eligibility`, `canStart`, `currentRequest` (with `documents[]`), `history[]`. No internal notes |
| GET | `/business/:studioId/verification/eligibility` | 🔑👥 | Hybrid auto-eligibility: profile ≥60%, ≥3 completed bookings, account ≥7 days |
| POST | `/business/:studioId/verification` | 🔑👥🔒`settings.manage` | Creates a `draft`; requires eligibility; 409 if an open request exists. `{applicantNote?}` |
| POST | `/business/:studioId/verification/:requestId/documents` | 🔑👥🔒`settings.manage` | Multipart `file` + `{type}` (`business_license`\|`id_proof`\|`address_proof`\|`tax_document`\|`other`) |
| DELETE | `/business/:studioId/verification/:requestId/documents/:documentId` | 🔑👥🔒`settings.manage` | Only while `draft`/`more_info` |
| POST | `/business/:studioId/verification/:requestId/submit` | 🔑👥🔒`settings.manage` | `draft`\|`more_info` → `submitted`; requires ≥1 document |

## Admin (`/admin`)

Deliberately isolated auth model — see [`rbac-model.md`](./rbac-model.md#admin-a-separate-simpler-model-by-design). All routes pass `apiLimiter` first; `/login` additionally uses `authLimiter`.

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/admin/login` | 🔓 (authLimiter) | Separate admin JWT, `{id, role}`, 12h expiry |
| GET | `/admin/me` | 🛡️ | |
| GET | `/admin/dashboard` | 🛡️ | Today-focused snapshot |
| GET | `/admin/analytics` | 🛡️ | Business/user growth, revenue over time, top businesses, category breakdown |
| GET | `/admin/activity-log` | 🛡️ | Paginated/filterable audit log |
| GET | `/admin/businesses` | 🛡️ | `?status&search&page&limit&sortBy&sortOrder` |
| GET | `/admin/businesses/:id` | 🛡️ | Includes owner, services, members, working hours |
| PUT | `/admin/businesses/:id` | 🛡️ | Arbitrary field patch + audit log |
| POST | `/admin/businesses/:id/approve` | 🛡️ | Auto-geocodes if lat/lng missing — see [`business-onboarding.md`](./business-onboarding.md) |
| POST | `/admin/businesses/:id/reject` | 🛡️ | `{reason}` required |
| POST | `/admin/businesses/:id/suspend` | 🛡️ | No un-suspend endpoint exists yet |
| POST | `/admin/businesses/:id/geocode` | 🛡️ | Manual re-geocode |
| GET | `/admin/verifications` | 🛡️ | Verification queue (Phase 1.4b). `?status&page&limit`; returns rows + per-status `counts` |
| GET | `/admin/verifications/:id` | 🛡️ | Full request: `documents[]`, `history[]`, and internal `notes[]` (admin-only) |
| POST | `/admin/verifications/:id/review` | 🛡️ | `submitted` → `under_review` |
| POST | `/admin/verifications/:id/approve` | 🛡️ | → `approved`; flips trust `verified`=true + recomputes score. `{note?}` |
| POST | `/admin/verifications/:id/reject` | 🛡️ | → `rejected`; `{reason}` required |
| POST | `/admin/verifications/:id/suspend` | 🛡️ | `approved` → `suspended`; clears trust `verified`. `{reason}` required |
| POST | `/admin/verifications/:id/request-info` | 🛡️ | → `more_info`; `{reason}` required |
| PATCH | `/admin/verifications/:id/documents/:documentId` | 🛡️ | `{status: accepted\|rejected, note?}` |
| POST | `/admin/verifications/:id/notes` | 🛡️ | Internal moderation note; `{note}` required — never exposed to the business |
| PATCH | `/admin/businesses/:id/featured` | 🛡️ | Phase 2.2 — `{isFeatured, featuredPriority?, featuredStartAt?, featuredEndAt?, featuredRegion?}`. Drives the ranking boost + `featuredOnly` |
| GET | `/admin/collections` | 🛡️ | Phase 2.2 — all collections incl. inactive |
| POST | `/admin/collections` | 🛡️ | `{title, ...}`; slug auto-derived from title when omitted. Duplicate slug → **409** |
| GET | `/admin/collections/:id` | 🛡️ | Includes `pinnedBusinessIds[]` |
| GET | `/admin/collections/:id/preview` | 🛡️ | Resolves the collection **without** the publish gate — previewing an inactive/out-of-window collection is the point |
| PATCH | `/admin/collections/:id` | 🛡️ | Partial patch |
| DELETE | `/admin/collections/:id` | 🛡️ | Cascades to `collection_items` |
| POST | `/admin/collections/:id/duplicate` | 🛡️ | Clones metadata + pinned items; the copy starts `is_active=false` |
| POST | `/admin/collections/:id/items` | 🛡️ | Pin a business; re-pinning an already-pinned business is a no-op, not an error |
| PATCH | `/admin/collections/:id/items/reorder` | 🛡️ | `{businessIds[]}` — must list every pinned id, else **400** |
| DELETE | `/admin/collections/:id/items/:businessId` | 🛡️ | Unpin |
| GET | `/admin/users` | 🛡️ | |
| PATCH | `/admin/users/:id/suspend` | 🛡️ | |
| PATCH | `/admin/users/:id/activate` | 🛡️ | |
| GET | `/admin/admins` | 🛡️⭐ | |
| POST | `/admin/admins` | 🛡️⭐ | Creates another admin/super_admin |

---

## Response envelope conventions

See [`architecture.md`](./architecture.md#requestresponse-conventions) for the full rules. Summary: single resource → `{resourceName: {...}}`; list → `{resourceNamePlural: [...], pagination: {page, limit, total, pages}}`; mutation → `{message, resourceName}`; error → always `{error: "message"}` (or `{error, details}` for validation failures).

## A note on OpenAPI/Swagger

There is no generated `openapi.yaml`/Swagger spec for this API today. This markdown reference is hand-written from the actual route/controller/validator source and is the closest thing to a spec that exists. If a machine-readable spec becomes worth the investment (e.g. for client SDK generation), it should be generated from the Zod validators in `src/validators/` rather than hand-maintained separately, so it can't drift from the code that actually enforces the shape.

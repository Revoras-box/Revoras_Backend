# Business Lifecycle — the `business_status` State Machine (Phase 1.5 design)

**Status: DECISIONS LOCKED 2026-07-15 (O1–O5, see §7). Implementation is Phase 1.5** — this document is the agreed contract the 1.5 milestones (§9) build against, so onboarding, payments, subscriptions, discovery visibility, and admin moderation share **one** state model instead of each feature inventing its own flag.

Written 2026-07-15, after Phase 1.4a–d (Trust & Verification) shipped; decisions locked the same day.

---

## 1. Why this exists

Today a business's lifecycle is spread across two columns on `businesses` plus an unrelated third system:

| Concept | Where it lives now | Values |
|---|---|---|
| Admin decision | `businesses.approval_status` | `pending` \| `approved` \| `rejected` \| `suspended` |
| Public visibility | `businesses.is_active` (boolean) | listed iff `approval_status='approved' AND is_active=true` |
| **Trust badge** (separate concern) | `verification_requests.status` (Phase 1.4b) | `draft`→`submitted`→`under_review`→`approved`\|`rejected`\|`suspended` |

Problems:

1. **Two columns, one concept.** Visibility is `(approval_status, is_active)` — a 2-D encoding of what is really a single lifecycle. Nothing represents "still onboarding" or "approved but not yet paid", so those states can't be expressed at all.
2. **No room for onboarding or payment.** Phase 1.5 introduces multi-step host onboarding and a mandatory ₹99 subscription before listing. There is no state for "mid-onboarding" or "awaiting payment".
3. **Naming collision risk with trust verification.** The lifecycle naturally wants states like `pending_verification` / `under_review`, but Phase 1.4b already owns that vocabulary for the **trust badge**. These are different questions (see §4) and must not be conflated.

---

## 2. The canonical lifecycle

`business_status` is the single source of truth for **"where is this business in its life, and is it publicly listable?"** It is **orthogonal to trust verification** (§4).

```
        ┌─────────┐
        │  draft  │  owner created the business record
        └────┬────┘
             │ begins onboarding
        ┌────▼────────┐
        │ onboarding  │  filling required steps (profile, services, hours, docs)
        └────┬────────┘
             │ all required steps complete
     ┌───────▼─────────┐
     │ payment_pending │  awaiting the ₹99 subscription payment (Razorpay)
     └───────┬─────────┘
             │ payment captured
     ┌───────▼─────────┐
     │ pending_review  │  submitted for admin gate-keeping review
     └───────┬─────────┘
             │ admin opens it
        ┌────▼─────────┐
        │ under_review │  admin actively reviewing docs/identity
        └────┬─────────┘
     approve │        │ reject
        ┌────▼───┐  ┌─▼─────────┐
        │approved│  │ rejected  │ (terminal; may re-apply → onboarding)
        └────┬───┘  └───────────┘
             │ subscription active  →  AUTO-ACTIVATE
        ┌────▼───┐
        │ active │  ★ the ONLY publicly-listed state ★
        └────┬───┘
             │ admin action OR subscription lapse
        ┌────▼──────┐
        │ suspended │  hidden from discovery; historical bookings retained
        └───────────┘   (→ active on reinstate / renewal)
```

### State definitions

| State | Listed? | Bookable? | Meaning |
|---|---|---|---|
| `draft` | no | no | Record exists; onboarding not started. |
| `onboarding` | no | no | Owner is completing required onboarding steps. |
| `payment_pending` | no | no | Onboarding complete; awaiting the ₹99 subscription payment. |
| `pending_review` | no | no | Paid; queued for admin gate-keeping review. |
| `under_review` | no | no | Admin is actively reviewing. |
| `approved` | no | no | Admin approved; **transient** — auto-activates once the subscription is active. |
| `active` | **yes** | **yes** | Approved **and** subscription active. The only discoverable state. |
| `suspended` | no | no | Was active; hidden (admin action or lapsed subscription). Bookings history preserved; not bookable. |
| `rejected` | no | no | Admin rejected during review (with reason). Terminal; re-apply restarts at `onboarding`. |

### Transition table (who triggers)

| From | To | Trigger | Guard |
|---|---|---|---|
| — | `draft` | owner (host signup) | — |
| `draft` | `onboarding` | owner | starts first step |
| `onboarding` | `payment_pending` | owner/system | all required steps complete |
| `payment_pending` | `pending_review` | system | Razorpay payment captured (authoritative via webhook) |
| `pending_review` | `under_review` | admin | — |
| `under_review` | `approved` | admin | docs/identity OK |
| `under_review` | `rejected` | admin | reason required |
| `under_review` / `pending_review` | `onboarding` | admin | "request changes" (reason required) |
| `approved` | `active` | **system (auto)** | subscription active |
| `active` | `suspended` | admin **or** system | admin action, or subscription lapse/expiry |
| `suspended` | `active` | admin/system | reinstated or subscription renewed |
| `rejected` | `onboarding` | owner | re-apply (optional; may be rate-limited) |

`approved` is deliberately transient: if the subscription is already active at approval time, the business goes straight to `active` in the same operation. It exists as a distinct state only to represent "admin said yes, but payment/subscription is not currently valid."

---

## 3. Relationship to subscriptions & payments (₹99)

- Phase 1.5 will add a `subscriptions` table (does not exist today) and reuse the existing polymorphic `payments` table (`payable_type`/`payable_id`, Razorpay fields).
- **`active` requires an active subscription.** The webhook that confirms payment is authoritative (same pattern as [`payment-lifecycle.md`](./payment-lifecycle.md)) — it drives `payment_pending → pending_review` and, later, `approved → active`.
- **Subscription lapse:** when a subscription expires/fails renewal, a system job moves `active → suspended`. Renewal moves it back. (Open question O3: whether to add an intermediate `past_due`/grace state instead of jumping straight to `suspended` — recommend deferring; suspend-on-lapse is simplest and correct for v1.)

---

## 4. Relationship to trust verification (Phase 1.4b) — **keep them separate**

Two different questions, two different systems. Do **not** merge them:

| | Onboarding review (`business_status`) | Trust verification (`verification_requests`, 1.4b) |
|---|---|---|
| Question | *May this business be listed at all?* | *Is this listed business who it claims to be?* |
| Gates | discovery visibility (`active`) | a **trust badge** + a trust-score weight |
| When | once, to get listed | ongoing, optional, after listing |
| Owns states | `pending_review`/`under_review`/`approved`/`rejected` | `submitted`/`under_review`/`approved`/`rejected`/`suspended` |

They share vocabulary (`under_review`, `approved`) but never share a column. A business can be `active` (listed) yet not trust-`verified`, or `verified` yet `suspended`. This is why Phase 1.4 (Trust) and Phase 1.5 (Onboarding) were kept as separate phases in the first place.

**Open question O1:** should the onboarding document-review step *seed* the business's first `verification_request` (so a freshly-listed business can start out trust-`verified` if it uploaded KYC docs during onboarding)? Recommend: **no** for v1 — keep the flows fully independent; revisit if it causes duplicate document uploads.

---

## 5. Reconciling with `approval_status` + `is_active`

Three options; **Option A is recommended.**

### Option A — replace both with a single `business_status` column *(**LOCKED** — O2)*

- Add `business_status` (enum/check-constrained string, default `draft`), backfill from the current `(approval_status, is_active)` pair, then **drop `approval_status` and `is_active`**.
- Backfill mapping:
  | current | → `business_status` |
  |---|---|
  | `approved` + `is_active=true` | `active` |
  | `approved` + `is_active=false` | `approved` |
  | `pending` | `pending_review` (or `onboarding` — see O2) |
  | `rejected` | `rejected` |
  | `suspended` | `suspended` |
- Discovery gate changes from `approval_status='approved' AND is_active=true` to **`business_status='active'`** (one indexed column).
- **Pro:** one source of truth, no drift, expresses every state. **Con:** touches every reader of `approval_status`/`is_active` (discovery repo, admin business service/controllers, onboarding, seeds) — a mechanical but wide change. Do it as one migration + one reader sweep.

### Option B — keep `approval_status`, add `business_status` alongside
Two overlapping columns encoding the same concept = exactly the drift this document exists to prevent. **Rejected.**

### Option C — rename/widen `approval_status` → `business_status`
Functionally Option A framed as an in-place evolution (widen the check constraint, rename the column, fold `is_active` in). Fine if the team prefers a rename over a new column; same reader sweep. Choose A or C on team preference — both yield a single column.

---

## 6. Enforcement points (what must respect `business_status`)

Once implemented, a single helper (e.g. `businessLifecycle.canList(status)` / `assertTransition(from,to)`) should back all of:

1. **Discovery** — `discovery.repository` lists only `business_status='active'` (replaces the two-column gate).
2. **Booking** — reject new bookings unless `active` (existing bookings on a now-`suspended` business are retained and viewable, not cancelled).
3. **Admin queue** — the onboarding review queue is `pending_review` + `under_review` (distinct from the 1.4b verification queue).
4. **Onboarding** — step completion drives `draft`→`onboarding`→`payment_pending`.
5. **Subscription jobs** — payment capture and lapse drive the `payment_pending`/`approved`→`active` and `active`→`suspended` edges.
6. **Trust** — unaffected; `verification_requests` stays orthogonal.

Transitions should go through one validated choke point (mirroring how Phase 1.4b centralised verification transitions in `verificationWorkflow.js` + a single `transition()`), so no caller can make an illegal move.

---

## 7. Decisions — LOCKED 2026-07-15

The five decisions below were reviewed and locked before any Phase 1.5 code. (The original numbering O1–O5 in earlier drafts referred to smaller sub-questions; these are the canonical five as locked.)

- **O1 — Canonical lifecycle.** A **single** lifecycle: `DRAFT → ONBOARDING → PAYMENT_PENDING → PENDING_REVIEW → UNDER_REVIEW → APPROVED → ACTIVE`, with `SUSPENDED`/`REJECTED` off it. `APPROVED` = admin said yes but activation conditions aren't all met; **`ACTIVE` requires all four: onboarding complete + payment successful + admin approved + subscription active.** Never discoverable before `ACTIVE`.
- **O2 — Replace `approval_status`.** Do **not** keep two status systems. Phase 1.5 replaces `approval_status` (+ folds in `is_active`) with `business_status`. Backfill: `approved`+`is_active` → `ACTIVE`; `approved`+`!is_active` → `APPROVED`; `pending` → `PENDING_REVIEW`; `rejected` → `REJECTED`; `suspended` → `SUSPENDED`.
- **O3 — Host signup chooses account type up front.** The signup screen offers **Customer / Host** immediately; choosing Host drops into the Business Onboarding Wizard. No "create customer then convert later."
- **O4 — ₹99 does not auto-activate.** Sequence: signup → business details → gallery → documents → **pay ₹99** → payment success → **`PENDING_REVIEW`** → admin approval → `ACTIVE`. Payment gates entry to review, not listing — prevents spam listings.
- **O5 — Discovery visibility = `ACTIVE` only.** Search, discovery, categories, maps, and recommendations all filter to `business_status='ACTIVE'`. No exceptions. Everything else is hidden.

## 8. `BusinessLifecycleService` — the single authority (mandated)

Every subsystem — Discovery, Booking, Payments, Verification, Admin, and anything future — **must** consult one service rather than re-implement business-state logic. No scattered `if (subscriptionActive) / if (approvalStatus==='approved') / if (paymentDone)` checks anywhere.

```
BusinessLifecycleService
  transition(businessId, toStatus, actor, meta)   // the only writer of business_status; validates the edge
  activateBusiness(businessId)                     // → ACTIVE iff all four conditions hold
  suspendBusiness(businessId, reason, actor)
  canAppearInDiscovery(status)   -> status === 'active'
  canAcceptBookings(status)      -> status === 'active'
  canReceivePayments(status)     -> onboarding/subscription payments allowed pre-active; booking payments only when active
  activationConditions(businessId) -> { onboardingComplete, paymentDone, adminApproved, subscriptionActive }
```

Transitions go through one validated choke point (same pattern as Phase 1.4b's `verificationWorkflow.js` + `transition()`). **As of 1.5d (2026-07-15), `paymentDone`/`subscriptionActive` are real** — derived from `businessSubscription.service.js`'s `getState` (a captured ₹99 payment + the current period not lapsed), not a hardcoded default. `onboardingComplete` still defaults to satisfied until 1.5b tightens it. This applies to every registration path, not just host-onboarding: the legacy one-shot `businessRegister` (which lands directly at `pending_review`) is also now gated on a real subscription before admin-approve auto-activates it.

## 9. Phase 1.5 milestones (locked scope)

| Milestone | Scope |
|---|---|
| **1.5a** | Host registration (account-type choice) + Business Onboarding Wizard (draft save, resume) + the `business_status` migration + `BusinessLifecycleService` + backend reader sweep (the foundation everything else sits on). — **Backend + frontend implemented/verified 2026-07-15.** |
| **1.5b** | Business details: about, services, professionals, gallery, policies (wired into the wizard). |
| **1.5c** | Document upload: PAN, GST, identity, shop photos (via MediaService). |
| **1.5d** | Subscription: Razorpay plans, renewal, expiry-awareness → drives `subscriptionActive`. — **Implemented + verified 2026-07-15** (scaffolded behind env vars; real Razorpay keys, invoices, and a scheduler for proactive expiry/renewal reminders remain open — see report.md §V4.8). |
| **1.5e** | Admin review: queue, approve/reject/suspend. |
| **1.5f** | Activation: `→ ACTIVE`, business appears everywhere automatically. |
| **1.5g** | Discovery integration: every discovery query begins `WHERE business_status='active'` — no exceptions. |

## 10. Implementation note — migration bridge (how O2 lands safely)

O2 is a clean *replace*, but the readers of `approval_status`/`is_active` (admin dashboard stats, admin studios UI, analytics) can't all move in the same commit without rebuilding the admin UI first (that's 1.5e). So the replace lands as a **bridge**, not a big-bang:

1. **1.5a (now):** add `business_status`, backfilled per O2. It is the **authoritative source of truth**. `BusinessLifecycleService` is the *only* writer and, during the bridge, writes `business_status` **and** keeps the legacy `approval_status`/`is_active` in sync (so not-yet-migrated admin readers keep working). Discovery moves to `business_status='active'` immediately (O5). Every state-changing path (registration, admin approve/reject/suspend) funnels through the service — no scattered writes.
2. **1.5e:** rebuild the admin queue/dashboard on `business_status`, removing the legacy readers.
3. **1.5f:** once nothing reads them, **drop `approval_status` + `is_active`** — completing the O2 replace with zero duplicated state remaining.

This keeps a single authority throughout (the service owns all writes; `business_status` is the truth); the legacy columns are a temporary derived mirror, not a competing system, and they are scheduled for removal. The reader sweep is guarded by the service's predicates (`canAppearInDiscovery`, etc.) rather than raw column comparisons.

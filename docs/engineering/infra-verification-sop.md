# Infrastructure Verification SOP

**Status:** Official standard for Revoras V4. Applies to **every external dependency** — Cloudflare R2, Redis, Elasticsearch, Stripe/Razorpay, Maps/geocoding APIs, AI providers, and anything added later.

**Core rule:** *Infrastructure is verified independently of the application, and before any application-level testing.* A phase that integrates an external service is never "done" until both the infrastructure layer and the application layer have each been verified on their own. See [`release-checklist.md`](./release-checklist.md) for the Definition of Done this feeds.

**Why this exists:** a raw `401`/timeout/connection error can originate in three different layers — local configuration, the infrastructure/credentials, or the application code. Debugging the wrong layer (e.g. editing service code while credentials are simply rejected) wastes time and adds risk. This SOP forces the failure to be *localized* before anyone changes code.

---

## The gate

Run the steps **in order**. Never skip a step. Never continue past a failed gate. Once you begin *verifying an external service*, no upload/round-trip testing, no "verified" checkboxes, and no **Production Ready** marking happen until Step 2 returns healthy.

**This is a release gate, not a development gate.** Feature development against the storage/service abstraction (building APIs, tables, business logic, UI) does *not* wait for this SOP to go green — see [`release-checklist.md`](./release-checklist.md) → "Development gate vs. release gate." The SOP defines *how* verification is done and *what* it blocks (Production Ready), not *when* you're allowed to write feature code. The eventual verification is batched into one pre-production pass covering every MediaService-dependent feature at once.

### Step 0 — Configuration fingerprint (read-only, no network)

Print, without ever exposing secrets:

- Account / project identifier (e.g. `R2_ACCOUNT_ID`)
- Bucket / database / index name
- Endpoint
- **Access-key fingerprint: first 6 + last 4 characters only**

Never print: secret access keys, JWT secrets, API secrets, tokens.

Record the fingerprint. It is the anchor for the Step 3 decision matrix — it tells you whether the app actually loaded new credentials after a rotation.

### Step 1 — Configuration validation (local)

Validate locally, before touching the network:

- Endpoint format exact — for R2: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, where `<ACCOUNT_ID>` **equals** the account-id env var.
- Resource name correct (bucket == `revoras`, etc.).
- No placeholder values, no surrounding quotes, no trailing whitespace / hidden newlines.
- No duplicate environment file silently overriding values; no stale system/Docker/IDE env overriding local `.env`.

Any failure here → **stop, no network calls.**

### Step 2 — Infrastructure sanity

Run **only** the minimal reachability probes — nothing application-specific.

| Service | Probes |
|---|---|
| Cloudflare R2 (S3 API) | `ListBuckets`, `HeadBucket(<bucket>)` |
| Redis | `PING`, `INFO server` |
| Postgres | `SELECT 1`, `SELECT current_database()` |
| HTTP API (Stripe/Razorpay/Maps/AI) | a documented no-side-effect auth-check endpoint |

Capture the **complete** error object on failure: HTTP status, error name, error code, SDK `$metadata`, Request ID, Extended Request ID, retry attempts, retry delay.

Then **classify** the failure — this is often more valuable than the status code:

`local-configuration` · `signing` · `TLS` · `DNS` · `HTTP response (reached the service)` · `SDK serialization`

A useful discriminator: did it fail **during request signing** (client-side, before any bytes left the machine) or **after reaching the service** (there is an HTTP status / request id)?

### Step 3 — Decision matrix

| Case | Signal | Meaning | Investigate (no code changes) |
|---|---|---|---|
| **A** | Fingerprint **unchanged** | The app did not load the new credentials | unsaved `.env`, wrong `.env`, dotenv path, stale process, IDE/Docker launch config, system env override |
| **B** | Fingerprint **changed**, still `401`/`403` after reaching the service | Infrastructure rejected the credentials | wrong account, resource ownership, missing Read/Write permission, inactive/uncopied token |
| **C** | **Signing-phase** failure | Malformed configuration | whitespace, hidden newline, quotes, truncation, endpoint typo, corrupted credentials |
| **D** | **HTTP 200** | Infrastructure healthy | proceed to Step 4 |

### Step 4 — Application verification

Only after Step 2 is green. Exercise the real code paths (see [`testing-standards.md`](./testing-standards.md)):
Upload → Replace → Delete → feature CRUD → integration surface (e.g. Discovery) → Cleanup → Regression → Performance sanity → Error handling → Logging.

### Step 5 — Completion

Only after **every** verification passes: mark the phase Production Ready and update `report.md`, API reference, deployment docs, schema docs, and migration history. Gate against [`release-checklist.md`](./release-checklist.md).

---

## Worked example — Cloudflare R2 (Phase 1.1)

- **Step 0/1:** `R2_ACCOUNT_ID`, `R2_BUCKET_NAME=revoras`, `R2_ENDPOINT` account segment matches account id, key fingerprint `54689b...ccd1` (len 32), secret len 64. Config shape valid.
- **Step 2:** `ListBuckets` and `HeadBucket(revoras)` both returned **401 Unauthorized**, after reaching Cloudflare (has an HTTP status; no request-id in the 401 body).
- **Step 3:** Case **B** if the fingerprint changes on the next rotation and still 401 (token rejected); Case **A** if the fingerprint is unchanged (app never loaded the rotated key). Resolution is a credential rotation in the Cloudflare dashboard — **no application code change**.

> Note: a rotated token normally keeps the **same Account ID** (the account id belongs to the Cloudflare account, not the credential). An unchanged account id is *not* evidence of a problem; an unchanged **access-key fingerprint** is.

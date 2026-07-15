# Testing Standards

**Status:** Official standard for Revoras V4. Defines what "Application Verification" (Development Workflow stage 5) must cover for every phase. Not every category applies to every phase — but each must be explicitly *considered* and either exercised or marked N/A with a reason.

## What every phase must include

| Category | What it means here |
|---|---|
| **Unit** | Pure logic in services/utils exercised in isolation (e.g. cover-selection, reorder-permutation validation). |
| **Integration** | Service → repository → live database round-trips (real Postgres, not mocks). |
| **API** | Real HTTP requests against the running server: status codes, request/response shapes. |
| **Authentication** | Unauthenticated → `401`; invalid/expired/revoked token → `401`; deactivated account → `403`. |
| **Authorization** | Non-member → `403`; member lacking the required permission key → `403`; permitted member/owner → success. |
| **Error handling** | Every expected failure returns the correct HTTP status + structured JSON, exposes no stack trace, and leaves no partial DB state. |
| **Rollback** | Schema migrations have a working `down`; destructive operations are transactional. |
| **Cleanup verification** | After a run: zero temporary DB rows, zero orphan external objects (e.g. R2), zero leaked references. |
| **Performance sanity** | Latency reasonable; no N+1 queries; no memory leaks; no unhandled promise rejections. Not a load test. |
| **Regression** | Previously-working surfaces still pass (list below). |

## Standard regression surface

Re-run after any backend change that could reach shared infrastructure or middleware:

- Business logo upload (the other `MediaService` consumer)
- Business profile fetch
- Discovery listing + single business (`GET /discover/businesses/:id`)
- Categories endpoint (cache path)
- Search endpoint
- All existing `MediaService` consumers
- Authentication middleware
- Authorization / permission middleware

**Zero regressions is non-negotiable before advancing.**

## Error-handling matrix (external-service features)

Every one of these must return a correct, structured, non-leaking error:

invalid file type · oversized file · missing permission · missing business · deleted/nonexistent resource · duplicate/invalid reorder payload · unknown id · invalid cover id · storage unavailable (503) · expired/rejected credentials.

## Logging expectations

Logs must contain useful diagnostics for: upload success, replace success, delete success, storage failure, permission denial, and unexpected exceptions — and must **never** contain secrets, tokens, or credentials. See the Infrastructure Verification SOP for the secret-redaction rule (fingerprints only).

## "Implemented" vs "Verified"

A feature is *implemented* when the code exists and the server boots. It is *verified* only when the path was actually exercised against live infrastructure. `report.md` §V4.6 tracks these as separate checkboxes; never tick a verification box for a path that was only reasoned about.

/**
 * Phase 1.4b - the verification state machine as pure data (no I/O), shared by
 * businessVerification.service.js (business-driven transitions) and
 * adminVerification.service.js (admin-driven transitions). Keeping the allowed
 * transitions in one place means neither service can silently disagree about
 * what a legal move is.
 *
 *   draft ──submit──▶ submitted ──▶ under_review
 *                        │  │            │
 *                        │  └─more_info──┤
 *                        │      ▲        │
 *                     (resubmit)└────────┘
 *                        ▼
 *   approved / rejected  ◀── (from submitted | under_review | more_info)
 *   approved ──suspend──▶ suspended
 *
 * A rejected/suspended request is terminal; re-applying starts a brand new
 * request (the partial unique index allows that once the old one is closed).
 */
export const STATUS = Object.freeze({
  DRAFT: "draft",
  SUBMITTED: "submitted",
  UNDER_REVIEW: "under_review",
  MORE_INFO: "more_info",
  APPROVED: "approved",
  REJECTED: "rejected",
  SUSPENDED: "suspended",
});

export const OPEN_STATUSES = [STATUS.DRAFT, STATUS.SUBMITTED, STATUS.UNDER_REVIEW, STATUS.MORE_INFO];

const TRANSITIONS = Object.freeze({
  draft: ["submitted"],
  submitted: ["under_review", "more_info", "approved", "rejected"],
  under_review: ["more_info", "approved", "rejected"],
  more_info: ["submitted", "approved", "rejected"],
  approved: ["suspended"],
  rejected: [],
  suspended: [],
});

export const canTransition = (from, to) => TRANSITIONS[from]?.includes(to) ?? false;

export const isOpen = (status) => OPEN_STATUSES.includes(status);

// Statuses whose entry/exit changes the trust `verified` flag, so the caller
// knows to recompute the trust score.
export const affectsVerifiedFlag = (status) =>
  status === STATUS.APPROVED || status === STATUS.REJECTED || status === STATUS.SUSPENDED;

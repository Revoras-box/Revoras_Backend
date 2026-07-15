import * as verificationRepo from "../repositories/businessVerification.repository.js";
import * as trustService from "./trust.service.js";
import * as adminActivityLogService from "./adminActivityLog.service.js";
import { STATUS, canTransition, affectsVerifiedFlag } from "./verificationWorkflow.js";
import { ServiceError } from "../utils/ServiceError.js";

/**
 * Phase 1.4b - the admin-facing half: the verification queue and the review
 * transitions. Admins (not business members) reach this via
 * authenticateAdmin/requireAdmin. This is the only service that can read
 * verification_notes (internal moderation notes).
 *
 * Every terminal transition (approved/rejected/suspended) recomputes the trust
 * score, which re-derives `verified` from whether an approved request now
 * exists - so approval turns the trust badge on and rejection/suspension turns
 * it off, without this service touching trust_scores directly.
 */

export const listQueue = async (query) => {
  const page = Number(query.page) || 1;
  const limit = Number(query.limit) || 20;
  const { rows, total } = await verificationRepo.listQueue({ status: query.status, page, limit });
  const counts = await verificationRepo.countByStatus();
  const byStatus = Object.fromEntries(counts.map((c) => [c.status, Number(c.count)]));
  return { requests: rows, counts: byStatus, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};

// Full admin view: documents + timeline + internal notes.
export const getRequest = async (requestId) => {
  const request = await verificationRepo.findRequestById(requestId);
  if (!request) throw new ServiceError(404, "Verification request not found");

  const [documents, history, notes] = await Promise.all([
    verificationRepo.listDocuments(requestId),
    verificationRepo.listHistory(requestId),
    verificationRepo.listNotes(requestId),
  ]);

  return { ...request, documents, history, notes };
};

/**
 * The single choke point for admin-driven status changes: validates the
 * transition, updates the request, appends history, logs admin activity, and
 * recomputes trust when the move flips `verified`.
 */
const transition = async (requestId, toStatus, { adminId, ipAddress, action, decisionReason = null, note = null }) => {
  const request = await verificationRepo.findRequestById(requestId);
  if (!request) throw new ServiceError(404, "Verification request not found");

  if (!canTransition(request.status, toStatus)) {
    throw new ServiceError(409, `Cannot move a '${request.status}' request to '${toStatus}'`);
  }

  const updated = await verificationRepo.runInTransaction(async (trx) => {
    const patch = { status: toStatus, reviewed_by: adminId, reviewed_at: trx.fn.now() };
    if (decisionReason !== null) patch.decision_reason = decisionReason;
    const row = await verificationRepo.updateRequest(requestId, patch, trx);
    await verificationRepo.addHistory(
      {
        request_id: requestId,
        business_id: request.business_id,
        from_status: request.status,
        to_status: toStatus,
        actor_type: "admin",
        actor_id: adminId,
        note,
      },
      trx
    );
    return row;
  });

  // Recompute outside the transaction: trust derives `verified` from the now-
  // committed request status.
  if (affectsVerifiedFlag(toStatus)) {
    await trustService.recomputeTrustScore(request.business_id);
  }

  await adminActivityLogService.log(
    adminId,
    action,
    "verification_request",
    requestId,
    { businessId: request.business_id, from: request.status, to: toStatus, reason: decisionReason },
    ipAddress
  );

  return updated;
};

export const startReview = (requestId, adminId, ipAddress) =>
  transition(requestId, STATUS.UNDER_REVIEW, { adminId, ipAddress, action: "verification_start_review", note: "Review started" });

export const approve = (requestId, adminId, { note } = {}, ipAddress) =>
  transition(requestId, STATUS.APPROVED, { adminId, ipAddress, action: "verification_approve", note: note ?? "Approved" });

export const reject = (requestId, adminId, { reason }, ipAddress) => {
  if (!reason) throw new ServiceError(400, "A rejection reason is required");
  return transition(requestId, STATUS.REJECTED, { adminId, ipAddress, action: "verification_reject", decisionReason: reason, note: reason });
};

export const suspend = (requestId, adminId, { reason }, ipAddress) => {
  if (!reason) throw new ServiceError(400, "A suspension reason is required");
  return transition(requestId, STATUS.SUSPENDED, { adminId, ipAddress, action: "verification_suspend", decisionReason: reason, note: reason });
};

export const requestMoreInfo = (requestId, adminId, { reason }, ipAddress) => {
  if (!reason) throw new ServiceError(400, "Explain what additional information is needed");
  return transition(requestId, STATUS.MORE_INFO, { adminId, ipAddress, action: "verification_more_info", decisionReason: reason, note: reason });
};

export const reviewDocument = async (requestId, documentId, adminId, { status, note }, ipAddress) => {
  if (!["accepted", "rejected"].includes(status)) throw new ServiceError(400, "Document status must be 'accepted' or 'rejected'");

  const doc = await verificationRepo.findDocument(documentId, requestId);
  if (!doc) throw new ServiceError(404, "Document not found");

  const updated = await verificationRepo.updateDocument(documentId, { status, review_note: note ?? null });
  await adminActivityLogService.log(adminId, "verification_review_document", "verification_request", requestId, { documentId, status }, ipAddress);
  return updated;
};

export const addNote = async (requestId, adminId, { note }, ipAddress) => {
  if (!note?.trim()) throw new ServiceError(400, "Note cannot be empty");

  const request = await verificationRepo.findRequestById(requestId);
  if (!request) throw new ServiceError(404, "Verification request not found");

  const created = await verificationRepo.addNote({ request_id: requestId, admin_id: adminId, note: note.trim() });
  await adminActivityLogService.log(adminId, "verification_add_note", "verification_request", requestId, {}, ipAddress);
  return created;
};

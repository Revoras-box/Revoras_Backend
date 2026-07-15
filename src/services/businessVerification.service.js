import * as verificationRepo from "../repositories/businessVerification.repository.js";
import * as trustRepo from "../repositories/trust.repository.js";
import * as trustService from "./trust.service.js";
import * as mediaService from "./media.service.js";
import { STATUS, isOpen } from "./verificationWorkflow.js";
import { ServiceError } from "../utils/ServiceError.js";

/**
 * Phase 1.4b - the business-facing half of verification (the "Verification
 * Center"). Everything here is scoped to the caller's own business; internal
 * admin notes are never read or returned by this service.
 */

const MAX_DOCUMENTS = 10;
const ALLOWED_DOCUMENT_TYPES = new Set(["business_license", "id_proof", "address_proof", "tax_document", "other"]);

// Hybrid eligibility: a business must clear these auto-checks before it can
// submit; an admin still makes the final grant. Thresholds live here so the
// snapshot stored on the request captures exactly what was required at submit.
const ELIGIBILITY_CRITERIA = [
  { key: "profile_completion", label: "Profile at least 60% complete", required: 60 },
  { key: "completed_bookings", label: "At least 3 completed bookings", required: 3 },
  { key: "business_age_days", label: "Account at least 7 days old", required: 7 },
];

export const checkEligibility = async (businessId) => {
  const signals = await trustService.getTrustSignals(businessId);
  const criteria = ELIGIBILITY_CRITERIA.map((c) => {
    const current = Number(signals[c.key] ?? 0);
    return { key: c.key, label: c.label, required: c.required, current, met: current >= c.required };
  });
  return { eligible: criteria.every((c) => c.met), criteria };
};

// Business-facing view of a request: strips reviewer identity to just the
// decision, and NEVER includes verification_notes.
const publicRequestShape = (request, documents) => ({
  id: request.id,
  status: request.status,
  applicantNote: request.applicant_note,
  decisionReason: request.decision_reason,
  submittedAt: request.submitted_at,
  reviewedAt: request.reviewed_at,
  createdAt: request.created_at,
  documents: documents.map((d) => ({
    id: d.id,
    type: d.type,
    url: d.url,
    originalName: d.original_name,
    status: d.status,
    reviewNote: d.review_note,
    createdAt: d.created_at,
  })),
});

export const getVerificationCenter = async (businessId) => {
  const [latest, eligibility, verified] = await Promise.all([
    verificationRepo.findLatestRequest(businessId),
    checkEligibility(businessId),
    trustRepo.isVerified(businessId),
  ]);

  let currentRequest = null;
  let history = [];
  if (latest) {
    const [documents, hist] = await Promise.all([
      verificationRepo.listDocuments(latest.id),
      verificationRepo.listHistory(latest.id),
    ]);
    currentRequest = publicRequestShape(latest, documents);
    history = hist;
  }

  // A business can start a new request when eligible and nothing is open.
  const hasOpen = latest ? isOpen(latest.status) : false;
  return { verified, eligibility, canStart: eligibility.eligible && !hasOpen, currentRequest, history };
};

export const createRequest = async (businessId, userId, { applicantNote } = {}) => {
  const existingOpen = await verificationRepo.findOpenRequest(businessId);
  if (existingOpen) throw new ServiceError(409, "An open verification request already exists");

  const eligibility = await checkEligibility(businessId);
  if (!eligibility.eligible) {
    throw new ServiceError(400, "Business is not yet eligible for verification");
  }

  return verificationRepo.runInTransaction(async (trx) => {
    const request = await verificationRepo.createRequest(
      {
        business_id: businessId,
        status: STATUS.DRAFT,
        eligibility_snapshot: JSON.stringify(eligibility),
        applicant_note: applicantNote ?? null,
      },
      trx
    );
    await verificationRepo.addHistory(
      {
        request_id: request.id,
        business_id: businessId,
        from_status: null,
        to_status: STATUS.DRAFT,
        actor_type: "business",
        actor_id: userId,
        note: "Verification request created",
      },
      trx
    );
    return request;
  });
};

// A request only accepts document changes while the business still holds it
// (draft, or more_info after an admin asked for more).
const assertEditableByBusiness = (request) => {
  if (!request) throw new ServiceError(404, "Verification request not found");
  if (request.status !== STATUS.DRAFT && request.status !== STATUS.MORE_INFO) {
    throw new ServiceError(409, `Documents cannot be changed while the request is '${request.status}'`);
  }
};

export const addDocument = async (businessId, requestId, file, { type }) => {
  if (!file) throw new ServiceError(400, "No file uploaded");
  if (!ALLOWED_DOCUMENT_TYPES.has(type)) throw new ServiceError(400, "Invalid document type");

  const request = await verificationRepo.findRequestForBusiness(requestId, businessId);
  assertEditableByBusiness(request);

  if ((await verificationRepo.countDocuments(requestId)) >= MAX_DOCUMENTS) {
    throw new ServiceError(400, `A request is limited to ${MAX_DOCUMENTS} documents`);
  }

  const { url } = await mediaService.uploadMedia({
    buffer: file.buffer,
    originalFilename: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    folder: mediaService.MEDIA_FOLDERS.VERIFICATION,
    entityId: businessId,
    prefix: type,
  });

  return verificationRepo.createDocument({
    request_id: requestId,
    business_id: businessId,
    type,
    url,
    original_name: file.originalname,
  });
};

export const removeDocument = async (businessId, requestId, documentId) => {
  const request = await verificationRepo.findRequestForBusiness(requestId, businessId);
  assertEditableByBusiness(request);

  const doc = await verificationRepo.findDocument(documentId, requestId);
  if (!doc) throw new ServiceError(404, "Document not found");

  await mediaService.deleteMediaByUrl(doc.url);
  await verificationRepo.removeDocument(documentId, requestId);
  return verificationRepo.listDocuments(requestId);
};

// draft | more_info -> submitted. Requires at least one document.
export const submitRequest = async (businessId, requestId, userId) => {
  const request = await verificationRepo.findRequestForBusiness(requestId, businessId);
  if (!request) throw new ServiceError(404, "Verification request not found");
  if (request.status !== STATUS.DRAFT && request.status !== STATUS.MORE_INFO) {
    throw new ServiceError(409, `A '${request.status}' request cannot be submitted`);
  }

  if ((await verificationRepo.countDocuments(requestId)) === 0) {
    throw new ServiceError(400, "Attach at least one document before submitting");
  }

  return verificationRepo.runInTransaction(async (trx) => {
    const updated = await verificationRepo.updateRequest(
      requestId,
      { status: STATUS.SUBMITTED, submitted_at: trx.fn.now(), decision_reason: null },
      trx
    );
    await verificationRepo.addHistory(
      {
        request_id: requestId,
        business_id: businessId,
        from_status: request.status,
        to_status: STATUS.SUBMITTED,
        actor_type: "business",
        actor_id: userId,
        note: "Submitted for review",
      },
      trx
    );
    return updated;
  });
};

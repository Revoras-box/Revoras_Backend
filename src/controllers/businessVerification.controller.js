import * as verificationService from "../services/businessVerification.service.js";
import { createRequestSchema, addDocumentSchema } from "../validators/businessVerification.validator.js";

// Phase 1.4b - the business "Verification Center". All routes are mounted under
// /api/business/:studioId and pass through requireBusinessMember, so
// req.params.studioId is an authorized business the caller belongs to.

// GET /api/business/:studioId/verification
export const getVerificationCenter = async (req, res) => {
  const data = await verificationService.getVerificationCenter(req.params.studioId);
  res.json(data);
};

// GET /api/business/:studioId/verification/eligibility
export const getEligibility = async (req, res) => {
  const eligibility = await verificationService.checkEligibility(req.params.studioId);
  res.json(eligibility);
};

// POST /api/business/:studioId/verification
export const createRequest = async (req, res) => {
  const input = createRequestSchema.parse(req.body);
  const request = await verificationService.createRequest(req.params.studioId, req.user.id, input);
  res.status(201).json({ message: "Verification request created", request });
};

// POST /api/business/:studioId/verification/:requestId/documents
export const addDocument = async (req, res) => {
  const { type } = addDocumentSchema.parse(req.body);
  const document = await verificationService.addDocument(req.params.studioId, req.params.requestId, req.file, { type });
  res.status(201).json({ message: "Document uploaded", document });
};

// DELETE /api/business/:studioId/verification/:requestId/documents/:documentId
export const removeDocument = async (req, res) => {
  const documents = await verificationService.removeDocument(req.params.studioId, req.params.requestId, req.params.documentId);
  res.json({ message: "Document removed", documents });
};

// POST /api/business/:studioId/verification/:requestId/submit
export const submitRequest = async (req, res) => {
  const request = await verificationService.submitRequest(req.params.studioId, req.params.requestId, req.user.id);
  res.json({ message: "Verification request submitted", request });
};

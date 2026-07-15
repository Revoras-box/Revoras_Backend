import * as adminVerificationService from "../services/adminVerification.service.js";
import {
  listQueueQuerySchema,
  approveSchema,
  reasonSchema,
  reviewDocumentSchema,
  addNoteSchema,
} from "../validators/adminVerification.validator.js";

// Phase 1.4b - admin verification queue. Mounted under /api/admin, behind
// authenticateAdmin/requireAdmin, so req.user is an admin.

// GET /api/admin/verifications
export const listQueue = async (req, res) => {
  const query = listQueueQuerySchema.parse(req.query);
  const result = await adminVerificationService.listQueue(query);
  res.json(result);
};

// GET /api/admin/verifications/:id
export const getRequest = async (req, res) => {
  const request = await adminVerificationService.getRequest(req.params.id);
  res.json({ request });
};

// POST /api/admin/verifications/:id/review
export const startReview = async (req, res) => {
  const request = await adminVerificationService.startReview(req.params.id, req.user.id, req.ip);
  res.json({ message: "Review started", request });
};

// POST /api/admin/verifications/:id/approve
export const approve = async (req, res) => {
  const input = approveSchema.parse(req.body);
  const request = await adminVerificationService.approve(req.params.id, req.user.id, input, req.ip);
  res.json({ message: "Verification approved", request });
};

// POST /api/admin/verifications/:id/reject
export const reject = async (req, res) => {
  const input = reasonSchema.parse(req.body);
  const request = await adminVerificationService.reject(req.params.id, req.user.id, input, req.ip);
  res.json({ message: "Verification rejected", request });
};

// POST /api/admin/verifications/:id/suspend
export const suspend = async (req, res) => {
  const input = reasonSchema.parse(req.body);
  const request = await adminVerificationService.suspend(req.params.id, req.user.id, input, req.ip);
  res.json({ message: "Verification suspended", request });
};

// POST /api/admin/verifications/:id/request-info
export const requestMoreInfo = async (req, res) => {
  const input = reasonSchema.parse(req.body);
  const request = await adminVerificationService.requestMoreInfo(req.params.id, req.user.id, input, req.ip);
  res.json({ message: "Requested more information", request });
};

// PATCH /api/admin/verifications/:id/documents/:documentId
export const reviewDocument = async (req, res) => {
  const input = reviewDocumentSchema.parse(req.body);
  const document = await adminVerificationService.reviewDocument(req.params.id, req.params.documentId, req.user.id, input, req.ip);
  res.json({ message: "Document reviewed", document });
};

// POST /api/admin/verifications/:id/notes
export const addNote = async (req, res) => {
  const input = addNoteSchema.parse(req.body);
  const note = await adminVerificationService.addNote(req.params.id, req.user.id, input, req.ip);
  res.status(201).json({ message: "Note added", note });
};

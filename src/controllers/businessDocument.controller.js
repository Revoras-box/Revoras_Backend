import * as documentService from "../services/businessDocument.service.js";

// GET /api/business/:studioId/documents
export const listDocuments = async (req, res) => {
  const documents = await documentService.listDocuments(req.params.studioId);
  res.json({ documents });
};

// POST /api/business/:studioId/documents  (multipart: file + docType)
export const addDocument = async (req, res) => {
  const document = await documentService.addDocument(req.params.studioId, req.file, { docType: req.body.docType });
  res.status(201).json({ message: "Document uploaded", document });
};

// DELETE /api/business/:studioId/documents/:documentId
export const removeDocument = async (req, res) => {
  const documents = await documentService.removeDocument(req.params.studioId, req.params.documentId);
  res.json({ message: "Document removed", documents });
};

import * as documentRepo from "../repositories/businessDocument.repository.js";
import * as mediaService from "../services/media.service.js";
import { ServiceError } from "../utils/ServiceError.js";

/**
 * Business documents - a simple, compulsory upload collected at onboarding
 * (PAN / GST / other). Deliberately NOT the verification workflow: no
 * eligibility, no admin review, no badge. The file goes to object storage (R2)
 * through MediaService; this service just records the type + URL.
 */

const MAX_DOCUMENTS = 10;
const ALLOWED_DOC_TYPES = new Set(["pan", "gst", "other"]);

export const listDocuments = (studioId) => documentRepo.list(studioId);

export const addDocument = async (studioId, file, { docType } = {}) => {
  if (!file) throw new ServiceError(400, "No file uploaded");
  if (!ALLOWED_DOC_TYPES.has(docType)) throw new ServiceError(400, "Invalid document type");

  if ((await documentRepo.count(studioId)) >= MAX_DOCUMENTS) {
    throw new ServiceError(400, `You can upload at most ${MAX_DOCUMENTS} documents`);
  }

  const { url } = await mediaService.uploadMedia({
    buffer: file.buffer,
    originalFilename: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    folder: mediaService.MEDIA_FOLDERS.DOCUMENTS,
    entityId: studioId,
    prefix: docType,
    // PAN/GST are often scans or PDFs, not just photos.
    allowedMimeTypes: mediaService.DOCUMENT_MIME_TYPES,
  });

  return documentRepo.create({
    studio_id: studioId,
    doc_type: docType,
    url,
    original_name: file.originalname,
  });
};

export const removeDocument = async (studioId, documentId) => {
  const doc = await documentRepo.findById(documentId, studioId);
  if (!doc) throw new ServiceError(404, "Document not found");

  await mediaService.deleteMediaByUrl(doc.url);
  await documentRepo.remove(documentId, studioId);
  return documentRepo.list(studioId);
};

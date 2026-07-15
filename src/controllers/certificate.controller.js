import * as certificateService from "../services/certificate.service.js";
import { createCertificateSchema, updateCertificateSchema } from "../validators/certificate.validator.js";

// GET /api/business/:studioId/members/:memberId/certificates
export const listCertificates = async (req, res) => {
  const certificates = await certificateService.listCertificates(req.params.studioId, req.params.memberId);
  res.json({ certificates });
};

// POST /api/business/:studioId/members/:memberId/certificates
export const addCertificate = async (req, res) => {
  const input = createCertificateSchema.parse(req.body);
  const certificate = await certificateService.addCertificate(req.params.studioId, req.params.memberId, input, req.file);
  res.status(201).json({ message: "Certificate added", certificate });
};

// PATCH /api/business/:studioId/members/:memberId/certificates/:certId
export const updateCertificate = async (req, res) => {
  const input = updateCertificateSchema.parse(req.body);
  const certificate = await certificateService.updateCertificate(
    req.params.studioId,
    req.params.memberId,
    req.params.certId,
    input,
    req.file
  );
  res.json({ message: "Certificate updated", certificate });
};

// DELETE /api/business/:studioId/members/:memberId/certificates/:certId
export const removeCertificate = async (req, res) => {
  const certificates = await certificateService.removeCertificate(req.params.studioId, req.params.memberId, req.params.certId);
  res.json({ message: "Certificate removed", certificates });
};

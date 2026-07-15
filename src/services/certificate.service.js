import * as certificateRepo from "../repositories/certificate.repository.js";
import * as businessMemberRepo from "../repositories/businessMember.repository.js";
import * as mediaService from "./media.service.js";
import { ServiceError } from "../utils/ServiceError.js";

const assertMember = async (studioId, memberId) => {
  const member = await businessMemberRepo.findById(memberId);
  if (!member || member.studio_id !== studioId) {
    throw new ServiceError(404, "Professional not found");
  }
};

// Certificate metadata maps 1:1 to columns; the optional image rides through
// MediaService like every other upload. Metadata-only certificates are valid
// (media_url stays null) - the image can be attached on a later update.
const toRow = (input) => ({
  title: input.title,
  issuer: input.issuer,
  issued_date: input.issuedDate ?? null,
  expiry_date: input.expiryDate ?? null,
  credential_id: input.credentialId ?? null,
  verification_url: input.verificationUrl ?? null,
});

const uploadCertImage = (file, memberId) =>
  mediaService.uploadMedia({
    buffer: file.buffer,
    originalFilename: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    folder: mediaService.MEDIA_FOLDERS.CERTIFICATES,
    entityId: memberId,
    prefix: "certificate",
  });

export const listCertificates = async (studioId, memberId) => {
  await assertMember(studioId, memberId);
  return certificateRepo.list(memberId);
};

export const addCertificate = async (studioId, memberId, input, file) => {
  await assertMember(studioId, memberId);

  let mediaUrl = null;
  if (file) {
    mediaUrl = (await uploadCertImage(file, memberId)).url;
  }

  const nextSortOrder = (await certificateRepo.maxSortOrder(memberId)) + 1;

  return certificateRepo.create({
    business_member_id: memberId,
    ...toRow(input),
    media_url: mediaUrl,
    sort_order: nextSortOrder,
  });
};

export const updateCertificate = async (studioId, memberId, certId, input, file) => {
  await assertMember(studioId, memberId);
  const existing = await certificateRepo.findById(certId, memberId);
  if (!existing) throw new ServiceError(404, "Certificate not found");

  const patch = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.issuer !== undefined) patch.issuer = input.issuer;
  if (input.issuedDate !== undefined) patch.issued_date = input.issuedDate;
  if (input.expiryDate !== undefined) patch.expiry_date = input.expiryDate;
  if (input.credentialId !== undefined) patch.credential_id = input.credentialId;
  if (input.verificationUrl !== undefined) patch.verification_url = input.verificationUrl;

  if (file) {
    const { url } = await mediaService.replaceMedia({
      buffer: file.buffer,
      originalFilename: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      folder: mediaService.MEDIA_FOLDERS.CERTIFICATES,
      entityId: memberId,
      prefix: "certificate",
      previousUrl: existing.media_url,
    });
    patch.media_url = url;
  }

  if (Object.keys(patch).length === 0) {
    throw new ServiceError(400, "No fields to update");
  }

  return certificateRepo.update(certId, memberId, patch);
};

export const removeCertificate = async (studioId, memberId, certId) => {
  await assertMember(studioId, memberId);
  const existing = await certificateRepo.findById(certId, memberId);
  if (!existing) throw new ServiceError(404, "Certificate not found");

  if (existing.media_url) {
    await mediaService.deleteMediaByUrl(existing.media_url);
  }
  await certificateRepo.remove(certId, memberId);

  return certificateRepo.list(memberId);
};

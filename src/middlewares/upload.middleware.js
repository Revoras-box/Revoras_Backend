import multer from "multer";

/**
 * Parses a single multipart file into memory (req.file.buffer) - never to
 * disk, since every upload's final destination is R2 via MediaService, not
 * this server's filesystem. Shared by every upload route; MediaService does
 * the real mime/size validation, this is just the multipart parser.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: (Number(process.env.MEDIA_MAX_FILE_SIZE_MB) || 5) * 1024 * 1024 },
});

export const uploadSingle = (fieldName) => upload.single(fieldName);

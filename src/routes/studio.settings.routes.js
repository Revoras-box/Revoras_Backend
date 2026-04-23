import express from "express";
import multer from "multer";
import {
  getStudioSettings,
  uploadStudioLogo,
  updateStudioSettings,
} from "../controller/barberDashboard.controller.js";
import {
  authenticateToken,
  requireStudioAccess,
} from "../middlewares/auth.middleware.js";

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const handleImageUpload = (req, res, next) => {
  upload.single("file")(req, res, (error) => {
    if (!error) {
      return next();
    }
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "Image must be 5MB or smaller" });
    }
    return res.status(400).json({ error: "Invalid upload payload" });
  });
};

router.get("/settings", authenticateToken, requireStudioAccess, getStudioSettings);
router.put("/settings", authenticateToken, requireStudioAccess, updateStudioSettings);
router.post("/upload-image", handleImageUpload, uploadStudioLogo);
router.post("/upload-logo", handleImageUpload, uploadStudioLogo);
router.post("/upload", handleImageUpload, uploadStudioLogo);

export default router;

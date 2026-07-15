import * as profileService from "../services/profile.service.js";
import { updateProfileSchema, notificationSettingsSchema, deleteAccountSchema } from "../validators/profile.validator.js";

// GET /api/profile
export const getProfile = async (req, res) => {
  const result = await profileService.getProfile(req.user.id);
  res.json(result);
};

// PUT /api/profile
export const updateProfile = async (req, res) => {
  const input = updateProfileSchema.parse(req.body);
  const user = await profileService.updateProfile(req.user.id, input);
  res.json({ message: "Profile updated successfully", user });
};

// PUT /api/profile/notifications
export const updateNotificationSettings = async (req, res) => {
  const settings = notificationSettingsSchema.parse(req.body);
  const saved = await profileService.updateNotificationSettings(req.user.id, settings);
  res.json({ message: "Notification preferences updated", settings: saved });
};

// DELETE /api/profile
export const deleteAccount = async (req, res) => {
  const { password } = deleteAccountSchema.parse(req.body);
  await profileService.deleteAccount(req.user.id, password);
  res.json({ message: "Account deleted successfully" });
};

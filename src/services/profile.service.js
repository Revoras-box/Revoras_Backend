import bcrypt from "bcrypt";
import * as userRepo from "../repositories/user.repository.js";
import { ServiceError } from "../utils/ServiceError.js";

export const getProfile = async (userId) => {
  const user = await userRepo.findProfileById(userId);
  if (!user) throw new ServiceError(404, "User not found");

  const stats = await userRepo.getBookingLoyaltyStats(userId);

  return {
    user,
    stats: {
      totalBookings: Number(stats.total_bookings),
      completedBookings: Number(stats.completed_bookings),
      totalSpent: Number(stats.total_spent),
      // Simple, transparent formula (10 pts/completed booking) - a real
      // loyalty-tier system is a product decision for later, not this phase.
      loyaltyPoints: Number(stats.completed_bookings) * 10,
    },
  };
};

export const updateProfile = async (userId, input) => {
  const patch = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.phone !== undefined) patch.phone = input.phone;
  if (input.dateOfBirth !== undefined) patch.date_of_birth = input.dateOfBirth;
  if (input.gender !== undefined) patch.gender = input.gender;
  if (input.avatarUrl !== undefined) patch.avatar_url = input.avatarUrl;
  if (input.preferences !== undefined) patch.preferences = JSON.stringify(input.preferences);

  if (Object.keys(patch).length === 0) {
    throw new ServiceError(400, "No fields to update");
  }

  return userRepo.updateProfile(userId, patch);
};

export const updateNotificationSettings = (userId, settings) => userRepo.updateNotificationSettings(userId, settings);

export const deleteAccount = async (userId, password) => {
  const user = await userRepo.findById(userId);
  if (!user) throw new ServiceError(404, "User not found");

  // Google-only accounts have no password hash; bcrypt.compare would throw a
  // 500 on null rather than refusing the deletion.
  if (!user.password) {
    throw new ServiceError(400, "This account signs in with Google. Set a password via password reset before deleting it.");
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) throw new ServiceError(401, "Invalid password");

  await userRepo.softDeactivate(userId);
};

import * as adminDashboardRepo from "../repositories/adminDashboard.repository.js";
import * as adminActivityLogRepo from "../repositories/adminActivityLog.repository.js";

export const getDashboard = async () => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const sinceDate = thirtyDaysAgo.toISOString().split("T")[0];

  const [businessStats, activeUsers, bookingStats, recentPendingBusinesses, recentActivity] = await Promise.all([
    adminDashboardRepo.getBusinessStatusCounts(),
    adminDashboardRepo.getActiveUserCount(),
    adminDashboardRepo.getBookingStats(sinceDate),
    adminDashboardRepo.getRecentPendingBusinesses(5),
    adminActivityLogRepo.listRecent(10),
  ]);

  return {
    businesses: {
      pending: Number(businessStats.pending),
      approved: Number(businessStats.approved),
      rejected: Number(businessStats.rejected),
      suspended: Number(businessStats.suspended),
      total: Number(businessStats.total),
    },
    users: { total: activeUsers },
    bookings: {
      total: Number(bookingStats.total),
      completed: Number(bookingStats.completed),
      upcoming: Number(bookingStats.upcoming),
      revenue: Number(bookingStats.revenue),
    },
    recentPendingBusinesses,
    recentActivity,
  };
};

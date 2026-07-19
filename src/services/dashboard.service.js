import * as dashboardRepo from "../repositories/dashboard.repository.js";

const toDateStr = (d) => d.toISOString().split("T")[0];
const toTimeStr = (d) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;

/**
 * Every sub-query here is independent of the others, so they run concurrently
 * (Promise.all) rather than sequentially - report.md Phase 2.2 plan's "avoid
 * N+1 queries" applies to round trips generally, not just per-row loops.
 */
export const getDashboard = async (studioId) => {
  const now = new Date();
  const today = toDateStr(now);
  const currentTime = toTimeStr(now);

  const weekStartDate = new Date(now);
  weekStartDate.setDate(weekStartDate.getDate() - weekStartDate.getDay());
  const weekStart = toDateStr(weekStartDate);

  const lastWeekStartDate = new Date(weekStartDate);
  lastWeekStartDate.setDate(lastWeekStartDate.getDate() - 7);
  const lastWeekStart = toDateStr(lastWeekStartDate);

  const thirtyDaysAgoDate = new Date(now);
  thirtyDaysAgoDate.setDate(thirtyDaysAgoDate.getDate() - 30);
  const thirtyDaysAgo = toDateStr(thirtyDaysAgoDate);

  const [
    todaysBookings,
    upcomingBookings,
    revenue,
    popularServices,
    activeProfessionals,
    statusCounts,
    newCustomersCount,
    ratingRow,
    awaitingReplyRow,
  ] = await Promise.all([
      dashboardRepo.todaysBookings(studioId, today),
      dashboardRepo.upcomingBookings(studioId, { today, currentTime, limit: 10 }),
      dashboardRepo.revenueSummary(studioId, { today, weekStart, lastWeekStart }),
      dashboardRepo.popularServices(studioId, { sinceDate: thirtyDaysAgo, limit: 5 }),
      dashboardRepo.activeProfessionals(studioId, today),
      dashboardRepo.bookingStatusCounts(studioId, thirtyDaysAgo),
      dashboardRepo.newCustomersCount(studioId, thirtyDaysAgo),
      dashboardRepo.averageRating(studioId),
      dashboardRepo.reviewsAwaitingReply(studioId),
    ]);

  const weekRevenue = Number(revenue.week_revenue);
  const lastWeekRevenue = Number(revenue.last_week_revenue);

  return {
    today: {
      bookings: todaysBookings,
      bookingsCount: Number(revenue.today_count),
      revenue: Number(revenue.today_revenue),
    },
    upcomingBookings,
    revenue: {
      today: Number(revenue.today_revenue),
      thisWeek: weekRevenue,
      lastWeek: lastWeekRevenue,
      weekChangePercent: lastWeekRevenue > 0 ? Math.round(((weekRevenue - lastWeekRevenue) / lastWeekRevenue) * 100) : 0,
    },
    popularServices: popularServices.map((s) => ({
      id: s.id,
      name: s.name,
      bookingsCount: Number(s.bookings_count),
      revenue: Number(s.revenue),
    })),
    activeProfessionals: activeProfessionals.map((p) => ({
      id: p.id,
      name: p.name,
      designation: p.designation,
      rating: Number(p.rating),
      imageUrl: p.image_url,
      todayBookingsCount: Number(p.today_bookings_count),
    })),
    bookingStatusCounts: Object.fromEntries(statusCounts.map((r) => [r.status, Number(r.count)])),
    newCustomersCount,
    averageRating: Number(ratingRow.avg_rating) || 0,
    reviewsAwaitingReply: Number(awaitingReplyRow.count) || 0,
  };
};

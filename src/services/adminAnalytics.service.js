import * as adminAnalyticsRepo from "../repositories/adminAnalytics.repository.js";

const PERIOD_DAYS = { week: 7, month: 30, quarter: 90, year: 365 };

const resolveSinceDate = (period) => {
  const days = PERIOD_DAYS[period] ?? PERIOD_DAYS.month;
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split("T")[0];
};

const resolveGranularity = (period) => {
  if (period === "quarter") return "week";
  if (period === "year") return "month";
  return "day";
};

// Platform-wide trend/aggregate view, distinct from getDashboard's
// today-focused snapshot - "Dashboard" and "Analytics" are both named scope
// items (report.md Phase 2.5 plan), mirroring the same split already made
// for the Business side in Phase 2.2.
export const getAnalytics = async ({ period = "month" }) => {
  const sinceDate = resolveSinceDate(period);
  const granularity = resolveGranularity(period);

  const [totals, businessGrowth, userGrowth, revenueOverTime, topBusinesses, categoryBreakdown] = await Promise.all([
    adminAnalyticsRepo.getTotals(sinceDate),
    adminAnalyticsRepo.getBusinessGrowth(sinceDate, granularity),
    adminAnalyticsRepo.getUserGrowth(sinceDate, granularity),
    adminAnalyticsRepo.getRevenueOverTime(sinceDate, granularity),
    adminAnalyticsRepo.getTopBusinesses(sinceDate, 10),
    adminAnalyticsRepo.getCategoryBreakdown(),
  ]);

  return {
    period,
    totals: { bookings: Number(totals.total_bookings), revenue: Number(totals.total_revenue) },
    businessGrowth: businessGrowth.map((r) => ({ bucket: r.bucket, count: Number(r.count) })),
    userGrowth: userGrowth.map((r) => ({ bucket: r.bucket, count: Number(r.count) })),
    revenueOverTime: revenueOverTime.map((r) => ({ bucket: r.bucket, revenue: Number(r.revenue) })),
    topBusinesses: topBusinesses.map((r) => ({ id: r.id, name: r.name, bookingsCount: Number(r.bookings_count), revenue: Number(r.revenue) })),
    categoryBreakdown: categoryBreakdown.map((r) => ({ categoryName: r.category_name, businessCount: Number(r.business_count) })),
  };
};

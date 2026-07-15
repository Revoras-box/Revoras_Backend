import * as analyticsRepo from "../repositories/analytics.repository.js";
import * as dashboardRepo from "../repositories/dashboard.repository.js";

const PERIOD_DAYS = { week: 7, month: 30, quarter: 90, year: 365 };

const resolveSinceDate = (period) => {
  const days = PERIOD_DAYS[period] ?? PERIOD_DAYS.month;
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split("T")[0];
};

// Bucket size scales with period length so a chart never renders 365 daily
// points for a year view or 7 monthly points for a week view.
const resolveGranularity = (period) => {
  if (period === "quarter") return "week";
  if (period === "year") return "month";
  return "day";
};

export const getAnalytics = async (studioId, { period = "month", page = 1, limit = 10 }) => {
  const sinceDate = resolveSinceDate(period);
  const granularity = resolveGranularity(period);

  const [totals, revenueOverTime, topServices, peakHours, memberPerformance, reviewStats] = await Promise.all([
    analyticsRepo.totals(studioId, sinceDate),
    analyticsRepo.revenueOverTime(studioId, sinceDate, granularity),
    dashboardRepo.popularServices(studioId, { sinceDate, limit: 5 }),
    analyticsRepo.peakHours(studioId, sinceDate),
    analyticsRepo.memberPerformancePage(studioId, sinceDate, { page, limit }),
    analyticsRepo.reviewStats(studioId, sinceDate),
  ]);

  return {
    period,
    totals: {
      bookings: Number(totals.total_bookings),
      revenue: Number(totals.total_revenue),
      avgTicket: Number(totals.avg_ticket),
    },
    revenueOverTime: revenueOverTime.map((r) => ({
      bucket: r.bucket,
      revenue: Number(r.revenue),
      bookingsCount: Number(r.bookings_count),
    })),
    topServices: topServices.map((s) => ({
      id: s.id,
      name: s.name,
      bookingsCount: Number(s.bookings_count),
      revenue: Number(s.revenue),
    })),
    peakHours: peakHours.map((h) => ({ hour: h.hour, bookingsCount: Number(h.bookings_count) })),
    memberPerformance: {
      members: memberPerformance.rows.map((m) => ({
        id: m.id,
        name: m.name,
        designation: m.designation,
        status: m.status,
        bookingsCount: Number(m.bookings_count),
        revenue: Number(m.revenue),
      })),
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: memberPerformance.total,
        pages: Math.ceil(memberPerformance.total / limit),
      },
    },
    reviews: {
      total: Number(reviewStats.total),
      avgRating: Number(reviewStats.avg_rating),
      distribution: {
        5: Number(reviewStats.five_star),
        4: Number(reviewStats.four_star),
        3: Number(reviewStats.three_star),
        2: Number(reviewStats.two_star),
        1: Number(reviewStats.one_star),
      },
    },
  };
};

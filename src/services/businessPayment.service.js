import * as paymentsRepo from "../repositories/businessPayment.repository.js";

export const listPayments = async (studioId, { status, from, to, page = 1, limit = 20 }) => {
  const [{ rows, total }, summary] = await Promise.all([
    paymentsRepo.listForStudio(studioId, { status, from, to, page: Number(page), limit: Number(limit) }),
    paymentsRepo.summaryForStudio(studioId),
  ]);

  return {
    payments: rows.map((r) => ({
      id: r.id,
      amount: Number(r.amount),
      currency: r.currency,
      status: r.status,
      verifiedAt: r.verified_at,
      createdAt: r.created_at,
      bookingId: r.booking_id,
      bookingDate: r.booking_date,
      confirmationCode: r.confirmation_code,
      customerName: r.customer_name,
    })),
    summary: {
      totalPaid: Number(summary.total_paid),
      totalRefunded: Number(summary.total_refunded),
      totalPending: Number(summary.total_pending),
      totalCount: Number(summary.total_count),
    },
    pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) },
  };
};

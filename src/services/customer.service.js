import * as customerRepo from "../repositories/customer.repository.js";

export const listCustomers = async (studioId, { search, page = 1, limit = 20 }) => {
  const { rows, total } = await customerRepo.listForStudio(studioId, {
    search,
    page: Number(page),
    limit: Number(limit),
  });

  return {
    customers: rows.map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      imageUrl: r.image_url,
      visitsCount: Number(r.visits_count),
      totalSpent: Number(r.total_spent),
      firstVisit: r.first_visit,
      lastVisit: r.last_visit,
    })),
    pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) },
  };
};

export const getCustomerBookingHistory = async (studioId, userId, { page = 1, limit = 20 }) => {
  const { rows, total } = await customerRepo.bookingHistoryForCustomer(studioId, userId, {
    page: Number(page),
    limit: Number(limit),
  });

  return {
    bookings: rows,
    pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) },
  };
};

import * as customerService from "../services/customer.service.js";
import { listCustomersQuerySchema, customerBookingHistoryQuerySchema } from "../validators/customer.validator.js";

// GET /api/business/:studioId/customers
export const listCustomers = async (req, res) => {
  const query = listCustomersQuerySchema.parse(req.query);
  const result = await customerService.listCustomers(req.params.studioId, query);
  res.json(result);
};

// GET /api/business/:studioId/customers/:userId/bookings
export const getCustomerBookingHistory = async (req, res) => {
  const query = customerBookingHistoryQuerySchema.parse(req.query);
  const result = await customerService.getCustomerBookingHistory(req.params.studioId, req.params.userId, query);
  res.json(result);
};

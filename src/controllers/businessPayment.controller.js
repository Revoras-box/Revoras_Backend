import * as paymentService from "../services/businessPayment.service.js";
import { listBusinessPaymentsQuerySchema } from "../validators/businessPayment.validator.js";

// GET /api/business/:studioId/payments
export const listBusinessPayments = async (req, res) => {
  const query = listBusinessPaymentsQuerySchema.parse(req.query);
  const result = await paymentService.listPayments(req.params.studioId, query);
  res.json(result);
};

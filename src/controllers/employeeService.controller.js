import * as employeeServiceService from "../services/employeeService.service.js";
import { setMemberServicesSchema } from "../validators/employeeService.validator.js";

// GET /api/business/:studioId/members/:memberId/services
export const getMemberServices = async (req, res) => {
  const result = await employeeServiceService.getMemberCatalogue(req.params.studioId, req.params.memberId);
  res.json(result);
};

// PUT /api/business/:studioId/members/:memberId/services
// Wholesale replace - the assignment screen is one form, so anything the owner
// left unticked means "stop offering it", not "leave it alone".
export const setMemberServices = async (req, res) => {
  const { services } = setMemberServicesSchema.parse(req.body);
  const result = await employeeServiceService.setMemberCatalogue(req.params.studioId, req.params.memberId, services);
  res.json({ message: "Services updated successfully", ...result });
};

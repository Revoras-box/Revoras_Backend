import * as timeOffRepo from "../repositories/timeOff.repository.js";
import * as businessMemberRepo from "../repositories/businessMember.repository.js";
import { ServiceError } from "../utils/ServiceError.js";

const TIME_VALUE_REGEX = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export const list = (studioId, filters) => timeOffRepo.list(studioId, filters);

export const create = async (studioId, { businessMemberId, date, startTime, endTime, isFullDay, reason }) => {
  if (!businessMemberId || !date) {
    throw new ServiceError(400, "Professional and date are required");
  }

  const fullDay = Boolean(isFullDay);
  if (!fullDay) {
    if (!startTime || !endTime || !TIME_VALUE_REGEX.test(startTime) || !TIME_VALUE_REGEX.test(endTime)) {
      throw new ServiceError(400, "Valid start and end time are required unless blocking the full day");
    }
    if (startTime >= endTime) {
      throw new ServiceError(400, "End time must be after start time");
    }
  }

  const member = await businessMemberRepo.findById(businessMemberId);
  if (!member || member.studio_id !== studioId) {
    throw new ServiceError(404, "Professional not found at this business");
  }

  return timeOffRepo.create({
    studio_id: studioId,
    business_member_id: businessMemberId,
    date,
    start_time: fullDay ? null : startTime,
    end_time: fullDay ? null : endTime,
    is_full_day: fullDay,
    reason: reason || null,
  });
};

export const remove = async (studioId, id, scope) => {
  const deletedIds = await timeOffRepo.remove(id, studioId, scope);
  if (deletedIds.length === 0) {
    throw new ServiceError(404, "Blocked time entry not found");
  }
};

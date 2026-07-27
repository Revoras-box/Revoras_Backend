import knex from "../../db/knex.js";
import * as memberWorkingHoursRepo from "../repositories/memberWorkingHours.repository.js";
import * as businessMemberRepo from "../repositories/businessMember.repository.js";
import * as workingHoursRepo from "../repositories/workingHours.repository.js";
import { ServiceError } from "../utils/ServiceError.js";
import { timeToMinutes } from "../utils/time.js";

const TIME_VALUE_REGEX = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

const assertMemberInStudio = async (studioId, businessMemberId) => {
  const member = await businessMemberRepo.findByIdForStudio(businessMemberId, studioId);
  if (!member) throw new ServiceError(404, "Professional not found at this business");
  return member;
};

/**
 * A member's rota plus the shop hours it sits inside.
 *
 * `followsBusinessHours` is the flag the dashboard toggles on: it means "no
 * rows stored", which is how a member inherits the shop's hours permanently
 * rather than getting a frozen copy of whatever they were on the day someone
 * opened the editor.
 */
export const getForMember = async (studioId, businessMemberId) => {
  await assertMemberInStudio(studioId, businessMemberId);

  const [days, businessHours] = await Promise.all([
    memberWorkingHoursRepo.listForMember(businessMemberId),
    workingHoursRepo.listForStudio(studioId),
  ]);

  return {
    followsBusinessHours: days.length === 0,
    days,
    businessHours,
  };
};

/**
 * Replace a member's whole week in one shot.
 *
 * `followsBusinessHours: true` deletes their rows (back to inheriting the
 * shop). Otherwise every supplied day is validated against the shop's hours for
 * that weekday and upserted.
 *
 * Out-of-hours days are rejected rather than silently clamped: an owner who
 * types 08:00 at a shop opening at 10:00 has made a mistake worth telling them
 * about. The read path intersects anyway, so a later change to shop hours can
 * never leave a member bookable behind a locked door.
 */
export const replaceForMember = async (studioId, businessMemberId, { followsBusinessHours, days }) => {
  await assertMemberInStudio(studioId, businessMemberId);

  if (followsBusinessHours) {
    await memberWorkingHoursRepo.clearForMember(businessMemberId);
    return getForMember(studioId, businessMemberId);
  }

  if (!Array.isArray(days) || days.length === 0) {
    throw new ServiceError(400, "Provide the professional's weekly hours, or set them to follow business hours");
  }

  const businessHours = await workingHoursRepo.listForStudio(studioId);
  const businessByDay = new Map(businessHours.map((row) => [row.day_of_week, row]));
  const seen = new Set();

  const normalized = days.map((day) => {
    const dayOfWeek = Number(day.dayOfWeek);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      throw new ServiceError(400, "dayOfWeek must be an integer from 0 to 6");
    }
    if (seen.has(dayOfWeek)) {
      throw new ServiceError(400, "Each weekday may only appear once");
    }
    seen.add(dayOfWeek);

    const isOff = Boolean(day.isOff);
    if (isOff) return { dayOfWeek, startTime: null, endTime: null, isOff: true };

    const { startTime, endTime } = day;
    if (!startTime || !endTime || !TIME_VALUE_REGEX.test(startTime) || !TIME_VALUE_REGEX.test(endTime)) {
      throw new ServiceError(400, "startTime and endTime must be in HH:MM format for working days");
    }
    if (timeToMinutes(startTime) >= timeToMinutes(endTime)) {
      throw new ServiceError(400, "End time must be after start time");
    }

    const shopDay = businessByDay.get(dayOfWeek);
    if (!shopDay || shopDay.is_closed) {
      throw new ServiceError(400, "The business is closed on a day this professional is scheduled to work");
    }
    if (
      timeToMinutes(startTime) < timeToMinutes(shopDay.open_time) ||
      timeToMinutes(endTime) > timeToMinutes(shopDay.close_time)
    ) {
      throw new ServiceError(
        400,
        `Hours must fall within business hours (${String(shopDay.open_time).slice(0, 5)}-${String(shopDay.close_time).slice(0, 5)}) for that day`
      );
    }

    return { dayOfWeek, startTime, endTime, isOff: false };
  });

  await knex.transaction(async (trx) => {
    for (const day of normalized) {
      await memberWorkingHoursRepo.upsertDay(trx, businessMemberId, day);
    }
  });

  return getForMember(studioId, businessMemberId);
};

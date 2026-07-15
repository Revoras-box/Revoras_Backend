import knex from "../../db/knex.js";
import * as workingHoursRepo from "../repositories/workingHours.repository.js";
import { ServiceError } from "../utils/ServiceError.js";

const TIME_VALUE_REGEX = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export const getForStudio = (studioId) => workingHoursRepo.listForStudio(studioId);

export const replaceForStudio = async (studioId, days) => {
  if (!Array.isArray(days) || days.length === 0) {
    throw new ServiceError(400, "At least one day's hours must be provided");
  }

  const normalized = days.map((day) => {
    const dayOfWeek = Number(day.dayOfWeek);
    const isClosed = Boolean(day.isClosed);
    const openTime = isClosed ? null : day.openTime;
    const closeTime = isClosed ? null : day.closeTime;

    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      throw new ServiceError(400, "dayOfWeek must be an integer from 0 to 6");
    }
    if (!isClosed) {
      if (!openTime || !closeTime) {
        throw new ServiceError(400, "openTime and closeTime are required for open days");
      }
      if (!TIME_VALUE_REGEX.test(openTime) || !TIME_VALUE_REGEX.test(closeTime)) {
        throw new ServiceError(400, "openTime and closeTime must be in HH:MM or HH:MM:SS format");
      }
    }

    return { dayOfWeek, openTime, closeTime, isClosed };
  });

  await knex.transaction(async (trx) => {
    for (const day of normalized) {
      await workingHoursRepo.upsertDay(trx, studioId, day);
    }
  });

  return getForStudio(studioId);
};

import knex from "../../db/knex.js";

export const listForStudio = (studioId, db = knex) =>
  db("working_hours").where({ studio_id: studioId }).orderBy("day_of_week");

/**
 * Upsert on the (studio_id, day_of_week) unique constraint - one row per
 * weekday, created by business signup (Phase 2.2/2.3) and edited here.
 */
export const upsertDay = (trx, studioId, { dayOfWeek, openTime, closeTime, isClosed }) =>
  trx("working_hours")
    .insert({
      studio_id: studioId,
      day_of_week: dayOfWeek,
      open_time: openTime,
      close_time: closeTime,
      is_closed: isClosed,
      updated_at: trx.fn.now(),
    })
    .onConflict(["studio_id", "day_of_week"])
    .merge(["open_time", "close_time", "is_closed", "updated_at"]);

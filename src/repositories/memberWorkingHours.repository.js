import knex from "../../db/knex.js";

export const listForMember = (businessMemberId, db = knex) =>
  db("member_working_hours").where({ business_member_id: businessMemberId }).orderBy("day_of_week");

/**
 * One round trip for a whole team - backs the business-wide "who is free when"
 * views so a 10-professional studio doesn't fan out into 10 queries.
 */
export const listForMembers = (businessMemberIds, db = knex) =>
  db("member_working_hours").whereIn("business_member_id", businessMemberIds).orderBy("day_of_week");

/** The member's row for one weekday, or undefined if they follow shop hours. */
export const findForMemberOnDay = (businessMemberId, dayOfWeek, db = knex) =>
  db("member_working_hours").where({ business_member_id: businessMemberId, day_of_week: dayOfWeek }).first();

export const countForMember = async (businessMemberId, db = knex) => {
  const row = await db("member_working_hours").where({ business_member_id: businessMemberId }).count({ n: "*" }).first();
  return Number(row?.n || 0);
};

export const upsertDay = (trx, businessMemberId, { dayOfWeek, startTime, endTime, isOff }) =>
  trx("member_working_hours")
    .insert({
      business_member_id: businessMemberId,
      day_of_week: dayOfWeek,
      start_time: isOff ? null : startTime,
      end_time: isOff ? null : endTime,
      is_off: isOff,
      updated_at: trx.fn.now(),
    })
    .onConflict(["business_member_id", "day_of_week"])
    .merge(["start_time", "end_time", "is_off", "updated_at"]);

/**
 * Clearing every row is how a member is put back on "follows shop hours" -
 * absence of rows is the fallback signal, so reverting must delete rather than
 * write a week of copies of the shop's current hours (which would then silently
 * stop tracking the shop when the owner changes opening times).
 */
export const clearForMember = (businessMemberId, db = knex) =>
  db("member_working_hours").where({ business_member_id: businessMemberId }).del();

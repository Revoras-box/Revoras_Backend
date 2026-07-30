import * as bookingRepo from "../repositories/booking.repository.js";
import * as businessMemberRepo from "../repositories/businessMember.repository.js";
import * as businessRepo from "../repositories/business.repository.js";
import * as workingHoursRepo from "../repositories/workingHours.repository.js";
import * as memberWorkingHoursRepo from "../repositories/memberWorkingHours.repository.js";
import * as employeeServiceService from "./employeeService.service.js";
import * as employeeServiceRepo from "../repositories/employeeService.repository.js";
import { ServiceError } from "../utils/ServiceError.js";
import {
  timeToMinutes,
  minutesToTime,
  dayOfWeekForDate,
  nowInAppTimezone,
} from "../utils/time.js";

const DEFAULT_SLOT_INTERVAL = 30;
const MAX_HORIZON_DAYS = 90;

/**
 * Why a day has no slots. The booking UI shows one of these instead of an
 * unexplained empty grid - "Ravi is off on Sundays" and "fully booked" are very
 * different messages to a customer, and only the server knows which applies.
 */
export const UNAVAILABLE_REASONS = {
  BUSINESS_CLOSED: "business_closed",
  MEMBER_OFF: "member_off",
  TIME_OFF: "time_off",
  FULLY_BOOKED: "fully_booked",
  DAY_ENDED: "day_ended",
  TOO_LONG: "duration_exceeds_shift",
  // The professional simply doesn't perform something in the basket. Distinct
  // from "fully booked" because no other date will help - the customer needs a
  // different professional, or a different basket.
  NOT_OFFERED: "service_not_offered",
};

/**
 * The member's bookable window for one weekday, in minutes past midnight.
 *
 * Two rules, in order:
 *  1. A member with no `member_working_hours` rows at all follows the shop.
 *     Absence means "not configured", not "never works" - otherwise adding this
 *     table would have silently un-booked every existing professional.
 *  2. A member with rows is INTERSECTED with the shop's hours, never unioned.
 *     An owner who sets someone 08:00-22:00 at a shop open 10:00-19:00 gets
 *     10:00-19:00, because a booking outside opening hours means a locked door.
 */
const resolveShift = ({ businessHours, memberHours, hasMemberSchedule }) => {
  if (!businessHours || businessHours.is_closed) {
    return { open: false, reason: UNAVAILABLE_REASONS.BUSINESS_CLOSED };
  }

  const shopStart = timeToMinutes(businessHours.open_time);
  const shopEnd = timeToMinutes(businessHours.close_time);
  if (shopStart === null || shopEnd === null || shopEnd <= shopStart) {
    return { open: false, reason: UNAVAILABLE_REASONS.BUSINESS_CLOSED };
  }

  if (!hasMemberSchedule) {
    return { open: true, start: shopStart, end: shopEnd, source: "business" };
  }

  // Has a schedule, but nothing for this weekday -> that day is a day off.
  // Only an explicit row makes a member available once they're on a rota.
  if (!memberHours || memberHours.is_off) {
    return { open: false, reason: UNAVAILABLE_REASONS.MEMBER_OFF };
  }

  const memberStart = timeToMinutes(memberHours.start_time);
  const memberEnd = timeToMinutes(memberHours.end_time);
  if (memberStart === null || memberEnd === null) {
    return { open: false, reason: UNAVAILABLE_REASONS.MEMBER_OFF };
  }

  const start = Math.max(shopStart, memberStart);
  const end = Math.min(shopEnd, memberEnd);
  if (end <= start) {
    // Rota and opening hours don't overlap at all on this day.
    return { open: false, reason: UNAVAILABLE_REASONS.MEMBER_OFF };
  }

  return { open: true, start, end, source: "member" };
};

/**
 * Why a particular start time can't be booked. Unlike UNAVAILABLE_REASONS
 * (which explains a whole empty day), these are per-slot: the grid renders the
 * WHOLE shift so a customer can see the shape of the day, and each position
 * carries the reason it is or isn't bookable.
 */
export const SLOT_STATUS = {
  AVAILABLE: "available",
  BOOKED: "booked",
  BLOCKED: "blocked",
  PAST: "past",
  // The slot itself is free, but the selected services don't fit before the
  // next appointment (or the end of the shift). This is the one status the
  // customer can act on - by dropping a service - so it is kept distinct from
  // "booked", which nothing they do can change.
  TOO_SHORT: "insufficient_time",
  // Where the customer's own appointment sits, when they're moving it. Free (it
  // no longer blocks anything for them) but not offered, because "moving" a
  // booking to the time it already has is not a move.
  CURRENT: "current",
};

/**
 * The appointment the customer is moving, verified as theirs.
 *
 * A reschedule must not be blocked by the very booking it is moving: the chair
 * is only occupied until they leave it, so their own range is dropped from the
 * busy list and the window it holds is offered at its true length. Ownership is
 * checked against the caller's own token - availability is a public endpoint, so
 * without this anyone could ask for a grid with someone else's appointment
 * erased and be shown times that aren't really free.
 *
 * Matching happens inside the date's own rows, so a booking on another date or
 * with another professional simply never matches - no date arithmetic needed.
 */
const resolveOwnBooking = async ({ excludeBookingId, userId, bookedRows }) => {
  if (!excludeBookingId || !userId) return null;
  const owned = await bookingRepo.findByIdForUser(excludeBookingId, userId);
  if (!owned) return null;
  return bookedRows.find((row) => String(row.id) === String(excludeBookingId)) || null;
};

/**
 * Flag every grid position the customer's current appointment covers.
 *
 * Their booking was removed from the busy ranges above, so without this the time
 * they already hold would render as an ordinary free slot - no anchor for "this
 * is where I'm moving from", and an invitation to spend one of a limited number
 * of moves going nowhere.
 */
const markCurrentSlots = (grid, booking) => {
  const start = timeToMinutes(booking.start_time);
  const end = timeToMinutes(booking.end_time);
  if (start === null || end === null) return grid;

  return grid.map((slot) => {
    const at = timeToMinutes(slot.time);
    if (at === null || at < start || at >= end) return slot;
    // Not offered as a start time: confirming the time they already have would
    // spend a move and change nothing.
    return { ...slot, status: SLOT_STATUS.CURRENT, available: false };
  });
};

/** Bookings + time off as busy ranges. Full-day blocks are handled upstream. */
const toBusyRanges = (bookedRows, blockedRows) =>
  [
    ...bookedRows.map((row) => ({ row, kind: SLOT_STATUS.BOOKED })),
    ...blockedRows.map((row) => ({ row, kind: SLOT_STATUS.BLOCKED })),
  ]
    .map(({ row, kind }) => ({
      start: timeToMinutes(row.start_time),
      end: timeToMinutes(row.end_time),
      kind,
    }))
    .filter(({ start, end }) => start !== null && end !== null && end > start)
    .sort((a, b) => a.start - b.start);

/**
 * The heart of it: walk the shift and keep every start where the WHOLE
 * appointment fits.
 *
 * Three things the old implementation got wrong and this fixes:
 *  - It offered a slot if the slot's own 30 minutes were free, ignoring how
 *    long the booking actually runs. A 60-minute cut+beard was offered at 19:30
 *    against a 20:00 close, and offered at 11:00 with an existing 11:30
 *    booking. `slotStart + duration` is checked against both the shift end and
 *    every busy range, so a 60-minute service genuinely needs 60 free minutes.
 *  - Slots came from a hardcoded 09:00-20:00 list, so a shop open 07:00-22:00
 *    could not be booked outside those hours at all.
 *  - The walk stepped rigidly by the interval straight through appointments, so
 *    a 09:00-09:50 booking on a 15-minute grid pushed the next offer to 10:00
 *    and burned ten sellable minutes. The walk now RE-ANCHORS on the moment the
 *    chair frees - see below.
 */
const generateGrid = ({ shiftStart, shiftEnd, earliestStart, interval, duration, busyRanges }) => {
  const grid = [];
  // The walk covers the whole shift - including time that is already taken -
  // because a grid that silently omits it reads as "the salon has nothing at
  // 3pm" when the truth is "3pm is booked".
  let start = shiftStart;
  // Earliest minute not yet represented by a chip. Keeps the grid strictly
  // ascending when a busy range starts before the point the walk resumed from,
  // which happens when time off overlaps a booking.
  let resumeFloor = shiftStart;

  while (start < shiftEnd) {
    // Taken only if the START MINUTE itself is inside an appointment. Testing
    // the whole interval step instead would mark 12:20 "booked" against a 12:30
    // appointment, when the truth is "10 minutes free here" - a state the
    // customer can act on by trimming a service, and the fall-through below
    // reports it as exactly that.
    const covering = busyRanges.find(({ start: busyStart, end: busyEnd }) => start >= busyStart && start < busyEnd);

    if (covering) {
      // How long the customer would have to wait. The end of a booking is
      // schedule information the salon publishes anyway (it's when the chair
      // frees up); no customer detail is exposed.
      const freeAt = Math.min(covering.end, shiftEnd);
      grid.push({
        // The appointment's own start, not wherever the walk happened to land
        // inside it, so one chip reads as the real block of time it stands for.
        time: minutesToTime(Math.max(covering.start, resumeFloor)),
        status: covering.kind,
        available: false,
        freeAt: minutesToTime(freeAt),
        maxDuration: 0,
      });
      // Re-anchor. `covering.end > start` is guaranteed by the containment test,
      // so the walk always advances. One chip covers the whole appointment
      // (rather than one per interval step), and the day resumes at the exact
      // minute the chair is free instead of at the next multiple of the interval.
      start = freeAt;
      resumeFloor = freeAt;
      continue;
    }

    if (start < earliestStart) {
      grid.push({ time: minutesToTime(start), status: SLOT_STATUS.PAST, available: false, maxDuration: 0 });
      start += interval;
      continue;
    }

    // Contiguous free minutes from this start: up to the next busy range, or
    // the end of the shift, whichever comes first. This is the number the
    // booking UI needs to say "only 30 min free here" and to work out which
    // services would fit.
    const nextBusy = busyRanges.find(({ start: busyStart }) => busyStart >= start);
    const freeUntil = Math.min(shiftEnd, nextBusy ? nextBusy.start : shiftEnd);
    const maxDuration = Math.max(freeUntil - start, 0);
    const fits = maxDuration >= duration;

    grid.push({
      time: minutesToTime(start),
      status: fits ? SLOT_STATUS.AVAILABLE : SLOT_STATUS.TOO_SHORT,
      available: fits,
      maxDuration,
      // What the customer is up against: the appointment that caps this window,
      // or the end of the working day.
      freeUntil: minutesToTime(freeUntil),
      limitedBy: nextBusy ? nextBusy.kind : "shift_end",
    });
    start += interval;
  }
  return grid;
};

/**
 * Resolve the requested duration. Callers may pass `serviceIds` (authoritative -
 * the same rows createBooking will price and time) or a raw `duration`.
 *
 * Passing serviceIds is strongly preferred: it makes the availability grid and
 * the eventual booking agree by construction, so a customer can never be shown
 * an 11:00 slot that the booking endpoint then rejects for length.
 *
 * Sized from THIS professional's durations, not the catalogue's. The same
 * haircut+beard basket is 50 minutes with Rahul and 65 with Aman, and the grid
 * has to reserve the right one or the booking will overrun the next customer.
 */
const resolveDuration = async ({ serviceIds, duration, memberId, studioId, fallbackDuration }) => {
  if (serviceIds?.length) {
    const rows = await employeeServiceService.resolveBasketForMember(memberId, studioId, serviceIds);
    const total = rows.reduce((sum, row) => sum + Number(row.duration), 0);
    return Math.max(total, 1);
  }
  return Math.max(Number(duration) || Number(fallbackDuration) || DEFAULT_SLOT_INTERVAL, 1);
};

const emptyResult = (reason, extra = {}) => ({
  slots: [],
  grid: [],
  available: false,
  reason,
  ...extra,
});

/**
 * Bookable start times for one professional on one date.
 *
 * Returns `slots` (the plain "HH:MM" array the booking wizard already consumes)
 * plus the context needed to explain an empty grid.
 *
 * `excludeBookingId` + `userId` are the reschedule case: the caller's own
 * appointment stops blocking the grid it is being moved within.
 */
export const getAvailability = async ({
  businessMemberId,
  date,
  duration,
  serviceIds,
  studioId,
  gridInterval,
  excludeBookingId,
  userId,
}) => {
  if (!businessMemberId || !date) {
    throw new ServiceError(400, "Professional ID and date are required");
  }

  const member = await businessMemberRepo.findById(businessMemberId);
  if (!member) {
    throw new ServiceError(404, "Professional not found");
  }
  if (studioId && member.studio_id !== studioId) {
    throw new ServiceError(404, "Professional not found at this business");
  }
  if (member.status !== "active" || !member.provides_services) {
    return emptyResult(UNAVAILABLE_REASONS.MEMBER_OFF, { shift: null });
  }

  const resolvedStudioId = member.studio_id;

  const today = nowInAppTimezone();
  if (date < today.date) {
    return emptyResult(UNAVAILABLE_REASONS.DAY_ENDED, { shift: null });
  }

  const business = await businessRepo.findById(resolvedStudioId);
  if (!business) throw new ServiceError(404, "Business not found");

  // This professional's own rhythm - the shortest service THEY perform, rounded
  // to a readable step. Callers that ask about many days resolve it once and pass
  // it in: it's a property of the employee's catalogue, not of any one date.
  const { interval, intervalSource, shortestServiceDuration } =
    gridInterval ?? (await employeeServiceService.getSchedulingProfile(businessMemberId, resolvedStudioId, business));

  // No services and no explicit duration: size the appointment at one grid step
  // rather than a hardcoded half hour, so a probe for "is anything free at all"
  // asks about the smallest thing this professional actually does.
  let totalDuration;
  try {
    totalDuration = await resolveDuration({
      serviceIds,
      duration,
      memberId: businessMemberId,
      studioId: resolvedStudioId,
      fallbackDuration: interval,
    });
  } catch (err) {
    // Asking "when is Rahul free for a hair colour he doesn't do" is a fair
    // question with a real answer - "he doesn't do it" - not a client error.
    // createBooking still rejects the same basket outright; this is only the
    // browsing path.
    if (err instanceof ServiceError && err.statusCode === 400) {
      return emptyResult(UNAVAILABLE_REASONS.NOT_OFFERED, {
        shift: null,
        interval,
        intervalSource,
        shortestServiceDuration,
      });
    }
    throw err;
  }
  const dayOfWeek = dayOfWeekForDate(date);

  const [businessHoursRows, memberHoursRows, bookedRows, blockedRows] = await Promise.all([
    workingHoursRepo.listForStudio(resolvedStudioId),
    memberWorkingHoursRepo.listForMember(businessMemberId),
    bookingRepo.findBookingsForMemberOnDate(businessMemberId, date),
    bookingRepo.findTimeOffForMemberOnDate(businessMemberId, date),
  ]);

  const shift = resolveShift({
    businessHours: businessHoursRows.find((row) => row.day_of_week === dayOfWeek),
    memberHours: memberHoursRows.find((row) => row.day_of_week === dayOfWeek),
    hasMemberSchedule: memberHoursRows.length > 0,
  });

  if (!shift.open) return emptyResult(shift.reason, { shift: null });

  const shiftWindow = {
    start: minutesToTime(shift.start),
    end: minutesToTime(shift.end),
    source: shift.source,
  };

  if (blockedRows.some((row) => row.is_full_day)) {
    return emptyResult(UNAVAILABLE_REASONS.TIME_OFF, { shift: shiftWindow });
  }

  // A same-day request can only start from the next grid position that hasn't
  // already passed. Computed in the salon's wall clock (see utils/time.js).
  let effectiveStart = shift.start;
  if (date === today.date) {
    if (today.minutes >= shift.end) {
      return emptyResult(UNAVAILABLE_REASONS.DAY_ENDED, { shift: shiftWindow });
    }
    effectiveStart = Math.max(shift.start, today.minutes);
  }

  const ownBooking = await resolveOwnBooking({ excludeBookingId, userId, bookedRows });

  // The grid stays anchored to the shift start, so the same date shows the same
  // clock times whether it's viewed today or a week out; today's cutoff only
  // decides which of those positions are marked `past`.
  const rawGrid = generateGrid({
    shiftStart: shift.start,
    shiftEnd: shift.end,
    earliestStart: effectiveStart,
    interval,
    duration: totalDuration,
    busyRanges: toBusyRanges(
      ownBooking ? bookedRows.filter((row) => row !== ownBooking) : bookedRows,
      blockedRows
    ),
  });
  const grid = ownBooking ? markCurrentSlots(rawGrid, ownBooking) : rawGrid;

  const slots = grid.filter((slot) => slot.available).map((slot) => slot.time);

  // A selection longer than the whole working day can never fit, whatever the
  // customer taps - said plainly, rather than leaving them to infer it from a
  // grid where every slot is too short. The grid is still returned: it shows
  // how much room each position actually has, which is what tells them how much
  // to drop.
  const tooLongForShift = totalDuration > shift.end - shift.start;

  return {
    slots,
    grid,
    available: slots.length > 0,
    reason: slots.length > 0
      ? null
      : tooLongForShift
        ? UNAVAILABLE_REASONS.TOO_LONG
        : UNAVAILABLE_REASONS.FULLY_BOOKED,
    shift: shiftWindow,
    duration: totalDuration,
    interval,
    // Surfaced so the booking UI can say "times every 15 min" honestly, and so
    // an owner reading the response can see the grid tracks their catalogue.
    intervalSource,
    shortestServiceDuration,
    // The longest appointment that could start anywhere on this date - what the
    // customer would have to trim their selection to.
    longestFreeWindow: grid.reduce((max, slot) => Math.max(max, slot.maxDuration || 0), 0),
    // The window this move is LEAVING, when the caller is rescheduling and their
    // booking sits on the requested date. A new time may legitimately overlap it
    // - the same update vacates it - and the picker uses this to say so instead
    // of letting a 12:00 pick look like it collides with the 12:20 chip beside
    // it. Null for everyone else, so the shape of a normal response is unchanged.
    movingFrom: ownBooking
      ? {
          start: minutesToTime(timeToMinutes(ownBooking.start_time)),
          end: minutesToTime(timeToMinutes(ownBooking.end_time)),
        }
      : null,
  };
};

/**
 * Which of the next N days have any capacity - backs the date strip's
 * "greyed out" days so a customer isn't invited to tap through a fortnight of
 * empty Sundays one at a time.
 *
 * Days are resolved concurrently; each is the same single-day computation
 * above, so the strip and the grid can never disagree.
 */
export const getAvailabilityCalendar = async ({ businessMemberId, from, days = 14, duration, serviceIds, studioId }) => {
  const span = Math.min(Math.max(Number(days) || 14, 1), MAX_HORIZON_DAYS);
  const startDate = from || nowInAppTimezone().date;
  const [year, month, day] = startDate.split("-").map(Number);

  const dates = Array.from({ length: span }, (_, offset) => {
    const cursor = new Date(year, month - 1, day + offset);
    return `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
  });

  // Resolve this professional's rhythm once for the whole strip instead of once
  // per day - it's the same on every date. A missing member is left for
  // getAvailability to reject, so the 404 stays in one place.
  const member = await businessMemberRepo.findById(businessMemberId);
  const gridInterval = member
    ? await employeeServiceService.getSchedulingProfile(
        businessMemberId,
        member.studio_id,
        await businessRepo.findById(member.studio_id)
      )
    : undefined;

  const results = await Promise.all(
    dates.map(async (date) => {
      const result = await getAvailability({ businessMemberId, date, duration, serviceIds, studioId, gridInterval });
      return {
        date,
        available: result.available,
        slotCount: result.slots.length,
        firstSlot: result.slots[0] || null,
        reason: result.reason,
      };
    })
  );

  return { days: results };
};

/**
 * The same question asked across a whole team: "who can do this at all on this
 * date?". Backs an "any professional" pick in the booking flow, where the
 * customer cares about the time and not about which chair they sit in.
 */
export const getTeamAvailability = async ({ studioId, date, duration, serviceIds }) => {
  if (!studioId || !date) throw new ServiceError(400, "Business and date are required");

  const [members, business, shortestByMember] = await Promise.all([
    businessMemberRepo.listBookableForStudio(studioId),
    businessRepo.findById(studioId),
    // One grouped MIN for the whole team. Each chair now has its OWN rhythm, so
    // there is no single team interval to share - but there is no reason to ask
    // the database for each of them separately either.
    employeeServiceRepo.minDurationByMemberForStudio(studioId),
  ]);

  const professionals = await Promise.all(
    members.map(async (member) => {
      const shortest = shortestByMember.get(String(member.id));
      const memberInterval = employeeServiceService.deriveSlotInterval(shortest);
      // Fast path only for members whose assignments the grouped query found.
      // Anyone else (nothing assigned yet) still goes the long way, where the
      // catalogue fallback applies.
      const gridInterval = memberInterval
        ? { interval: memberInterval, intervalSource: "employee_services", shortestServiceDuration: shortest }
        : undefined;

      const result = await getAvailability({
        businessMemberId: member.id,
        date,
        duration,
        serviceIds,
        studioId,
        gridInterval,
      });
      return {
        businessMemberId: member.id,
        name: member.name,
        designation: member.designation,
        imageUrl: member.image_url,
        slots: result.slots,
        available: result.available,
        reason: result.reason,
        shift: result.shift,
        // Each professional's own rhythm, since they no longer share one.
        interval: result.interval ?? null,
        shortestServiceDuration: result.shortestServiceDuration ?? null,
      };
    })
  );

  // Union of every professional's slots - what the studio can offer at all.
  // Deliberately not a single grid: two chairs running on 20- and 25-minute
  // rhythms have genuinely different start times, and flattening them to one
  // would offer times nobody can actually work.
  const union = [...new Set(professionals.flatMap((p) => p.slots))].sort();

  return { date, slots: union, professionals };
};

/**
 * Clock/calendar helpers for scheduling.
 *
 * Booking rows store wall-clock values (`booking_date` is a DATE, `start_time`
 * a TIME) - deliberately, because "11:00 at this salon" must stay 11:00
 * regardless of where the server runs. That only holds if every comparison
 * against "now" is made in the salon's own wall clock too.
 *
 * The previous availability code derived today's date from
 * `new Date().toISOString()` (UTC) but the current time from `getHours()`
 * (server-local). In IST those disagree for five and a half hours every night:
 * at 02:00 on the 26th, UTC still reads the 25th, so "is this slot in the
 * past?" was being answered against the wrong day. Everything here reads both
 * halves from one timezone so they cannot drift apart.
 */

// Single-region product today (₹ pricing, India-only listings). Overridable so
// the first non-IST market is a config change, not a code change.
export const APP_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Kolkata";

const partsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** `{ date: "YYYY-MM-DD", minutes }` for the given instant in the app timezone. */
export const nowInAppTimezone = (instant = new Date()) => {
  const parts = Object.fromEntries(partsFormatter.formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
};

/** "HH:MM" / "HH:MM:SS" -> minutes past midnight. Null-safe. */
export const timeToMinutes = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const [hourRaw, minuteRaw] = String(value).split(":");
  const hours = Number(hourRaw);
  const minutes = Number(minuteRaw ?? 0);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  return hours * 60 + minutes;
};

/** Minutes past midnight -> "HH:MM". */
export const minutesToTime = (total) => {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

/** Half-open overlap: touching ranges (10:00-10:30, 10:30-11:00) do NOT overlap. */
export const rangesOverlap = (startA, endA, startB, endB) => startA < endB && startB < endA;

/**
 * Weekday index (0=Sunday) for a "YYYY-MM-DD" string, parsed as a plain
 * calendar date. Using `new Date("2026-07-25")` would parse as UTC midnight and
 * shift a day backwards for any timezone behind UTC.
 */
export const dayOfWeekForDate = (dateStr) => {
  const [year, month, day] = String(dateStr).split("-").map(Number);
  return new Date(year, month - 1, day).getDay();
};

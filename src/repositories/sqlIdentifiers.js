/**
 * Values that get interpolated into SQL text rather than passed as bindings.
 *
 * Postgres will not accept a parameter where `date_trunc`'s field argument
 * goes, so `date_trunc('${granularity}', ...)` is the shape that query has to
 * take. That makes `granularity` the one value in these repositories that
 * string-concatenates into SQL, and its safety currently rests entirely on an
 * invariant enforced two layers away, in each analytics service's
 * `resolveGranularity`.
 *
 * That invariant holds today. The problem is that it is invisible from the
 * query: nothing at the point of interpolation knows or checks it, so a later
 * refactor that widens the period enum, or plumbs a query parameter through
 * "just to make the chart configurable", introduces SQL injection without
 * touching a line that looks dangerous.
 *
 * Mapping through a fixed lookup makes the safe set local to the query and
 * enforced at the point of use. Anything not in the map is not a query with a
 * different granularity - it is a bug, and it throws.
 */
const DATE_TRUNC_FIELDS = Object.freeze({
  hour: "hour",
  day: "day",
  week: "week",
  month: "month",
  quarter: "quarter",
  year: "year",
});

export const dateTruncField = (granularity) => {
  const field = DATE_TRUNC_FIELDS[granularity];
  if (!field) {
    throw new Error(`Unsupported date_trunc granularity: ${JSON.stringify(granularity)}`);
  }
  return field;
};

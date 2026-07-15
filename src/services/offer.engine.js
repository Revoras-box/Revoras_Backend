import * as offerRepo from "../repositories/offer.repository.js";

/**
 * Phase 2.4 (Offers & Promotions) - the shared offer engine: the single place
 * that decides "what discount does this offer give" and "does this customer
 * qualify". Both discovery (summary/badge) and booking (apply + snapshot) call
 * through here, so the number a customer is shown on a card is computed by the
 * same code that charges them - they can't drift apart.
 *
 * Money is handled in paise (integers) internally to avoid float drift on
 * percentage math, then returned as a rupee number rounded to 2 dp.
 */
const toPaise = (rupees) => Math.round(Number(rupees) * 100);
const toRupees = (paise) => Math.round(paise) / 100;

/**
 * The raw discount an offer yields on a given applicable amount, before any
 * eligibility checks. `applicableAmount` is the sum of the prices the offer
 * covers: the whole booking for a business-wide offer, or only the targeted
 * services for a service-scoped one.
 */
export const computeDiscount = (offer, applicableAmount) => {
  const applicablePaise = toPaise(applicableAmount);
  if (applicablePaise <= 0) return 0;

  let discountPaise;
  if (offer.discount_type === "percentage") {
    discountPaise = Math.round((applicablePaise * Number(offer.discount_value)) / 100);
    if (offer.max_discount_amount != null) {
      discountPaise = Math.min(discountPaise, toPaise(offer.max_discount_amount));
    }
  } else {
    // flat: rupees off, but never more than the amount it applies to.
    discountPaise = toPaise(offer.discount_value);
  }

  // A discount can never exceed the amount it's discounting (a ₹500 flat offer
  // on a ₹300 service caps at ₹300, not a negative total).
  discountPaise = Math.min(discountPaise, applicablePaise);
  return toRupees(Math.max(0, discountPaise));
};

/**
 * The portion of a booking an offer applies to. Business-wide → the whole
 * total. Service-scoped → only the line prices of services in the offer's set.
 * `services` is [{ id, price }]; `offerServiceIds` is the offer's targeted set.
 */
const applicableAmountFor = (offer, services, offerServiceIds) => {
  if (offer.applies_to === "services") {
    const targeted = new Set(offerServiceIds.map(String));
    return services.filter((s) => targeted.has(String(s.id))).reduce((sum, s) => sum + Number(s.price), 0);
  }
  return services.reduce((sum, s) => sum + Number(s.price), 0);
};

/**
 * Is this offer usable for this specific booking attempt? Returns
 * { eligible, reason }. Usage/first-time checks hit the DB, so this is async
 * and only called for offers already known to be live.
 */
export const checkEligibility = async (offer, { userId, services, offerServiceIds, db }) => {
  const bookingTotal = services.reduce((sum, s) => sum + Number(s.price), 0);

  if (offer.min_spend != null && bookingTotal < Number(offer.min_spend)) {
    return { eligible: false, reason: "min_spend_not_met" };
  }

  // A service-scoped offer needs at least one targeted service in the booking.
  if (offer.applies_to === "services") {
    const targeted = new Set(offerServiceIds.map(String));
    if (!services.some((s) => targeted.has(String(s.id)))) {
      return { eligible: false, reason: "no_matching_service" };
    }
  }

  if (offer.first_time_only) {
    const hasBooked = await offerRepo.userHasBookingAtStudio(userId, offer.studio_id, db);
    if (hasBooked) return { eligible: false, reason: "not_first_time" };
  }

  if (offer.max_uses != null) {
    const total = await offerRepo.countUses(offer.id, db);
    if (total >= offer.max_uses) return { eligible: false, reason: "max_uses_reached" };
  }

  if (offer.max_uses_per_user != null) {
    const perUser = await offerRepo.countUsesByUser(offer.id, userId, db);
    if (perUser >= offer.max_uses_per_user) return { eligible: false, reason: "per_user_limit_reached" };
  }

  return { eligible: true };
};

/**
 * The best offer for a concrete booking attempt: of all currently-live offers
 * the customer qualifies for, the one giving the largest discount. Returns
 * { offer, discountAmount, originalAmount } or null.
 *
 * `db` is threaded through so the booking path can run this inside its
 * transaction - usage counts must be read in the same tx that writes the
 * booking, or two concurrent bookings could both pass a max_uses check.
 */
export const resolveBestOffer = async ({ studioId, services, userId, db }) => {
  const originalAmount = services.reduce((sum, s) => sum + Number(s.price), 0);
  const liveOffers = await offerRepo.listCurrentlyLiveForStudio(studioId, db);
  if (liveOffers.length === 0) return null;

  const serviceIdMap = await offerRepo.serviceIdsByOffer(
    liveOffers.map((o) => o.id),
    db
  );

  let best = null;
  for (const offer of liveOffers) {
    const offerServiceIds = serviceIdMap.get(offer.id) ?? [];
    const eligibility = await checkEligibility(offer, { userId, services, offerServiceIds, db });
    if (!eligibility.eligible) continue;

    const applicable = applicableAmountFor(offer, services, offerServiceIds);
    const discountAmount = computeDiscount(offer, applicable);
    if (discountAmount <= 0) continue;

    if (!best || discountAmount > best.discountAmount) {
      best = { offer, discountAmount, originalAmount };
    }
  }

  return best;
};

/**
 * A user- and booking-independent display summary of a business's live offers,
 * for the discovery card badge and the offer section on the detail page. This
 * is the "headline" number - it deliberately ignores per-user/first-time/
 * min-spend gates (a card can't know the viewer's history) and shows the best
 * advertised discount. `offers` are already-live offer rows.
 */
export const summarizeOffers = (offers) => {
  if (!offers || offers.length === 0) return null;

  const best = offers.reduce((acc, o) => {
    // Rank percentage offers by percent and flat offers by rupees; percentage
    // is the stronger headline when both exist (it scales with spend).
    const score =
      o.discount_type === "percentage" ? Number(o.discount_value) * 1000 : Number(o.discount_value);
    return !acc || score > acc.score ? { offer: o, score } : acc;
  }, null);

  const o = best.offer;
  const label =
    o.discount_type === "percentage"
      ? `${Number(o.discount_value)}% off${o.max_discount_amount != null ? ` up to ₹${Number(o.max_discount_amount)}` : ""}`
      : `₹${Number(o.discount_value)} off`;

  return {
    count: offers.length,
    bestLabel: label,
    bestType: o.discount_type,
    bestValue: Number(o.discount_value),
  };
};

/**
 * A single live offer in the shape the customer-facing offer section renders.
 * `serviceIds` is empty for a business-wide offer. Deliberately omits the
 * usage/first-time gates - those are enforced at booking, not advertised on a
 * card (a card can't know the viewer's history).
 */
export const toPublicOffer = (offer, serviceIds = []) => ({
  id: offer.id,
  title: offer.title,
  description: offer.description,
  discountType: offer.discount_type,
  discountValue: Number(offer.discount_value),
  maxDiscountAmount: offer.max_discount_amount != null ? Number(offer.max_discount_amount) : null,
  minSpend: offer.min_spend != null ? Number(offer.min_spend) : null,
  appliesTo: offer.applies_to,
  serviceIds,
  label:
    offer.discount_type === "percentage"
      ? `${Number(offer.discount_value)}% off${offer.max_discount_amount != null ? ` up to ₹${Number(offer.max_discount_amount)}` : ""}`
      : `₹${Number(offer.discount_value)} off`,
});

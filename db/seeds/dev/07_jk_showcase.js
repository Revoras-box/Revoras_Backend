import bcrypt from "bcrypt";
import * as reviewRepo from "../../../src/repositories/review.repository.js";
import { recomputeTrustScore } from "../../../src/services/trust.service.js";

/**
 * Showcase fixture: one fully-populated Business + one Professional in Srinagar,
 * J&K, so the customer journey (discover -> search -> detail -> professional ->
 * book) can be demoed against realistic data instead of `06_dev_fixtures`'
 * deliberately-bare "Test Barbershop".
 *
 * Every field the public detail/professional pages read is populated, because a
 * half-filled row renders as a page full of silently-omitted sections - the
 * sections are all conditional on their data being non-empty.
 *
 * Images are Unsplash/pravatar URLs, not R2 uploads: those hosts are already in
 * the frontend's next.config `remotePatterns`, so the images render without
 * depending on the R2 credential gate (currently 401 - see CURRENT_STATE.md).
 * Real gallery uploads still go through R2; this only bypasses it for fixtures.
 *
 * Denormalized aggregates (business/member rating, trust score) are NOT typed in
 * by hand here - they're derived by calling the same repo/service the app uses,
 * so this fixture can't drift into a state the app itself would never produce.
 */
const SLUG = "chinar-and-co-grooming-studio";
const OWNER_EMAIL = "imran.wani@chinarco.dev";
const REVIEWER_EMAILS = ["aarav.sharma@example.dev", "zoya.mir@example.dev", "rohit.raina@example.dev"];
const PASSWORD = "DevTest123!";

// Every id below was rendered and eyeballed before being used: Unsplash ids are
// opaque, several plausible-looking ones 404, and a wrong-but-live id silently
// renders an unrelated photo (an early draft of this file put a globe in the
// barber's portfolio). Re-render any id you add here before trusting it.
const IMG = {
  interior: "https://images.unsplash.com/photo-1585747860715-2ba37e788b70?w=1600&q=80", // row of barber chairs
  cutting: "https://images.unsplash.com/photo-1622286342621-4bd786c2447c?w=1600&q=80", // scissor cut in progress
  shave: "https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=1600&q=80", // straight-razor shave, reclined
  shaveMono: "https://images.unsplash.com/photo-1517832606299-7ae9b720a186?w=1600&q=80", // b&w razor to beard
  fade: "https://images.unsplash.com/photo-1599351431202-1e0f0137899a?w=1600&q=80", // faded nape detail
  tools: "https://images.unsplash.com/photo-1621605815971-fbc98d665033?w=1600&q=80", // clippers/scissors flatlay
  clippers: "https://images.unsplash.com/photo-1493256338651-d82f7acb2b38?w=1200&q=80", // clipper work on nape
  razorReclined: "https://images.unsplash.com/photo-1596728325488-58c87691e9af?w=1200&q=80", // razor shave, side view
  curls: "https://images.unsplash.com/photo-1567894340315-735d7c361db0?w=1200&q=80", // working textured curls
  blowDry: "https://images.unsplash.com/photo-1605497788044-5a32c7078486?w=1200&q=80", // blow-dry finish
  colour: "https://images.unsplash.com/photo-1560869713-7d0a29430803?w=800&q=80", // colour/long hair
  oilMassage: "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?w=800&q=80", // warm oil massage
};

const GALLERY = [IMG.interior, IMG.cutting, IMG.shaveMono, IMG.fade, IMG.tools];

const PORTFOLIO = [
  { url: IMG.blowDry, caption: "Blow-dry finish" },
  { url: IMG.clippers, caption: "Skin fade, clipper work" },
  { url: IMG.razorReclined, caption: "Straight-razor shave" },
  { url: IMG.curls, caption: "Textured curls, scissor cut" },
];

// Kashmir trading pattern: a short Friday around Jumma prayers rather than a
// full day, and a late Sunday open instead of the Sunday closure in 06.
const HOURS = [
  { day: 0, open: "11:00", close: "18:00", closed: false },
  { day: 1, open: "10:00", close: "20:00", closed: false },
  { day: 2, open: "10:00", close: "20:00", closed: false },
  { day: 3, open: "10:00", close: "20:00", closed: false },
  { day: 4, open: "10:00", close: "20:00", closed: false },
  { day: 5, open: "14:00", close: "20:00", closed: false },
  { day: 6, open: "10:00", close: "20:00", closed: false },
];

const SERVICES = [
  {
    name: "Signature Hot Towel Shave",
    category: "beard",
    price: 450,
    duration: 45,
    description:
      "A full straight-razor shave finished with Kashmiri walnut-oil balm. Two hot towels, pre-shave oil, and a cold-towel close.",
    image_url: IMG.shave,
  },
  {
    name: "Classic Haircut",
    category: "haircut",
    price: 400,
    duration: 30,
    description: "Consultation, scissor or clipper cut to your preferred length, wash, and a blow-dry finish.",
    image_url: IMG.cutting,
  },
  {
    name: "Skin Fade",
    category: "haircut",
    price: 550,
    duration: 45,
    description: "A precision taper from skin through to your natural length, blended by hand and finished with a razor line-up.",
    image_url: IMG.fade,
  },
  {
    name: "Beard Sculpt & Line-Up",
    category: "beard",
    price: 300,
    duration: 25,
    description: "Shape, trim, and razor line-up to suit your jaw, finished with beard oil.",
    image_url: IMG.shaveMono,
  },
  {
    name: "Grey Blending & Colour",
    category: "hair-color",
    price: 1200,
    duration: 90,
    description: "Ammonia-free colour matched to your natural tone. Patch test required 24 hours before your appointment.",
    image_url: IMG.colour,
  },
  {
    name: "Walnut Oil Head Massage",
    category: "spa",
    price: 600,
    duration: 40,
    description: "A traditional champi with warm Kashmiri walnut oil, working the scalp, neck, and shoulders.",
    image_url: IMG.oilMassage,
  },
];

const REVIEWS = [
  {
    rating: 5,
    title: "Best shave I've had in Srinagar",
    comment:
      "Booked the hot towel shave on a whim and I'll be back every month. Imran takes his time and actually talks you through what he's doing. The walnut oil finish is worth it on its own.",
    daysAgo: 9,
    service: "Signature Hot Towel Shave",
  },
  {
    rating: 5,
    title: "Properly good fade",
    comment:
      "Hard to find someone who can do a clean skin fade here. Came out exactly like the reference photo I brought. Shop is warm, and the kahwa while you wait is a nice touch.",
    daysAgo: 21,
    service: "Skin Fade",
  },
  {
    rating: 4,
    title: "Great cut, ran a little late",
    comment:
      "The cut itself was excellent and the beard line-up was sharp. Docked one star only because my 4pm slot started closer to 4:20. Would still recommend.",
    daysAgo: 34,
    service: "Classic Haircut",
  },
];

const dateNDaysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

const toClock = (minutesFromMidnight) =>
  `${String(Math.floor(minutesFromMidnight / 60)).padStart(2, "0")}:${String(minutesFromMidnight % 60).padStart(2, "0")}`;

export const seed = async (knex) => {
  // Order matters: bookings FK-restrict businesses and users, so the business
  // (and its bookings/reviews, via cascade) must go before the user rows.
  const existing = await knex("businesses").where({ slug: SLUG }).first("id");
  if (existing) {
    await knex("bookings").where({ studio_id: existing.id }).del();
    await knex("businesses").where({ id: existing.id }).del();
  }
  await knex("users").whereIn("email", [OWNER_EMAIL, ...REVIEWER_EMAILS]).del();

  const hashed = await bcrypt.hash(PASSWORD, 10);

  const [owner] = await knex("users")
    .insert({ name: "Imran Wani", email: OWNER_EMAIL, password: hashed, email_verified: true })
    .returning("*");

  const category = await knex("categories").where({ slug: "barbershop", type: "business" }).first();

  const [business] = await knex("businesses")
    .insert({
      name: "Chinar & Co. Grooming Studio",
      slug: SLUG,
      category_id: category?.id ?? null,
      description:
        "A six-chair grooming studio on Boulevard Road, a two-minute walk from the Dal Lake ghats. We do one thing properly: classic barbering — scissor work, skin fades, and straight-razor shaves — using Kashmiri walnut oil in everything we finish with.\n\nThe studio was opened in 2014 by Imran Wani after twelve years behind the chair in Delhi and London. Kahwa is on the house while you wait.",
      address: "Ground Floor, Zaffar Complex, Boulevard Road, Dalgate",
      city: "Srinagar",
      state: "Jammu & Kashmir",
      zip_code: "190001",
      country: "India",
      lat: 34.0836,
      lng: 74.837,
      phone: "+91 194 245 8811",
      email: "hello@chinarco.dev",
      // The customer detail page's HeroGallery renders exactly
      // [banner_url, image_url, logo_url] and does NOT read
      // business_gallery_images (the Phase 1.1 gallery UI is still deferred),
      // so these three must be distinct photos or the hero repeats itself.
      image_url: IMG.interior,
      logo_url: IMG.shave,
      banner_url: IMG.cutting,
      website: "https://chinarco.dev",
      amenities: JSON.stringify([
        "Air conditioning",
        "Heated in winter",
        "Free Wi-Fi",
        "Complimentary kahwa",
        "Street parking",
        "Card & UPI accepted",
      ]),
      languages: JSON.stringify(["Kashmiri", "Urdu", "Hindi", "English"]),
      payment_methods: JSON.stringify(["Cash", "UPI", "Credit card", "Debit card"]),
      accessibility: JSON.stringify(["Step-free entrance", "Ground floor", "Accessible washroom"]),
      social_links: JSON.stringify({
        instagram: "https://instagram.com/chinarco.grooming",
        facebook: "https://facebook.com/chinarco.grooming",
        whatsapp: "https://wa.me/911942458811",
      }),
      policies: JSON.stringify({
        cancellation: "Free cancellation up to 2 hours before your appointment. Inside 2 hours we charge 50% of the service price.",
        rescheduling: "Reschedule free of charge up to 2 hours before your slot, through the app or by calling the studio.",
        refund: "Card and UPI refunds are issued to the original payment method within 5-7 working days.",
        general: "We hold your chair for 10 minutes past your slot. After that we may need to give it to the next booking.",
      }),
      house_rules: JSON.stringify([
        "Please arrive 5 minutes early so we can start on time.",
        "Colour services need a patch test 24 hours in advance.",
        "Children under 12 must be accompanied by an adult.",
      ]),
      approval_status: "approved",
      approved_at: new Date(Date.now() - 400 * 86400000),
      is_active: true,
      business_status: "active",
      onboarding_step: 5,
      created_at: new Date(Date.now() - 420 * 86400000), // ~14mo old: clears the trust score's business-age band
    })
    .returning("*");

  const ownerRole = await knex("roles").where({ key: "owner" }).first();

  const [professional] = await knex("business_members")
    .insert({
      studio_id: business.id,
      user_id: owner.id,
      role_id: ownerRole.id,
      designation: "Master Barber & Founder",
      provides_services: true,
      status: "active",
      experience_years: 12,
      image_url: "https://i.pravatar.cc/400?img=12",
      bio: "I trained in Delhi, spent four years on a Soho shop floor in London, and came home to Srinagar in 2014 to open Chinar & Co. My work is classic barbering — I'd rather spend forty minutes on a shave than rush three. Ask for a consultation first; I'll tell you honestly if a cut won't suit your hair.",
      specialties: JSON.stringify(["Straight-razor shaves", "Skin fades", "Beard sculpting", "Scissor work", "Grey blending"]),
      languages: JSON.stringify(["Kashmiri", "Urdu", "Hindi", "English"]),
      education: JSON.stringify([
        { institution: "London School of Barbering", degree: "Advanced Barbering Diploma", year: "2011" },
        { institution: "Jawed Habib Academy, New Delhi", degree: "Professional Hairdressing", year: "2004" },
      ]),
      awards: JSON.stringify([
        { title: "Best Grooming Studio, Kashmir Hospitality Awards", year: "2023" },
        { title: "Regional Finalist, India Barber Championship", year: "2019" },
      ]),
      social_links: JSON.stringify({
        instagram: "https://instagram.com/imran.cuts",
        website: "https://chinarco.dev",
      }),
      joined_at: new Date(Date.now() - 420 * 86400000),
    })
    .returning("*");

  await knex("working_hours").insert(
    HOURS.map((h) => ({
      studio_id: business.id,
      day_of_week: h.day,
      open_time: h.open,
      close_time: h.close,
      is_closed: h.closed,
    }))
  );

  await knex("business_gallery_images").insert(
    GALLERY.map((url, i) => ({ studio_id: business.id, url, sort_order: i, is_cover: i === 0 }))
  );

  await knex("member_portfolio").insert(
    PORTFOLIO.map((p, i) => ({
      business_member_id: professional.id,
      media_url: p.url,
      thumbnail_url: p.url,
      caption: p.caption,
      sort_order: i,
      is_cover: i === 0,
    }))
  );

  await knex("member_certificates").insert([
    {
      business_member_id: professional.id,
      title: "Advanced Barbering Diploma",
      issuer: "London School of Barbering",
      issued_date: "2011-06-18",
      credential_id: "LSB-2011-4471",
      sort_order: 0,
    },
    {
      business_member_id: professional.id,
      title: "Salon Hygiene & Sanitation Certification",
      issuer: "Beauty & Wellness Sector Skill Council",
      issued_date: "2024-02-09",
      expiry_date: "2027-02-08",
      credential_id: "BWSSC-SH-88213",
      sort_order: 1,
    },
  ]);

  const serviceCategories = await knex("categories").where({ type: "service" }).select("id", "slug");
  const categoryBySlug = new Map(serviceCategories.map((c) => [c.slug, c.id]));

  const services = await knex("services")
    .insert(
      SERVICES.map((s) => ({
        studio_id: business.id,
        name: s.name,
        description: s.description,
        category_id: categoryBySlug.get(s.category),
        price: s.price,
        duration: s.duration,
        image_url: s.image_url,
        is_active: true,
      }))
    )
    .returning("*");

  const serviceByName = new Map(services.map((s) => [s.name, s]));

  await knex("business_members")
    .where({ id: professional.id })
    .update({
      featured_service_ids: JSON.stringify([
        serviceByName.get("Signature Hot Towel Shave").id,
        serviceByName.get("Skin Fade").id,
      ]),
    });

  // Reviews hang off real completed bookings: review.service.js derives
  // studio/professional from the booking rather than trusting free input, so a
  // booking-less review would be a row the app could never have written.
  const reviewers = await knex("users")
    .insert(
      REVIEWER_EMAILS.map((email, i) => ({
        name: ["Aarav Sharma", "Zoya Mir", "Rohit Raina"][i],
        email,
        password: hashed,
        email_verified: true,
      }))
    )
    .returning("*");

  for (const [i, r] of REVIEWS.entries()) {
    const service = serviceByName.get(r.service);
    const reviewer = reviewers[i];
    // Staggered start times so the no-overlap EXCLUDE constraint on
    // (business_member_id, [start,end)) can't trip between fixture bookings.
    const startMinutes = (11 + i * 2) * 60;
    const start = toClock(startMinutes);
    const end = toClock(startMinutes + service.duration);

    const [booking] = await knex("bookings")
      .insert({
        user_id: reviewer.id,
        studio_id: business.id,
        business_member_id: professional.id,
        booking_date: dateNDaysAgo(r.daysAgo),
        start_time: start,
        end_time: end,
        total_amount: service.price,
        total_duration: service.duration,
        status: "completed",
        confirmation_code: `CHNR${String(1001 + i)}`,
        created_at: new Date(Date.now() - (r.daysAgo + 3) * 86400000),
      })
      .returning("*");

    await knex("booking_services").insert({
      booking_id: booking.id,
      service_id: service.id,
      price: service.price,
      duration: service.duration,
    });

    await knex("reviews").insert({
      user_id: reviewer.id,
      booking_id: booking.id,
      studio_id: business.id,
      business_member_id: professional.id,
      rating: r.rating,
      title: r.title,
      comment: r.comment,
      helpful_count: [7, 3, 1][i],
      created_at: new Date(Date.now() - r.daysAgo * 86400000),
    });
  }

  // Approved verification request -> trust.repository.isVerified() -> the
  // "Verified" badge. There's no admin to attribute the decision to in a seed,
  // so reviewed_by stays null.
  await knex("verification_requests").insert({
    business_id: business.id,
    status: "approved",
    eligibility_snapshot: JSON.stringify({ seeded: true, note: "Showcase fixture - not a real verification decision" }),
    applicant_note: "Registered barbershop operating on Boulevard Road since 2014.",
    submitted_at: new Date(Date.now() - 380 * 86400000),
    reviewed_at: new Date(Date.now() - 375 * 86400000),
  });

  // Active ₹99 subscription -> hasActivePremium() -> the "Premium" badge and
  // premium ranking in discovery.
  await knex("business_subscriptions").insert({
    business_id: business.id,
    plan: "monthly",
    amount: 99,
    currency: "INR",
    status: "active",
    current_period_start: new Date(Date.now() - 10 * 86400000),
    current_period_end: new Date(Date.now() + 20 * 86400000),
  });

  // Derive the denormalized aggregates through the real code paths.
  await reviewRepo.recalcBusinessRating(business.id);
  await reviewRepo.recalcMemberRating(professional.id);
  const trust = await recomputeTrustScore(business.id);

  console.log(
    `[seed] J&K showcase ready: "${business.name}" (Srinagar, J&K)\n` +
      `  businessId=${business.id}  slug=${SLUG}\n` +
      `  professional=Imran Wani  memberId=${professional.id}\n` +
      `  owner login: ${OWNER_EMAIL} / ${PASSWORD}\n` +
      `  reviewer login: ${REVIEWER_EMAILS[0]} / ${PASSWORD}\n` +
      `  ${services.length} services, ${GALLERY.length} gallery images, ${REVIEWS.length} reviews, trust score=${trust?.score ?? "?"}`
  );
};

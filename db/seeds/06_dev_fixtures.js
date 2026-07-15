import bcrypt from "bcrypt";

/**
 * Dev-only fixture so Phase 2.1 (booking/payments/availability/working-hours/
 * time-off) is testable end-to-end before business signup and business-member
 * invite flows exist (those are Phase 2.2/2.3 - report.md Phase 2 plan).
 * Creates: 1 customer, 1 business owner, 1 business, working hours, 2 services.
 */
const DEV_CUSTOMER_EMAIL = "test.customer@example.dev";
const DEV_OWNER_EMAIL = "test.owner@example.dev";
const DEV_PASSWORD = "DevTest123!";

const DEFAULT_HOURS = [
  { day: 0, open: null, close: null, closed: true },
  { day: 1, open: "09:00", close: "19:00", closed: false },
  { day: 2, open: "09:00", close: "19:00", closed: false },
  { day: 3, open: "09:00", close: "19:00", closed: false },
  { day: 4, open: "09:00", close: "19:00", closed: false },
  { day: 5, open: "09:00", close: "19:00", closed: false },
  { day: 6, open: "10:00", close: "18:00", closed: false },
];

export const seed = async (knex) => {
  await knex("users").whereIn("email", [DEV_CUSTOMER_EMAIL, DEV_OWNER_EMAIL]).del();
  await knex("businesses").where({ slug: "test-barbershop" }).del();

  const hashed = await bcrypt.hash(DEV_PASSWORD, 10);

  const [customer] = await knex("users")
    .insert({ name: "Dev Customer", email: DEV_CUSTOMER_EMAIL, password: hashed, email_verified: true })
    .returning("*");

  const [owner] = await knex("users")
    .insert({ name: "Dev Owner", email: DEV_OWNER_EMAIL, password: hashed, email_verified: true })
    .returning("*");

  const category = await knex("categories").where({ slug: "barbershop" }).first();

  const [business] = await knex("businesses")
    .insert({
      name: "Test Barbershop",
      slug: "test-barbershop",
      category_id: category?.id || null,
      address: "1 Test Street",
      city: "Testville",
      approval_status: "approved",
      is_active: true,
      business_status: "active", // Phase 1.5a - discovery gates on this now
    })
    .returning("*");

  const ownerRole = await knex("roles").where({ key: "owner" }).first();

  const [businessMember] = await knex("business_members")
    .insert({
      studio_id: business.id,
      user_id: owner.id,
      role_id: ownerRole.id,
      designation: "Owner-Barber",
      provides_services: true,
      status: "active",
    })
    .returning("*");

  await knex("working_hours").insert(
    DEFAULT_HOURS.map((h) => ({
      studio_id: business.id,
      day_of_week: h.day,
      open_time: h.open,
      close_time: h.close,
      is_closed: h.closed,
    }))
  );

  const [haircutCategory, beardCategory] = await Promise.all([
    knex("categories").where({ slug: "haircut", type: "service" }).first(),
    knex("categories").where({ slug: "beard", type: "service" }).first(),
  ]);

  const services = await knex("services")
    .insert([
      { studio_id: business.id, name: "Haircut", category_id: haircutCategory.id, price: 20, duration: 30 },
      { studio_id: business.id, name: "Beard Trim", category_id: beardCategory.id, price: 10, duration: 15 },
    ])
    .returning("*");

  console.log(
    `[seed] Dev fixtures ready: customer=${DEV_CUSTOMER_EMAIL} owner=${DEV_OWNER_EMAIL} password=${DEV_PASSWORD}\n` +
      `  studioId=${business.id} businessMemberId=${businessMember.id}\n` +
      `  services: ${services.map((s) => `${s.name}=${s.id}`).join(", ")}`
  );
};

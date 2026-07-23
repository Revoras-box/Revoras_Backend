import bcrypt from "bcrypt";

// Local dev login only. Password is intentionally plain here for developer
// convenience - never seed this in a real environment. Replaces the wiped
// admin@example.com fixture from the pre-Knex database (report.md §A).
const DEV_ADMIN_EMAIL = "admin@example.com";
const DEV_ADMIN_PASSWORD = "DevAdmin123!";

export const seed = async (knex) => {
  await knex("admins").where({ email: DEV_ADMIN_EMAIL }).del();

  const hashed = await bcrypt.hash(DEV_ADMIN_PASSWORD, 10);

  await knex("admins").insert({
    name: "Super Admin",
    email: DEV_ADMIN_EMAIL,
    password: hashed,
    role: "super_admin",
  });

  console.log(`[seed] Dev admin ready: ${DEV_ADMIN_EMAIL} / ${DEV_ADMIN_PASSWORD}`);
};

// Upsert-by-key, not delete-then-insert - see 01_roles.js for why (same
// RESTRICT-once-referenced problem applies transitively via role_permissions).
export const seed = async (knex) => {
  await knex("permissions")
    .insert([
      { key: "bookings.manage", description: "Create, update, and cancel bookings" },
      { key: "services.manage", description: "Create, update, and remove the service catalog" },
      { key: "team.manage", description: "Invite, edit, and remove business members" },
      { key: "payments.view", description: "View revenue and payment records" },
      { key: "settings.manage", description: "Edit business profile, hours, and settings" },
      { key: "analytics.view", description: "View business analytics/reporting" },
      { key: "offers.manage", description: "Create, update, and remove promotional offers" },
      { key: "reviews.respond", description: "Reply publicly to customer reviews" },
    ])
    .onConflict("key")
    .merge(["description"]);
};

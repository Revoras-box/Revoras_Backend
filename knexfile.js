import dotenv from "dotenv";

dotenv.config({ quiet: true });

/**
 * Knex is the single source of truth for the Revoras schema. There is no
 * runtime schema sync (modelAttributeSync.js was removed) - `npm run db:migrate`
 * is the only thing that creates or changes tables.
 */
const base = {
  client: "pg",
  connection: process.env.DATABASE_URL,
  migrations: {
    directory: "./db/migrations",
    tableName: "knex_migrations",
  },
  seeds: {
    directory: "./db/seeds",
  },
};

export default {
  development: { ...base, debug: process.env.KNEX_DEBUG === "true" },
  test: { ...base, connection: process.env.TEST_DATABASE_URL || base.connection },
  production: {
    ...base,
    pool: { min: 2, max: 10 },
  },
};

import path from "node:path";
import { fileURLToPath } from "node:url";
import knexLib from "knex";
import knexConfig from "../knexfile.js";

/**
 * Opt-in runner for the DEV/DEMO fixtures under `db/seeds/dev/` (test accounts,
 * the Srinagar showcase business, the Bengaluru map cluster).
 *
 * These are deliberately NOT in `db/seeds/`, so the default `npm run db:seed`
 * (and any production seed step) only creates real reference data — roles,
 * permissions, categories. A fresh clone never gets fabricated businesses or
 * users unless someone explicitly runs `npm run db:seed:dev`.
 *
 * Run `npm run db:seed` first: these fixtures reference categories/roles that
 * the system seeds create.
 */
const env = process.env.NODE_ENV || "development";

if (env === "production") {
  console.error("[seed:dev] Refusing to run demo fixtures with NODE_ENV=production.");
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const knex = knexLib(knexConfig[env]);

try {
  const [ran] = await knex.seed.run({ directory: path.join(__dirname, "seeds", "dev") });
  if (ran.length === 0) {
    console.log("[seed:dev] No dev seed files found in db/seeds/dev.");
  } else {
    console.log(`[seed:dev] Ran ${ran.length} dev fixture(s):\n  ${ran.join("\n  ")}`);
  }
} catch (err) {
  console.error("[seed:dev] Failed:", err);
  process.exitCode = 1;
} finally {
  await knex.destroy();
}

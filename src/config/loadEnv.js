import dotenv from "dotenv";
import { assertEnvironmentDeclared } from "./environment.js";

/**
 * Loads and validates the environment as an import side effect. MUST stay the
 * first import in server.js.
 *
 * `dotenv.config()` used to sit in server.js's module body, below the import
 * block. That reads like it runs first, and under CommonJS it would have - but
 * ESM hoists and fully evaluates every import before a single line of the
 * importing module's body executes. So every module in the graph was evaluated
 * with whatever the OS happened to export, and none of `.env` was visible yet.
 *
 * That is invisible for the common case, because most modules only read
 * `process.env` inside a function, by which time the body has run. It bites the
 * ones that read at module level: `utils/logger.js` computes its default level
 * from `NODE_ENV` on evaluation, saw `undefined`, and pinned itself to `debug`
 * regardless of what `.env` said. `knexfile.js` looked exempt only because it
 * calls `dotenv.config()` itself; that is the workaround, not the fix.
 *
 * Validation happens here too, rather than in server.js's body where the other
 * boot assertions live, for the same reason. `db/knex.js` selects its config
 * with `knexfile[process.env.NODE_ENV]` at module scope, so an unrecognised
 * environment is consumed during the import phase and dies inside knex with
 * `TypeError: Cannot read properties of undefined (reading 'client')` - a stack
 * trace that names neither NODE_ENV nor the typo that caused it. An assertion
 * placed after the imports is an assertion that never gets to run. Checking
 * here, before anything else is evaluated, is what turns that into a sentence
 * saying which values are legal.
 *
 * Putting both in their own module makes the ordering a property of the import
 * graph rather than of where a statement sits in a file, so it cannot be broken
 * again by an import-sorting tool moving lines around.
 */
dotenv.config({ quiet: true });
assertEnvironmentDeclared();

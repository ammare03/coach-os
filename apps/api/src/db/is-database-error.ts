import postgres from 'postgres';

/**
 * True for a raw `error instanceof postgres.PostgresError`, or for
 * Drizzle's own `DrizzleQueryError`/`PostgresJsPreparedQuery` wrapping of
 * one — `ctx.db.execute()`/`ctx.db.transaction()` never let the driver's
 * error surface directly; they wrap it with query context (`drizzle-orm`'s
 * `errors.ts`) and set `.cause` to the original, `Error`-instanceof-preserving
 * `getCauseFromUnknown` two layers up in `@trpc/server`. Interfaces:
 * "the Drizzle client from `@coachos/db`, unwrapped" — this is that
 * unwrapping, the one place it happens.
 */
function unwrap(error: unknown): unknown {
  if (error instanceof postgres.PostgresError) {
    return error;
  }
  if (error instanceof Error && error.cause !== undefined) {
    return unwrap(error.cause);
  }
  return error;
}

/**
 * Narrows `unknown` to the shape the Postgres driver actually throws
 * (`CLAUDE.md` §17.1 — `unknown` plus a narrowing guard, never `any`).
 * `postgres.PostgresError` (`packages/db` uses the `postgres` driver, not
 * `pg` — field names are the raw wire protocol's own, `snake_case`:
 * `code`, `constraint_name`, `table_name`, `schema_name`, `detail`,
 * `where`, `internal_query`) is exported as a static property of the
 * driver's default export, so `instanceof` works without a live
 * connection — `error-and-validation/04-no-raw-db-errors.md` step 2's
 * classification reads `.code` (SQLSTATE) only, never `.message`. Looks
 * through Drizzle's wrapping (see `unwrap` above) — a caller that gets
 * `true` back should re-read `unwrapDatabaseError(error)`, not `error`
 * itself, to reach the fields it actually wants.
 */
export function isDatabaseError(error: unknown): boolean {
  return unwrap(error) instanceof postgres.PostgresError;
}

/** The real driver error, looking through any Drizzle wrapping — `undefined` if `isDatabaseError(error)` is false. */
export function unwrapDatabaseError(error: unknown): postgres.PostgresError | undefined {
  const inner = unwrap(error);
  return inner instanceof postgres.PostgresError ? inner : undefined;
}

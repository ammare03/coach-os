// The one shared type every recompute function's signature depends on:
// exactly what `db.transaction(async (tx) => { ... })` (client.ts's
// `DbClient`) passes to its callback. Derived from `DbClient` itself
// rather than hand-typed against `PgTransaction<...>`'s own generics, so
// this can never drift from what Drizzle actually provides.
import type { DbClient } from '../client.ts';

export type Transaction = Parameters<Parameters<DbClient['transaction']>[0]>[0];

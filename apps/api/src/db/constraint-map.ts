import type { AppErrorCode, AppErrorPayloads, EmptyErrorPayload } from '@coachos/schemas';

/**
 * The subset of `AppErrorCode` whose payload is `EmptyErrorPayload` — the
 * only codes `CONSTRAINT_ERROR_MAP` may name (see its own doc comment for
 * why). `[K in AppErrorCode]` rather than a hand-written union: adding a
 * code to the catalogue with a non-empty payload is excluded automatically,
 * and adding one with an empty payload becomes eligible automatically —
 * neither needs a second edit here to stay correct.
 */
export type EmptyPayloadCode = {
  [K in AppErrorCode]: AppErrorPayloads[K] extends EmptyErrorPayload ? K : never;
}[AppErrorCode];

/**
 * Constraint name → the specific product code its violation means, for the
 * codes this **stateless** boundary can translate on its own (step 3). Real
 * names from `packages/db/src/schema/*.ts` — not the plan's illustrative
 * pattern — because each table names its own index differently. Renaming
 * one here without updating this map silently downgrades a friendly
 * product error to `INTERNAL_ERROR`; a test in
 * `../__tests__/db-error-boundary.test.ts` asserts every key here still
 * exists in the live schema.
 *
 * A code belongs here only if its payload (`AppErrorPayloads` in
 * `@coachos/schemas`) needs nothing beyond "this specific constraint
 * fired" — `CLIENT_ALREADY_HAS_COACH` carries no data at all. A code whose
 * payload needs a *value* (`CHECKIN_ALREADY_SUBMITTED`'s `checkinId`) is
 * deliberately absent: the boundary sees only `error.code` and
 * `error.constraint_name` (step 7 forbids reading `.detail`, the one field
 * that would carry it), so it cannot fabricate that value honestly. That
 * translation belongs to the specific resolver's own catch clause, which
 * has the id it just tried to write and can re-query the one it collided
 * with — an unhandled hit here still reaches `fromDatabaseError` and
 * degrades no worse than the generic `UNKNOWN_CONFLICT`.
 *
 * Deliberately not exhaustive over every unique index in the schema — step
 * 3 is explicit that most constraints can only fire on a bug, and adding a
 * code speculatively is a decision, not a default. Add an entry only when
 * a user can reach the violation deliberately, in the same PR as an
 * `api-conventions` §5 update.
 */
export const CONSTRAINT_ERROR_MAP = {
  // A client belongs to exactly one coach at a time — the invite-acceptance
  // refusal (CLAUDE.md §8.1) — identity.ts's own comment on this index.
  client_profiles_one_active_coach: 'CLIENT_ALREADY_HAS_COACH',
} as const satisfies Record<string, EmptyPayloadCode>;

/**
 * The precise, currently-used subset of `EmptyPayloadCode` — narrower than
 * that full type, and widens automatically the moment a new entry is added
 * to `CONSTRAINT_ERROR_MAP` above. `../../lib/app-error.ts`'s `describeCode`
 * switches on this rather than the full `EmptyPayloadCode`, so it only ever
 * needs copy for a code this map can actually produce.
 */
export type MappedConstraintCode = (typeof CONSTRAINT_ERROR_MAP)[keyof typeof CONSTRAINT_ERROR_MAP];

/**
 * Looks up an arbitrary (runtime, not-statically-known) constraint name.
 * The one cast this file needs: `CONSTRAINT_ERROR_MAP`'s own key type is
 * the small literal union of constraints it actually maps, which is what
 * makes `MappedConstraintCode` precise — but `error.constraint_name` off
 * the wire is a plain `string`, so a lookup by it is legitimately a maybe.
 */
export function getMappedConstraintCode(constraint: string): MappedConstraintCode | undefined {
  return (CONSTRAINT_ERROR_MAP as Record<string, MappedConstraintCode | undefined>)[constraint];
}

/**
 * Unique violations on these are the offline-idempotency replay (DB§14.1),
 * not an error — `training.ts` / `nutrition.ts` / `coaching.ts` each name
 * their own `(owner, client_local_id)` index differently, so there is no
 * single suffix to pattern-match. `error-boundary.ts`'s `isReplayViolation()`
 * is the shared primitive a resolver's own catch clause uses to recognise
 * one of these and re-select the row it already wrote (step 4) — the
 * generic boundary has no way to construct that per-table query itself, so
 * an unhandled hit here still reaches `fromDatabaseError`, which maps it to
 * `SYNC_CONFLICT` rather than a bare `INTERNAL_ERROR`: the safe generic
 * fallback for a resolver that has not adopted the upsert or catch pattern
 * yet is "the device should refetch", not a 500.
 */
export const REPLAY_CONSTRAINTS: ReadonlySet<string> = new Set([
  'sessions_client_local', // training.workout_sessions
  'set_logs_client_local', // training.set_logs
  'meals_client_local', // nutrition.meals
  'water_logs_client_id_client_local_id_unique', // nutrition.water_logs
  'messages_local', // coaching.messages
]);

/**
 * The `SYNC_CONFLICT` payload's `entity` value for an unhandled replay
 * violation — a product-domain name, deliberately **not**
 * `error.table_name`. Step 7 is explicit that the raw Postgres table name
 * is "safe to log, never to return"; this is the friendly name that
 * crosses the wire instead. A constraint present in `REPLAY_CONSTRAINTS`
 * but absent here still resolves — `fromDatabaseError` falls back to a
 * generic `'record'` rather than failing — but should get a real entry in
 * the same PR that adds it above.
 */
export const REPLAY_ENTITY_NAMES: Readonly<Record<string, string>> = {
  sessions_client_local: 'workout_session',
  set_logs_client_local: 'set',
  meals_client_local: 'meal',
  water_logs_client_id_client_local_id_unique: 'water_log',
  messages_local: 'message',
};

/**
 * Not an error at all — the at-least-once webhook ledger (DB§17). The
 * duplicate insert on retry is the point, and this table sits behind a
 * plain Hono route (`api-conventions` §9), never a tRPC procedure, so this
 * boundary never actually sees it; documented here anyway so the webhook
 * handler's own upsert has one place to point at rather than a second,
 * silently-drifting copy of the name.
 */
export const IGNORED_CONSTRAINTS: ReadonlySet<string> = new Set([
  'webhook_events_provider_event_unique', // platform.webhook_events
]);

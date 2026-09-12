// The `cause.code` catalogue (CLAUDE.md §6.3, §15.8) — the closed list of
// machine-readable error codes a CoachOS client can ever receive. A union,
// not an enum: a client `switch (code) { ... }` with a case removed fails
// `pnpm check`'s typecheck, which is the whole reason it's shaped this way.
//
// Seeded from `api-conventions` §5's thirteen product codes, plus five
// infrastructure codes `02-error-formatter-and-codes.md` throws and one more
// `04-no-raw-db-errors.md` throws — no product feature sits behind either
// group, which is why they weren't already in the skill. Any code added
// here must be added to that table in the same PR, or the two drift.
export const APP_ERROR_CODES = [
  // api-conventions §5 — product codes
  'SEAT_LIMIT_REACHED',
  'STORAGE_QUOTA_EXCEEDED',
  'LIVE_MINUTES_EXHAUSTED',
  'AI_LIMIT_REACHED',
  'FEATURE_NOT_IN_TIER',
  'NOT_YOUR_CLIENT',
  'MEDIA_STILL_PROCESSING',
  'CHECKIN_ALREADY_SUBMITTED',
  'CLIENT_ALREADY_HAS_COACH',
  'INVITE_EXPIRED',
  // invites/04 — the code is well-formed but doesn't resolve to a row.
  // High-entropy secret, not a resource id (`security-and-privacy` skill's
  // NOT_FOUND-vs-NOT_YOUR_CLIENT distinction is about ids an attacker can
  // enumerate; an 8-char base32 invite code from a 32^8 space is not that),
  // so NOT_FOUND carries no oracle risk here the way it would on an
  // `ownsResource`-guarded id.
  'INVITE_NOT_FOUND',
  // invites/04, invites/05 — two distinct terminal states a code or a
  // revoke attempt can already be in, each needing its own copy
  // ("this invite was already used" reads nothing like "this invite was
  // cancelled").
  'INVITE_ALREADY_ACCEPTED',
  'INVITE_REVOKED',
  'RECORDING_CONSENT_REQUIRED',
  'SYNC_CONFLICT',
  // `phase-09-workout-logger/session-runtime/08` — ERRORS.md ER§1.4.
  // DB§14.5's session claim: another device of this same client is
  // actively logging the session, and the caller asked to take it without
  // saying it meant to. Distinct from SYNC_CONFLICT, which means "refetch,
  // a write raced you" — nothing has diverged here, and the recovery is a
  // decision only the person holding the phone can make ("Continue here"
  // re-calls with `transfer`). Never thrown by `workouts.start`: an
  // outbox-replayed start must never be refused for a claim reason.
  'SESSION_CLAIMED_ELSEWHERE',
  'VALIDATION_FAILED',
  // infrastructure codes — 02
  'AUTH_REQUIRED',
  'ROLE_REQUIRED',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'INTERNAL_ERROR',
  // infrastructure code — 04: a unique violation the constraint map has no
  // specific product code for. Distinct from SYNC_CONFLICT, which means
  // "refetch, a write raced you" — this means "a duplicate the server
  // refused", a different recovery action the client can't merge into.
  'UNKNOWN_CONFLICT',
  // auth-server/04 — refresh rotation. Two codes, deliberately distinct
  // (04's Produces table): a reused token means the session is gone for
  // good (sign out, clear storage); a race means a concurrent refresh from
  // the same device is already in flight (wait and retry once, never sign
  // out). Collapsing the two into one code produces random sign-outs.
  'REFRESH_TOKEN_REUSED',
  'REFRESH_RACE',
  // auth-server/07 — ERRORS.md ER§1.2, verbatim. `AGE_BELOW_MINIMUM` is
  // under-13, both roles. `COACH_MUST_BE_ADULT` is 13-17 attempting a
  // coach/assistant account. `GUARDIAN_CONSENT_REQUIRED`/`_PENDING` are two
  // different moments for a 13-17 client: the first before a consent
  // request has been sent, the second after — collapsing them loses the
  // "resend" recovery action ER§1.2's own table gives only to the second.
  'AGE_BELOW_MINIMUM',
  'COACH_MUST_BE_ADULT',
  'GUARDIAN_CONSENT_REQUIRED',
  'GUARDIAN_CONSENT_PENDING',
  // social-sign-in/03 — a verified Apple/Google identity's email already
  // belongs to an existing `users` row with no link to that provider yet.
  // Never auto-merged (the task's own Risks section); the client tells the
  // person to sign in with their existing method first, then link.
  'SOCIAL_ACCOUNT_EXISTS',
  // social-sign-in/01, /02 — the provider rejected the identity token, or
  // `jwtVerify` did (bad signature, wrong aud/iss, expired, bad nonce).
  // Distinct from `AUTH_REQUIRED`: this is a token the *provider* refused,
  // not a CoachOS session.
  'SOCIAL_TOKEN_INVALID',
  // account-lifecycle/06 — `client.leaveCoach` called with no current
  // coach to leave, or `coach.clients.release` targeting an already-
  // detached client. A caller-state bug the router should have prevented
  // (both check `coachId IS NOT NULL` first), guarded here in case it
  // hasn't.
  'CLIENT_HAS_NO_COACH',
  // account-lifecycle/10 — the export request procedure's two gates. The
  // first is a dedupe signal, not a failure ("here's the one already
  // running"); the second is the 24h-per-completion throttle that never
  // drops below the 30-day legal floor (ERRORS.md ER§1.9a).
  'EXPORT_ALREADY_RUNNING',
  'EXPORT_RATE_LIMITED',
  // account-lifecycle/10 — `me.exportStatus`/`exportHistory` polling a
  // non-existent or another user's `exportId`. `NOT_FOUND` in both cases,
  // same enumeration-oracle reasoning `INVITE_NOT_FOUND` already
  // established, never `FORBIDDEN` (`security-and-privacy` skill §1).
  'EXPORT_NOT_FOUND',
  // account-lifecycle/12 — the guardian export path. Covers every
  // ineligible case in one code (not a client, not a minor, no consent,
  // wrong email, aged out past 18): `NOT_FOUND`, never `FORBIDDEN`, same
  // enumeration-oracle reasoning `EXPORT_NOT_FOUND` already established —
  // a guardian probing ids must not learn *which* condition failed.
  'DEPENDENT_NOT_FOUND',
  // exercise-library/01 — `exercises.get` on an id that names nothing, or
  // names another coach's custom exercise. One code for both, `NOT_FOUND`
  // for both: a distinct "not yours" would confirm the row exists, the same
  // enumeration oracle `NOT_YOUR_CLIENT` and `EXPORT_NOT_FOUND` already
  // close (`security-and-privacy` skill §1).
  'EXERCISE_NOT_FOUND',
  // exercise-library/03 — the coach already has a non-archived exercise
  // with this name. DB§5.2's partial unique index is what refuses it; this
  // is the product's translation of that refusal, carried to the name field
  // rather than to a toast. Not in `CONSTRAINT_ERROR_MAP`: its payload
  // needs the colliding row's id so the form can offer "open the existing
  // one", and the stateless boundary cannot fabricate that (see that map's
  // own doc comment).
  'EXERCISE_NAME_TAKEN',
  // exercise-library/03 — an attempt to edit or archive a GLOBAL
  // (`coach_id IS NULL`) exercise. Every coach's programs reference those
  // rows and no procedure may write one. FORBIDDEN, not NOT_FOUND: the row
  // is not hidden from the caller — `get` and `list` return it happily —
  // so there is no oracle to close, and "you can't edit this" is the true
  // and more useful answer.
  'EXERCISE_NOT_EDITABLE',
  // program-builder/01 — the three refusals a coach can walk into while
  // building the week/day hierarchy, each mapping to one DB§5.2 constraint
  // the builder would otherwise surface as a raw Postgres unique violation.
  // `PROGRAM_WEEK_EXISTS` and `PROGRAM_DAY_TAKEN` are pre-checked in the
  // resolver rather than translated from the constraint name, because both
  // payloads carry the number that collided and the stateless database
  // boundary cannot fabricate that (`../../apps/api/src/db/constraint-map.ts`
  // documents the same rule for `CHECKIN_ALREADY_SUBMITTED`).
  'PROGRAM_WEEK_EXISTS',
  'PROGRAM_DAY_TAKEN',
  // program-builder/01 — the length stepper cannot be driven below the
  // weeks that already exist. Refusing is the only non-destructive answer:
  // the alternative is silently orphaning weeks 9-12 of a twelve-week
  // program the coach has already written.
  'PROGRAM_DURATION_TOO_SHORT',
  // program-builder/01 — "Add week" at the `programs_duration_weeks_check`
  // ceiling. The builder hides the affordance at 104, so this is the
  // server's own floor under a stale client, never the normal path.
  'PROGRAM_WEEK_LIMIT_REACHED',
  // program-builder/02 — "Add exercise" at the day's ceiling. The day
  // screen hides the affordance once the day is full, so this is the
  // server's own floor under a stale client, never the normal path.
  // Exactly the shape `PROGRAM_WEEK_LIMIT_REACHED` above has, and for the
  // same reason.
  'PROGRAM_EXERCISE_LIMIT_REACHED',
  // program-builder/03 — the drop. `reorder` takes the day's COMPLETE new
  // order, so a list that no longer matches the day (a block added or
  // deleted on another device between the read and the drop) is a stale
  // picture, not a malformed request. Distinct from `SYNC_CONFLICT`, whose
  // copy is written for a client whose coach changed something while they
  // were offline, and whose recovery is "showing their version" rather than
  // "refetch and make the move again".
  'PROGRAM_DAY_ORDER_STALE',
  // program-builder/04 — the three ways a superset write can be refused.
  //
  // `PROGRAM_SUPERSET_LIMIT_REACHED` is the alphabet running out:
  // `superset_group` is one uppercase letter (DB§5.2's regex), so a day
  // holds at most 26 groups. A generous ceiling that will not bind in
  // practice — but a ceiling, and hitting it must say so rather than
  // silently doing nothing.
  //
  // `PROGRAM_SUPERSET_NOT_ADJACENT` is the product rule underneath the
  // whole feature: a superset is exercises performed back to back
  // (`CLAUDE.md` §26), so its members must be two or more, consecutive in
  // the day's order, and must stay that way. Thrown by BOTH
  // `setSupersetGroup` (a selection that is short or has a gap in it) and
  // `reorder` (a move that would pull a member out of its group) — one
  // rule, one code, because it is the same sentence either way.
  //
  // `PROGRAM_SUPERSET_STALE` is the letter having been taken, or a named
  // block having been grouped or deleted, since the client last read the
  // day. Same shape and same recovery as `PROGRAM_DAY_ORDER_STALE` —
  // refetch and make the grouping again — and kept separate from it only
  // because the two sentences differ.
  'PROGRAM_SUPERSET_LIMIT_REACHED',
  'PROGRAM_SUPERSET_NOT_ADJACENT',
  'PROGRAM_SUPERSET_STALE',
  // program-builder/05 — a block offered as its own approved swap. The
  // sheet renders the origin exercise dimmed, badged "This one" and
  // without a checkbox, so this is the server's own floor under a stale or
  // patched client, never the normal path.
  //
  // It is the ONLY refusal `setAlternatives` needed a new code for. An id
  // that names nothing, and an id that names another coach's custom
  // exercise, both answer the existing `EXERCISE_NOT_FOUND` — deliberately
  // indistinguishable from each other, because a distinct code for the
  // second would confirm that row exists and hand back the enumeration
  // oracle `exercises.get` and `createProgramExercise` already close
  // (`ERRORS.md` ER§2.1). A count over the ceiling and a list naming one
  // exercise twice are both refused by the schema itself, as
  // `VALIDATION_FAILED`.
  'PROGRAM_ALTERNATIVE_IS_ORIGIN',
  // program-builder/06 — a day copied into a week of a DIFFERENT program.
  // Cross-program duplication is out of that task's scope (it belongs to
  // `program-templates`), and `programs.days.duplicate` names two rows the
  // caller may legitimately own without them belonging together: both
  // `ownsResource` guards can pass on a pair this procedure does not
  // offer to copy. BAD_REQUEST, not NOT_FOUND: both rows are the caller's
  // own and `programs.get` returns each of them happily, so there is no
  // existence to conceal and no oracle to close (`ERRORS.md` ER§2.1's test
  // applied, not skipped). The copy-to sheet lists only the weeks of the
  // program it is already showing, so this is the floor under a stale or
  // patched client, never the normal path.
  'PROGRAM_COPY_CROSS_PROGRAM',
  // assignment/01 — `assignments_one_active`'s partial unique index
  // (`training-schema/03`), translated into a specific code rather than a
  // raw constraint violation. Pre-checked in the resolver so the payload
  // can name the conflicting assignment; the insert's own unique-index
  // violation is the second line of defence for the concurrent-request
  // case (`../../apps/api/src/features/assignments/create-assignment.ts`).
  'CLIENT_ALREADY_HAS_ACTIVE_ASSIGNMENT',
  // `phase-09-workout-logger/account-actions/02` — ERRORS.md ER§1.1. The
  // caller has an open `identity.deletion_requests` row: they asked to
  // leave, the 7-day grace has not elapsed, and the account is winding
  // down. Thrown only by `../../apps/api/src/trpc/middleware/pending-deletion.ts`,
  // and only for the three coaching builders — `me.*` (the cancel and the
  // whole export path) and `auth.*` stay reachable by that placement, which
  // is what makes the state recoverable rather than a lockout (CLAUDE.md
  // §21.3, §21.4).
  'ACCOUNT_PENDING_DELETION',
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

// tRPC's own error-code union, re-declared rather than imported so this
// package's one runtime dependency stays zod (`code-conventions` §1's
// package table — no @trpc/server here). The literal strings must match
// `TRPC_ERROR_CODE_KEY` exactly; `apps/api/src/lib/app-error.ts` passes a
// value of this type straight into `new TRPCError({ code })`, so a typo
// here fails `pnpm check` at that call site rather than surfacing at
// runtime.
export type TRPCErrorCodeName =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'TOO_MANY_REQUESTS'
  | 'PAYLOAD_TOO_LARGE'
  | 'INTERNAL_SERVER_ERROR';

/** Every code's transport mapping — `api-conventions` §5's "tRPC code" column, machine-checked below. */
export const APP_ERROR_TRPC_CODE: Record<AppErrorCode, TRPCErrorCodeName> = {
  SEAT_LIMIT_REACHED: 'BAD_REQUEST',
  STORAGE_QUOTA_EXCEEDED: 'BAD_REQUEST',
  LIVE_MINUTES_EXHAUSTED: 'BAD_REQUEST',
  AI_LIMIT_REACHED: 'BAD_REQUEST',
  FEATURE_NOT_IN_TIER: 'FORBIDDEN',
  // `ERRORS.md` ER§2.1 — NOT_FOUND, never FORBIDDEN: a 403 confirms another
  // coach's row exists, which is an enumeration oracle. Decided 6 Sep 2026.
  NOT_YOUR_CLIENT: 'NOT_FOUND',
  MEDIA_STILL_PROCESSING: 'CONFLICT',
  CHECKIN_ALREADY_SUBMITTED: 'CONFLICT',
  CLIENT_ALREADY_HAS_COACH: 'CONFLICT',
  INVITE_EXPIRED: 'BAD_REQUEST',
  INVITE_NOT_FOUND: 'NOT_FOUND',
  INVITE_ALREADY_ACCEPTED: 'CONFLICT',
  INVITE_REVOKED: 'BAD_REQUEST',
  RECORDING_CONSENT_REQUIRED: 'FORBIDDEN',
  SYNC_CONFLICT: 'CONFLICT',
  SESSION_CLAIMED_ELSEWHERE: 'CONFLICT',
  VALIDATION_FAILED: 'BAD_REQUEST',
  AUTH_REQUIRED: 'UNAUTHORIZED',
  ROLE_REQUIRED: 'FORBIDDEN',
  RATE_LIMITED: 'TOO_MANY_REQUESTS',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  INTERNAL_ERROR: 'INTERNAL_SERVER_ERROR',
  UNKNOWN_CONFLICT: 'CONFLICT',
  REFRESH_TOKEN_REUSED: 'UNAUTHORIZED',
  REFRESH_RACE: 'CONFLICT',
  AGE_BELOW_MINIMUM: 'FORBIDDEN',
  COACH_MUST_BE_ADULT: 'FORBIDDEN',
  GUARDIAN_CONSENT_REQUIRED: 'FORBIDDEN',
  GUARDIAN_CONSENT_PENDING: 'FORBIDDEN',
  SOCIAL_ACCOUNT_EXISTS: 'CONFLICT',
  SOCIAL_TOKEN_INVALID: 'UNAUTHORIZED',
  CLIENT_HAS_NO_COACH: 'CONFLICT',
  EXPORT_ALREADY_RUNNING: 'BAD_REQUEST',
  EXPORT_RATE_LIMITED: 'TOO_MANY_REQUESTS',
  EXPORT_NOT_FOUND: 'NOT_FOUND',
  DEPENDENT_NOT_FOUND: 'NOT_FOUND',
  EXERCISE_NOT_FOUND: 'NOT_FOUND',
  EXERCISE_NAME_TAKEN: 'CONFLICT',
  EXERCISE_NOT_EDITABLE: 'FORBIDDEN',
  PROGRAM_WEEK_EXISTS: 'CONFLICT',
  PROGRAM_DAY_TAKEN: 'CONFLICT',
  PROGRAM_DURATION_TOO_SHORT: 'BAD_REQUEST',
  PROGRAM_WEEK_LIMIT_REACHED: 'BAD_REQUEST',
  PROGRAM_EXERCISE_LIMIT_REACHED: 'BAD_REQUEST',
  PROGRAM_DAY_ORDER_STALE: 'CONFLICT',
  PROGRAM_SUPERSET_LIMIT_REACHED: 'BAD_REQUEST',
  PROGRAM_SUPERSET_NOT_ADJACENT: 'BAD_REQUEST',
  PROGRAM_SUPERSET_STALE: 'CONFLICT',
  PROGRAM_ALTERNATIVE_IS_ORIGIN: 'BAD_REQUEST',
  PROGRAM_COPY_CROSS_PROGRAM: 'BAD_REQUEST',
  CLIENT_ALREADY_HAS_ACTIVE_ASSIGNMENT: 'CONFLICT',
  ACCOUNT_PENDING_DELETION: 'FORBIDDEN',
};

/**
 * The empty payload — DB§18: a code whose only useful signal is which code
 * it is. `NOT_YOUR_CLIENT` carries this and nothing else (02's step 2):
 * naming the id that failed would hand back the oracle
 * `../authorization-middleware/03-owns-resource.md` closed.
 */
export type EmptyErrorPayload = Record<string, never>;

/**
 * Per-code payload shapes. DB§18 governs every field here: counts, limits,
 * ids, and statuses (🟢 operational) are allowed; a name, an email, a food
 * name, an injury note, or a media URL is never allowed in an error
 * payload — it is a log line and a Sentry event waiting to happen (02's
 * step 2 and its Risks section).
 */
export interface AppErrorPayloads {
  SEAT_LIMIT_REACHED: { seatsUsed: number; seatLimit: number };
  STORAGE_QUOTA_EXCEEDED: { usedBytes: number; limitBytes: number };
  LIVE_MINUTES_EXHAUSTED: { minutesUsed: number; minutesLimit: number };
  AI_LIMIT_REACHED: { generationsUsed: number; generationsLimit: number };
  FEATURE_NOT_IN_TIER: { feature: string; requiredTier: string };
  NOT_YOUR_CLIENT: EmptyErrorPayload;
  MEDIA_STILL_PROCESSING: { mediaAssetId: string };
  CHECKIN_ALREADY_SUBMITTED: { checkinId: string };
  CLIENT_ALREADY_HAS_COACH: EmptyErrorPayload;
  INVITE_EXPIRED: { expiredAt: string };
  INVITE_NOT_FOUND: EmptyErrorPayload;
  INVITE_ALREADY_ACCEPTED: EmptyErrorPayload;
  INVITE_REVOKED: EmptyErrorPayload;
  RECORDING_CONSENT_REQUIRED: EmptyErrorPayload;
  SYNC_CONFLICT: { entity: string };
  // Nothing about the holding device crosses the wire — not its id, not
  // its name, not when it claimed. The client's only decision is whether
  // to continue here, and ERRORS.md ER§1.4's copy asks exactly that
  // without any of it. A device id would also be a stable identifier for
  // hardware the client may no longer own.
  SESSION_CLAIMED_ELSEWHERE: EmptyErrorPayload;
  VALIDATION_FAILED: { fields: Record<string, string> };
  AUTH_REQUIRED: EmptyErrorPayload;
  ROLE_REQUIRED: { requiredRole: string };
  RATE_LIMITED: { retryAfterSeconds: number };
  PAYLOAD_TOO_LARGE: { maxBytes: number };
  INTERNAL_ERROR: EmptyErrorPayload;
  // No constraint name, table, or column — DB§18: that's exactly the
  // disclosure this code exists to avoid (04's step 7).
  UNKNOWN_CONFLICT: EmptyErrorPayload;
  REFRESH_TOKEN_REUSED: EmptyErrorPayload;
  REFRESH_RACE: EmptyErrorPayload;
  AGE_BELOW_MINIMUM: EmptyErrorPayload;
  COACH_MUST_BE_ADULT: EmptyErrorPayload;
  GUARDIAN_CONSENT_REQUIRED: EmptyErrorPayload;
  GUARDIAN_CONSENT_PENDING: EmptyErrorPayload;
  // `provider` only — which one collided, so the client can render "sign in
  // to link Google" without tracking that across the request itself. Never
  // the colliding email (DB§18) — the client already knows it, it just sent it.
  SOCIAL_ACCOUNT_EXISTS: { provider: 'apple' | 'google' };
  SOCIAL_TOKEN_INVALID: EmptyErrorPayload;
  CLIENT_HAS_NO_COACH: EmptyErrorPayload;
  // The in-flight request's own id and status — enough for the client to
  // point "View status" at it without a second round trip. `status` is
  // typed as the full `export_status` enum, not narrowed to
  // `'queued' | 'building'`, because the value flows straight from a
  // `platform.export_requests` row select — narrowing it here would need a
  // cast at the one call site that constructs this payload
  // (`../../apps/api/src/services/export/request.ts`) for a guarantee this
  // type can't itself enforce; the WHERE clause that produced the row is
  // what actually guarantees it's one of the two in-flight values.
  EXPORT_ALREADY_RUNNING: {
    exportId: string;
    status: 'queued' | 'building' | 'ready' | 'failed' | 'expired';
  };
  // Never the raw completion timestamp — `retryAfterSeconds` is what
  // `RATE_LIMITED` already uses, and ER§1.9a's copy computes "days
  // remaining" from it client-side rather than the server formatting a
  // sentence into a payload field.
  EXPORT_RATE_LIMITED: { retryAfterSeconds: number };
  EXPORT_NOT_FOUND: EmptyErrorPayload;
  DEPENDENT_NOT_FOUND: EmptyErrorPayload;
  // No id echoed back — naming the exercise that "wasn't found" would let a
  // caller distinguish a bad id from another coach's id one probe at a time.
  EXERCISE_NOT_FOUND: EmptyErrorPayload;
  // The id only — never the name. The client already has the name (it just
  // sent it), and DB§18 keeps user-authored text out of error payloads.
  EXERCISE_NAME_TAKEN: { existingExerciseId: string };
  EXERCISE_NOT_EDITABLE: EmptyErrorPayload;
  // The colliding number, never the colliding row's name — DB§18 keeps
  // coach-authored text out of error payloads, and the number is what the
  // copy needs anyway ("Week 3 already exists").
  PROGRAM_WEEK_EXISTS: { weekNumber: number };
  PROGRAM_DAY_TAKEN: { dayNumber: number };
  // How many weeks are actually written, so the stepper can clamp itself to
  // the truth rather than re-fetching to find out.
  PROGRAM_DURATION_TOO_SHORT: { weekCount: number };
  PROGRAM_WEEK_LIMIT_REACHED: { maxWeeks: number };
  PROGRAM_EXERCISE_LIMIT_REACHED: { maxExercises: number };
  // How many blocks the day actually holds, so the client can decide
  // whether its own list is short or long without a second round trip.
  // Numbers only, never a name or an id (DB§18).
  PROGRAM_DAY_ORDER_STALE: { exerciseCount: number };
  // The alphabet's own length, so the copy reads the ceiling from the
  // server rather than restating 26 on the device.
  PROGRAM_SUPERSET_LIMIT_REACHED: { maxGroups: number };
  // How many blocks the call named. Numbers only — never the superset
  // letter and never a block id (DB§18).
  PROGRAM_SUPERSET_NOT_ADJACENT: { exerciseCount: number };
  // How many groups the day actually holds now, which is what a client
  // with a stale picture is wrong about.
  PROGRAM_SUPERSET_STALE: { groupCount: number };
  // Nothing to carry. The client already knows which block it is editing
  // and which exercise that block is — echoing either back would add a
  // second, copyable statement of the same id for no recovery value, and
  // DB§18's rule is that a payload carries only what the copy needs.
  PROGRAM_ALTERNATIVE_IS_ORIGIN: EmptyErrorPayload;
  PROGRAM_COPY_CROSS_PROGRAM: EmptyErrorPayload;
  // The one place this catalogue's usual "never a name in a payload" rule
  // (`EXERCISE_NAME_TAKEN`'s own comment) doesn't apply: a program's name
  // is coach-authored organisational text, not DB§18-classified sensitive
  // data, and — unlike `EXERCISE_NAME_TAKEN`, where the caller already sent
  // the colliding name — the coach assigning a NEW program has no way to
  // already know what the client's EXISTING one is called. The sheet's
  // conflict card (`assignment/01`) needs all four fields to render "on
  // {programName}, week {currentWeek} of {durationWeeks}" without a second
  // round trip.
  CLIENT_ALREADY_HAS_ACTIVE_ASSIGNMENT: {
    assignmentId: string;
    programName: string;
    currentWeek: number;
    durationWeeks: number;
  };
  // Nothing to carry, deliberately. The purge date is a field of `me.get`
  // (`deletionScheduledFor`), rendered by the pending screen in the user's
  // own timezone — a date formatted into an error payload would be a second
  // statement of the same fact, in the server's timezone, that the client
  // would then have to reconcile with the first.
  ACCOUNT_PENDING_DELETION: EmptyErrorPayload;
}

/**
 * True for every code except `INTERNAL_ERROR`. `INTERNAL_ERROR` is the one
 * code nobody throws deliberately — the formatter (`../trpc/error-formatter.ts`)
 * assigns it only when redacting an error nothing else caught, so it is the
 * whole of the "unexpected" bucket by construction. Every other code was
 * thrown on purpose via `appError()`: a refusal the product designed for,
 * not a crash. `../observability/02-sentry-server.md` uses this one
 * definition to decide whether a rejection should also consume Sentry's 5k
 * errors/month free tier (CLAUDE.md §3.4.3) — it should not, for a coach
 * hitting their seat limit.
 */
export function isExpectedAppErrorCode(code: AppErrorCode): boolean {
  return code !== 'INTERNAL_ERROR';
}

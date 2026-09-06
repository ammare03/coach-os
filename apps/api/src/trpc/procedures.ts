// The one place procedure builders are imported from — never `init.ts` directly.
import { databaseErrorBoundary } from '../db/error-boundary.ts';

import { publicProcedure as basePublicProcedure } from './init.ts';
import { guardianConsentGate } from './middleware/guardian-consent.ts';
import { coachOrClientRole, hasRole } from './middleware/has-role.ts';
import { isAuthed } from './middleware/is-authed.ts';
import { isOperatorMiddleware } from './middleware/is-operator.ts';
import { RATE_LIMIT_TIERS } from './middleware/rate-limit-config.ts';
import { authRateLimit, rateLimit } from './middleware/rate-limit.ts';
import { requestContext } from './middleware/request-context.ts';
import { requestLogging } from './middleware/request-logging.ts';

// `05-request-correlation.md` step 2: `requestContext` is the true
// outermost middleware, ahead of `requestLogging` itself — it binds
// `ctx.requestId` to async-local storage so `requestLogging`'s own log line,
// and every logger/Sentry call for the rest of the request, pick it up
// without `ctx` being threaded down to them.
//
// `01-structured-logging.md`: `requestLogging` next, ahead of
// `databaseErrorBoundary` — its `durationMs` and `statusCode` are only
// meaningful if they cover a database retry and a rate-limit rejection too,
// not just whatever ran after it.
//
// `04-no-raw-db-errors.md` step 1: `databaseErrorBoundary` next, before auth
// and rate limiting, attached here — the one place every procedure builder
// derives from — so no procedure can be written without it, structurally
// rather than by habit. `rateLimit` with no `route` keys by the current
// tRPC path (`rate-limit.ts`'s `RateLimitConfig.route` doc comment) —
// CLAUDE.md §6.5's 600/min "everything else" row, applied to every
// procedure in the tree by construction rather than by an author
// remembering to opt in (`03-per-route-config-and-429-handling.md`'s whole
// point: an unconfigured procedure must never be silently unlimited).
export const publicProcedure = basePublicProcedure
  .use(requestContext)
  .use(requestLogging)
  .use(databaseErrorBoundary)
  .use(rateLimit(RATE_LIMIT_TIERS.default));

// The dedicated, whole-group `auth.*` throttle (`rate-limit.ts`'s
// `authRateLimit` doc comment) — `phase-03-identity-and-auth/auth-server/`
// builds `signIn` / `signUp` / `requestReset` / `resetPassword` on this,
// never on `publicProcedure` directly, or CLAUDE.md §6.5's `auth.*` row
// never actually applies. `refresh` is the one exception — it is rate
// limited per refresh-token family instead (`04`, `rate-limit.ts`'s
// `authRateLimit` doc comment) and is built directly on `publicProcedure`.
export const authProcedure = publicProcedure.use(authRateLimit(RATE_LIMIT_TIERS.auth));

// `01-is-authed.md`: narrows `ctx.user` to non-null at the type level. A
// resolver built on this can dereference `ctx.user` with no optional chain
// and no `!` — removing `.use(isAuthed)` here makes every one of them fail
// typecheck, not just fail at runtime.
export const protectedProcedure = publicProcedure.use(isAuthed);

// `02-has-role.md`. `coachProcedure` / `clientProcedure` narrow
// `ctx.user.role` and assert the matching profile id is a non-null string,
// the other one `null`. `coachOrClientProcedure` accepts either real role
// and leaves the union un-narrowed — `workouts.logSet`, `comments.create`,
// and the other genuinely-shared procedures branch on `ctx.user.role`
// themselves. None of the three ever admits `role: 'assistant'`
// (`phase-25-white-label-and-teams/team-seats-and-roles/` is what teaches
// them to).
//
// `guardian-consent/03`: `clientProcedure` and `coachOrClientProcedure` —
// everything that constitutes *coaching* — additionally pass through
// `guardianConsentGate`, after `hasRole`, never before. A caller whose role
// is wrong must get `ROLE_REQUIRED`, not a consent error naming a guardian:
// the second leaks a fact about someone else's account to whoever's session
// is making the call.
//
// The three builders deliberately left ungated, each for a reason that is
// load-bearing rather than an oversight:
//
// - `publicProcedure` / `authProcedure` — CLAUDE.md §21.5 requires that a
//   minor without consent can still sign in and be told why, so
//   `auth.signIn`, `auth.refresh` and `auth.signOut` must keep working.
// - `protectedProcedure` — this is what keeps `me.get` reachable, and
//   `me.get` is what `06`'s pending screen renders from. It also keeps
//   `me.requestDeletion` / `me.cancelDeletion` reachable: §21.4's three-tap
//   deletion is a store requirement and must not depend on a parent
//   clicking a link. **`04`'s `invites.resendGuardianConsent` must
//   therefore be built on `protectedProcedure`, not `clientProcedure`** — a
//   resend the blocked account cannot call is the exact bug that turns a
//   stalled consent into a dead account.
// - `coachProcedure` — a minor coach is structurally impossible
//   (`users_minor_is_client`), and `requireProfileId` rejects the role
//   mismatch first regardless. Gating it would be a redundant check, and a
//   redundant check invites the next reader to think the constraint is
//   advisory.
export const coachProcedure = protectedProcedure.use(hasRole('coach'));
export const clientProcedure = protectedProcedure.use(hasRole('client')).use(guardianConsentGate);
export const coachOrClientProcedure = protectedProcedure
  .use(coachOrClientRole)
  .use(guardianConsentGate);

// `account-lifecycle/12` — SUPPORT.md SU§2's admin gate: `users.internal_
// operator`, direct-DB-access only, never set by any application surface.
// Every procedure built on this belongs in the authorisation enumeration
// test's allowlist with a stated reason (SU§2's own rule).
export const operatorProcedure = protectedProcedure.use(isOperatorMiddleware);

// `03-owns-resource.md`: re-exported here so a router file imports every
// guard from the same module as its procedure builders, never from
// `./middleware/owns-resource.ts` directly. Must be chained after
// `.input(schema)` — chained before, the selector receives `unknown`
// (`api-scaffold/04`'s router README documents the required order).
export { ownsResource } from './middleware/owns-resource.ts';

// `03-per-route-config-and-429-handling.md`: the three named-procedure
// tiers (`media.createUploadUrl`, `nutrition.searchFood`,
// `comments.create`) aren't a shared base builder like `authProcedure` —
// each is one specific procedure on an otherwise-ordinary router, chained
// with `.use(rateLimit(RATE_LIMIT_TIERS.mediaCreateUploadUrl))` (etc.) at
// the point the owning phase actually builds it. Re-exported here, next to
// `rateLimit`, so that phase never reaches into `./middleware/` directly.
export { rateLimit } from './middleware/rate-limit.ts';
export { RATE_LIMIT_TIERS } from './middleware/rate-limit-config.ts';

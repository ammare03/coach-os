// The one place procedure builders are imported from — never `init.ts` directly.
import { databaseErrorBoundary } from '../db/error-boundary.ts';

import { publicProcedure as basePublicProcedure } from './init.ts';
import { coachOrClientRole, hasRole } from './middleware/has-role.ts';
import { isAuthed } from './middleware/is-authed.ts';
import { RATE_LIMIT_TIERS } from './middleware/rate-limit-config.ts';
import { authRateLimit, rateLimit } from './middleware/rate-limit.ts';

// `04-no-raw-db-errors.md` step 1: outermost, before auth and rate
// limiting, attached here — the one place every procedure builder derives
// from — so no procedure can be written without it, structurally rather
// than by habit. `rateLimit` with no `route` keys by the current tRPC path
// (`rate-limit.ts`'s `RateLimitConfig.route` doc comment) — CLAUDE.md
// §6.5's 600/min "everything else" row, applied to every procedure in the
// tree by construction rather than by an author remembering to opt in
// (`03-per-route-config-and-429-handling.md`'s whole point: an unconfigured
// procedure must never be silently unlimited).
export const publicProcedure = basePublicProcedure
  .use(databaseErrorBoundary)
  .use(rateLimit(RATE_LIMIT_TIERS.default));

// The dedicated, whole-group `auth.*` throttle (`rate-limit.ts`'s
// `authRateLimit` doc comment) — `phase-03-identity-and-auth/auth-server/`
// builds `signIn` / `signUp` / `refresh` on this, never on `publicProcedure`
// directly, or CLAUDE.md §6.5's `auth.*` row never actually applies.
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
export const coachProcedure = protectedProcedure.use(hasRole('coach'));
export const clientProcedure = protectedProcedure.use(hasRole('client'));
export const coachOrClientProcedure = protectedProcedure.use(coachOrClientRole);

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

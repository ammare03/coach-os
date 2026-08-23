// The one place procedure builders are imported from — never `init.ts` directly.
import { databaseErrorBoundary } from '../db/error-boundary.ts';

import { publicProcedure as basePublicProcedure } from './init.ts';
import { coachOrClientRole, hasRole } from './middleware/has-role.ts';
import { isAuthed } from './middleware/is-authed.ts';

// `04-no-raw-db-errors.md` step 1: outermost, before auth and rate
// limiting, attached here — the one place every procedure builder derives
// from — so no procedure can be written without it, structurally rather
// than by habit.
export const publicProcedure = basePublicProcedure.use(databaseErrorBoundary);

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

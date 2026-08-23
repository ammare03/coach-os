// The one place procedure builders are imported from — never `init.ts` directly.
// `coachProcedure` / `clientProcedure` arrive in `../authorization-middleware/02-has-role.md`.
import { databaseErrorBoundary } from '../db/error-boundary.ts';

import { publicProcedure as basePublicProcedure } from './init.ts';
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

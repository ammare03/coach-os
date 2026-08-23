// The one place procedure builders are imported from — never `init.ts` directly.
// `protectedProcedure` is a synonym for `publicProcedure` until
// `../authorization-middleware/01-is-authed.md` attaches the real auth check.
// `coachProcedure` / `clientProcedure` arrive in `../authorization-middleware/02-has-role.md`.
import { databaseErrorBoundary } from '../db/error-boundary.ts';

import { publicProcedure as basePublicProcedure } from './init.ts';

// `04-no-raw-db-errors.md` step 1: outermost, before auth and rate
// limiting, attached here — the one place every procedure builder derives
// from — so no procedure can be written without it, structurally rather
// than by habit.
export const publicProcedure = basePublicProcedure.use(databaseErrorBoundary);
export const protectedProcedure = publicProcedure;

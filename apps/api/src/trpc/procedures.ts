// The one place procedure builders are imported from — never `init.ts` directly.
// `protectedProcedure` is a synonym for `publicProcedure` until
// `../authorization-middleware/01-is-authed.md` attaches the real auth check.
// `coachProcedure` / `clientProcedure` arrive in `../authorization-middleware/02-has-role.md`.
import { publicProcedure } from './init.ts';

export { publicProcedure };
export const protectedProcedure = publicProcedure;

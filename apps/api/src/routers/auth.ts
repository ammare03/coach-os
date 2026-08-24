import { router } from '../trpc/init.ts';

// Filled by phase-03-identity-and-auth (auth-server). Registered empty now
// so the tree's shape is visible from api-scaffold onward.
//
// Every procedure here (signIn, signUp, refresh, ...) must derive from
// `authProcedure` (`../trpc/procedures.ts`), never bare `publicProcedure` —
// that's what applies CLAUDE.md §6.5's 10/15min/IP throttle, shared across
// the whole group (`rate-limiting/03-per-route-config-and-429-handling.md`).
export const authRouter = router({});

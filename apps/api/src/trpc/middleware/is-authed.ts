import { appError } from '../../lib/app-error.ts';
import { middleware } from '../init.ts';

// The one place a `null` user becomes `UNAUTHORIZED` (`01-is-authed.md`).
// Reads `ctx.user` only — the context factory already resolved it this
// request, so a second lookup here would double the most-executed query in
// the system. No resolver may repeat this check inline (CLAUDE.md §6.2):
// that pattern is dead code when this middleware is attached, and it's what
// lets someone attach the resolver to `publicProcedure` and believe it's
// still guarded.
//
// One code for all five collapse cases `../context.ts`'s factory folds into
// `user: null` (missing header, malformed header, bad signature, expired
// token, dead user) — a more specific code would hand an attacker an oracle
// distinguishing "once valid" from "nonsense". The client's answer is to
// attempt one silent refresh on `AUTH_REQUIRED`
// (`phase-03-identity-and-auth/auth-client/03-silent-refresh-and-replay.md`),
// not to branch on a server hint.
export const isAuthed = middleware(({ ctx, next }) => {
  if (!ctx.user) {
    throw appError('AUTH_REQUIRED', 'Sign in to continue.', {});
  }

  // `ctx.user` is narrowed to non-null above; spreading it back into the
  // returned ctx is what lets tRPC infer `AuthenticatedContext` downstream
  // with no cast.
  return next({ ctx: { ...ctx, user: ctx.user } });
});

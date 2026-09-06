import { appError } from '../../lib/app-error.ts';
import { logger } from '../../lib/logger.ts';
import { middleware } from '../init.ts';

// ER§1.2's copy, verbatim. It names the *guardian* as the party being
// waited on, never the client: the minor did nothing wrong and cannot fix
// this themselves, so "you are not allowed" would be both untrue and the
// no-shame rule broken (`COPY.md` §CO1).
const GUARDIAN_CONSENT_PENDING_MESSAGE =
  "We're waiting on your guardian's confirmation. We'll email you when it's done.";

/**
 * The consent block (`guardian-consent/03`). A 13–17 client whose guardian
 * has not confirmed can sign in, see an explanation, and do nothing else
 * (CLAUDE.md §21.5).
 *
 * Attached in `../procedures.ts` to `clientProcedure` and
 * `coachOrClientProcedure` and to nothing else — that placement, not a
 * maintained list of exempt paths, is what keeps `me.get`, account
 * deletion, `auth.refresh`, and `auth.signOut` reachable.
 *
 * The predicate reads `users`, never `client_profiles.status`: `'paused'`
 * and `'archived'` are ordinary coaching states with their own meanings,
 * and `users.guardian_consent_at` is already the source of truth
 * `services/export/delegated.ts` and `jobs/send-export-ready-email.ts` use
 * for this same fact. It also means an account whose `is_minor` the daily
 * `jobs/age-sweep.ts` cleared on an 18th birthday is unblocked at once,
 * with no consent row ever written.
 */
export const guardianConsentGate = middleware(({ ctx, next, path }) => {
  const { user } = ctx;
  if (!user) {
    // Unreachable in practice — `isAuthed` and `hasRole` both ran first.
    // Present because `middleware()` types `ctx.user` as nullable, and the
    // narrowing has to happen in this scope (`has-role.ts`'s own note).
    throw appError('AUTH_REQUIRED', 'Sign in to continue.', {});
  }

  if (user.isMinor && user.guardianConsentAt === null) {
    // `info`, not `error`: this is an expected state, not a fault. It gets
    // no threshold and no alert, and the `FORBIDDEN` transport code keeps
    // it out of Sentry too — `../error-formatter.ts` reports only
    // `INTERNAL_ERROR`. The one reason to record it at all is that a
    // support ticket reading "my client can't do anything" is then
    // answerable from the logs (`observability-ops` §5).
    logger.info('guardian_consent.blocked', {
      requestId: ctx.requestId,
      userId: user.id,
      procedure: path,
    });
    throw appError('GUARDIAN_CONSENT_PENDING', GUARDIAN_CONSENT_PENDING_MESSAGE, {});
  }

  return next();
});

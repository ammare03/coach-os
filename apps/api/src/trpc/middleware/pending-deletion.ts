import { appError } from '../../lib/app-error.ts';
import { logger } from '../../lib/logger.ts';
import { middleware } from '../init.ts';

// ER§1.1's copy, verbatim. It names the recovery, not the refusal: this is
// a state the person chose and can undo in one tap for seven days, so
// nothing here may read as a punishment (`COPY.md` §CO6's no-shame rule).
// No date is interpolated — the purge instant is `me.get`'s
// `deletionScheduledFor`, which the pending screen renders in the user's
// own timezone rather than the server's.
const ACCOUNT_PENDING_DELETION_MESSAGE =
  'This account is scheduled for deletion. Restore it to keep using CoachOS.';

/**
 * The grace-period block (`phase-09-workout-logger/account-actions/02`).
 * A coach or client who has asked to delete their account spends the §21.4
 * seven days in a blocking state with exactly three exits — Restore, Export
 * your data, Sign out — rather than half-coaching clients who are about to
 * be detached (that task's Risks: "gating on the client only" means a
 * patched app or a second device keeps working for a week).
 *
 * Attached in `../procedures.ts` to `coachProcedure`, `clientProcedure` and
 * `coachOrClientProcedure`, and to nothing else. **That placement, not a
 * maintained list of exempt paths, is the allowlist.** It is what keeps
 * `me.get` (the pending screen reads from it), `me.cancelDeletion` (the
 * Restore), the four `me.*` export procedures (§21.3: data export is
 * ethically non-negotiable and explicitly available during the grace
 * period, `account-lifecycle/10`), and `auth.refresh` / `auth.signOut`
 * reachable. Moving it onto `protectedProcedure` would take all six away
 * from the one person entitled to them.
 *
 * Ordered after `hasRole` and before `guardianConsentGate`: after, because a
 * caller whose role is wrong must get `ROLE_REQUIRED` rather than a
 * statement about an account's lifecycle (`guardian-consent.ts` established
 * that rule); before, because a pending deletion is the state the caller
 * themselves created and can act on, and it is the truer thing to say about
 * an account that is going away.
 *
 * The predicate reads `ctx.user`, which `../context.ts` resolves from the
 * `deletion_requests` row on the same query as the `users` row — never a
 * token claim, so a Restore takes effect on the very next call rather than
 * up to fifteen minutes later. `../../features/me/request-deletion.ts` and
 * `cancel-deletion.ts` clear the session cache for the same reason.
 */
export const pendingDeletionGate = middleware(({ ctx, next, path }) => {
  const { user } = ctx;
  if (!user) {
    // Unreachable in practice — `isAuthed` and `hasRole` both ran first.
    // Present because `middleware()` types `ctx.user` as nullable, and the
    // narrowing has to happen in this scope (`has-role.ts`'s own note).
    throw appError('AUTH_REQUIRED', 'Sign in to continue.', {});
  }

  if (user.deletionScheduledFor !== null) {
    // `info`, not `error`: an expected state, not a fault. It gets no
    // threshold and no alert, and the `FORBIDDEN` transport code keeps it
    // out of Sentry too — `../error-formatter.ts` reports only
    // `INTERNAL_ERROR`, which matters here more than for most codes because
    // a single account in this state emits one of these per call for seven
    // days. The one reason to record it at all is that a support ticket
    // reading "the app stopped working" is then answerable from the logs
    // (`observability-ops` §5). Never the purge date — a timestamp is not
    // on `logger.ts`'s field allowlist, and the id is enough to find the
    // row.
    logger.info('pending_deletion.blocked', {
      requestId: ctx.requestId,
      userId: user.id,
      procedure: path,
    });
    throw appError('ACCOUNT_PENDING_DELETION', ACCOUNT_PENDING_DELETION_MESSAGE, {});
  }

  return next();
});

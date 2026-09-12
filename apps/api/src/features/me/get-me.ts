import { schema, type DbClient, type User } from '@coachos/db';
import { maskEmail } from '@coachos/utils';
import { eq } from 'drizzle-orm';

/**
 * The shared `identity.users` fields every role has (`account-lifecycle/01`
 * Scope) — role-specific fields live on `coach_profiles`/`client_profiles`
 * and are returned by their own routers, never here. `Pick<User, ...>`
 * rather than a hand-written shape, per `code-conventions` §3.
 */
export type MeProfile = Pick<
  User,
  | 'id'
  | 'email'
  | 'name'
  | 'avatarAssetId'
  | 'role'
  | 'timezone'
  | 'locale'
  | 'onboardingCompletedAt'
  | 'createdAt'
  // `account-lifecycle/08` — display only, needed here so a settings
  // screen has something to read before it can call `updatePreferences`.
  | 'weightUnit'
  // `guardian-consent/06` — the two the pending screen renders from.
  // Widened here rather than added as an `invites.getGuardianConsentStatus`
  // procedure: that would be a second round trip for two fields this query
  // already has the row for, and `me.get` is the one call
  // `guardian-consent/03`'s gate deliberately leaves reachable.
  | 'isMinor'
  | 'guardianConsentAt'
> & {
  /**
   * `j•••@gmail.com`, or `null` for anyone with no guardian on file.
   *
   * A derived field rather than a `Pick`, because `users.guardian_email`
   * itself must never reach the device: it is a third party's personal data
   * (§21.1 Personal) belonging to someone who is not a CoachOS user, and a
   * response carrying it would let a patched client read it back out. The
   * mask is applied here, server-side, by `@coachos/utils`.
   */
  guardianEmailMasked: string | null;

  /**
   * `identity.deletion_requests.scheduled_purge_at`, or `null` when nothing
   * is pending — the read side `account-lifecycle/03` never built
   * (`account-actions/02`: "the app cannot show a grace period it cannot
   * see").
   *
   * The instant, not a formatted sentence: the pending screen renders it in
   * `users.timezone`, the same timezone `send-deletion-recovery-email.ts`
   * already uses, and a server-formatted string would be in the server's.
   *
   * Read through a left join rather than from `ctx.user`, for the same
   * reason this function re-reads the `users` row at all — `me.get` is a
   * query against current truth, not a projection of a context object built
   * earlier in the same request.
   */
  deletionScheduledFor: Date | null;
};

const ME_PROFILE_COLUMNS = {
  id: schema.users.id,
  email: schema.users.email,
  name: schema.users.name,
  avatarAssetId: schema.users.avatarAssetId,
  role: schema.users.role,
  timezone: schema.users.timezone,
  locale: schema.users.locale,
  onboardingCompletedAt: schema.users.onboardingCompletedAt,
  createdAt: schema.users.createdAt,
  weightUnit: schema.users.weightUnit,
  isMinor: schema.users.isMinor,
  guardianConsentAt: schema.users.guardianConsentAt,
  // Selected, masked below, and never returned raw — see `MeProfile`.
  guardianEmail: schema.users.guardianEmail,
} as const;

/**
 * `ME_PROFILE_COLUMNS` plus the one column that is not on `users`. Kept
 * separate because `update-me.ts` uses `ME_PROFILE_COLUMNS` as an
 * `UPDATE ... RETURNING` projection, and a RETURNING clause cannot name a
 * joined table.
 */
const ME_PROFILE_JOINED_COLUMNS = {
  ...ME_PROFILE_COLUMNS,
  deletionScheduledFor: schema.deletionRequests.scheduledPurgeAt,
} as const;

/**
 * `ctx.user` (`../../trpc/context.ts`) only carries the five
 * authorization-relevant fields — `name`, `avatarAssetId`, and
 * `onboardingCompletedAt` aren't among them, so `me.get` re-reads the row
 * rather than returning `ctx.user` directly.
 */
export async function getMe(db: DbClient, userId: string): Promise<MeProfile> {
  const [row] = await db
    .select(ME_PROFILE_JOINED_COLUMNS)
    .from(schema.users)
    // `deletion_requests.user_id` is that table's primary key, so this can
    // never fan the row out. One join rather than a second query, the same
    // shape `../../trpc/context.ts`'s `resolveUser` uses for the same field.
    .leftJoin(schema.deletionRequests, eq(schema.deletionRequests.userId, schema.users.id))
    .where(eq(schema.users.id, userId))
    .limit(1);

  // `ctx.user` was resolved from this same row moments earlier by the
  // `isAuthed` chain (`../../trpc/middleware/is-authed.ts`) — a miss here
  // means the row vanished between context creation and this query, an
  // unreachable race in practice, so this throws rather than fabricating a
  // fallback.
  if (!row) {
    throw new Error(`me.get: authenticated user ${userId} row not found`);
  }
  const { deletionScheduledFor, ...userColumns } = row;
  return toMeProfile(userColumns, deletionScheduledFor);
}

/** The row shape `ME_PROFILE_JOINED_COLUMNS` selects — one column wider than what leaves the API. */
type MeProfileRow = Omit<MeProfile, 'guardianEmailMasked'> & { guardianEmail: string | null };

/**
 * The one conversion from row to response, shared with `update-me.ts` so
 * neither can return the raw address by accident.
 *
 * `guardianEmail` is destructured out by name rather than deleted after the
 * fact: the omission is then structural, and a future field added to
 * `ME_PROFILE_COLUMNS` cannot ride along through a spread that was written
 * before it existed.
 */
export function toMeProfile(
  row: Omit<MeProfileRow, 'deletionScheduledFor'>,
  deletionScheduledFor: Date | null,
): MeProfile {
  const { guardianEmail, ...profile } = row;
  return {
    ...profile,
    guardianEmailMasked: guardianEmail === null ? null : maskEmail(guardianEmail),
    deletionScheduledFor,
  };
}

/**
 * The one column of `me.get`'s output that does not live on `users`, read on
 * its own for `update-me.ts` — which returns from an `UPDATE ... RETURNING`
 * and therefore cannot join. A primary-key lookup on a table that holds at
 * most one row per user, on an infrequent mutation.
 */
export async function readDeletionScheduledFor(db: DbClient, userId: string): Promise<Date | null> {
  const [row] = await db
    .select({ scheduledPurgeAt: schema.deletionRequests.scheduledPurgeAt })
    .from(schema.deletionRequests)
    .where(eq(schema.deletionRequests.userId, userId))
    .limit(1);
  return row?.scheduledPurgeAt ?? null;
}

export { ME_PROFILE_COLUMNS };

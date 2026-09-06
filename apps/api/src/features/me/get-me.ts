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
 * `ctx.user` (`../../trpc/context.ts`) only carries the five
 * authorization-relevant fields — `name`, `avatarAssetId`, and
 * `onboardingCompletedAt` aren't among them, so `me.get` re-reads the row
 * rather than returning `ctx.user` directly.
 */
export async function getMe(db: DbClient, userId: string): Promise<MeProfile> {
  const [row] = await db
    .select(ME_PROFILE_COLUMNS)
    .from(schema.users)
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
  return toMeProfile(row);
}

/** The row shape `ME_PROFILE_COLUMNS` selects — one column wider than what leaves the API. */
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
export function toMeProfile(row: MeProfileRow): MeProfile {
  const { guardianEmail, ...profile } = row;
  return {
    ...profile,
    guardianEmailMasked: guardianEmail === null ? null : maskEmail(guardianEmail),
  };
}

export { ME_PROFILE_COLUMNS };

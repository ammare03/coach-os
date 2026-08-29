import { schema, type DbClient, type User } from '@coachos/db';
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
>;

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
  return row;
}

export { ME_PROFILE_COLUMNS };

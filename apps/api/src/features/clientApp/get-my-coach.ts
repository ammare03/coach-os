// `client-onboarding/01` — "does the signed-in client currently have a
// coach, and who is it?"
//
// It exists because nothing else answers that question. `me.get` returns
// `identity.users` columns only, and the access token carries `role` and
// nothing more — so the invite route could not tell a client who already
// has a coach (refuse) from one who has left theirs (offer acceptance)
// without this. `clientApp.ts`'s header reserved the `coach` name for P06;
// this is P06 filling it in.
//
// No `ownsResource`: the client profile is addressed by
// `ctx.user.clientProfileId` and never by caller input, the same reasoning
// `leaveCoach` states one file over.
import {
  schema,
  type ClientProfile,
  type CoachProfile,
  type DbClient,
  type User,
} from '@coachos/db';
import { and, eq, isNull } from 'drizzle-orm';

/**
 * Inferred from the schema, never hand-written (`code-conventions` §3):
 * `id` and `businessName` are the coach profile's, `name` is the joined
 * user row's. `id` is `coach_profiles.id`, not the coach's `users.id` —
 * the id every coach-scoped resource is keyed on. `businessName` is null
 * until the coach fills it in at their own onboarding (`coach-onboarding/02`).
 *
 * The four sharing columns are `relationship-controls/03`'s widening, and
 * they are here rather than on `me.get` for the reason this file's own
 * header gives: `get-me.ts` returns `identity.users` columns only, and all
 * four are `client_profiles` columns. **Settings → What {coach} can see**
 * therefore reads one query and has no waterfall (`UI-UX.md` §UX8) — the
 * coach's name and the client's current setting arrive together, so the
 * screen never draws a control claiming a state it does not yet know.
 *
 * `historySharingChoice` is the display half and `history_shared_from` the
 * enforcement half; see the column's own comment in `schema/identity.ts`
 * for why both exist.
 */
export type MyCoach = Pick<CoachProfile, 'id' | 'businessName'> &
  Pick<User, 'name'> &
  Pick<
    ClientProfile,
    'historySharingChoice' | 'historySharedFrom' | 'metricsSharedFrom' | 'nutritionSharedFrom'
  >;

export async function getMyCoach(db: DbClient, clientProfileId: string): Promise<MyCoach | null> {
  const [row] = await db
    .select({
      id: schema.coachProfiles.id,
      name: schema.users.name,
      businessName: schema.coachProfiles.businessName,
      historySharingChoice: schema.clientProfiles.historySharingChoice,
      historySharedFrom: schema.clientProfiles.historySharedFrom,
      metricsSharedFrom: schema.clientProfiles.metricsSharedFrom,
      nutritionSharedFrom: schema.clientProfiles.nutritionSharedFrom,
    })
    .from(schema.clientProfiles)
    // An INNER join, so a coachless client (`coach_id IS NULL`, the
    // detached state `account-lifecycle/06` introduced) yields no row and
    // this returns null — which is exactly the answer.
    .innerJoin(schema.coachProfiles, eq(schema.coachProfiles.id, schema.clientProfiles.coachId))
    .innerJoin(schema.users, eq(schema.users.id, schema.coachProfiles.userId))
    .where(
      and(eq(schema.clientProfiles.id, clientProfileId), isNull(schema.clientProfiles.deletedAt)),
    )
    .limit(1);

  return row ?? null;
}

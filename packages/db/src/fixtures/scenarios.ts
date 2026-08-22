// Pre-composed common arrangements, built from `builders.ts`'s functions —
// not a second, independent implementation. Add a new scenario here only
// when it's clearly reusable across multiple future test files, per this
// task's own Risks section; a one-off arrangement belongs in the test file
// that needs it, built directly from the builders.
import type { ClientProfile, CoachProfile, User } from '../types.ts';

import { createClient, createCoach, createComment, createWorkoutSession } from './builders.ts';
import type { DbOrTx } from './builders.ts';

export type TwoCoachesWithClients = {
  coachA: { user: User; coachProfile: CoachProfile };
  clientA: { user: User; clientProfile: ClientProfile };
  coachB: { user: User; coachProfile: CoachProfile };
  clientB: { user: User; clientProfile: ClientProfile };
};

/**
 * The single most important fixture in the entire product (README.md):
 * two independent coaches, each with their own client, so a test can
 * assert coach A's token cannot read coach B's client data. Exists
 * specifically for `phase-02-api-foundation/authorization-middleware/04`'s
 * enumeration test — every procedure that takes a `clientId` gets run
 * against this fixture to confirm `ownsResource` actually rejects
 * cross-coach access, not merely compiles.
 */
export async function twoCoachesWithClients(db: DbOrTx): Promise<TwoCoachesWithClients> {
  const coachA = await createCoach(db);
  const clientA = await createClient(db, coachA.coachProfile.id);
  const coachB = await createCoach(db);
  const clientB = await createClient(db, coachB.coachProfile.id);

  return { coachA, clientA, coachB, clientB };
}

export type OneCoachFullSetup = {
  coach: { user: User; coachProfile: CoachProfile };
  client: { user: User; clientProfile: ClientProfile };
  session: Awaited<ReturnType<typeof createWorkoutSession>>;
  comment: Awaited<ReturnType<typeof createComment>>;
};

/**
 * One coach, one client, one workout session, one comment on it — a
 * minimal but genuinely connected graph for tests that need something to
 * read back (a dashboard query, a comment-thread query) rather than an
 * authorization boundary. Not "the full DB§21 dataset in miniature" — just
 * enough rows for one thing to point at another.
 */
export async function oneCoachFullSetup(db: DbOrTx): Promise<OneCoachFullSetup> {
  const coach = await createCoach(db);
  const client = await createClient(db, coach.coachProfile.id);
  const session = await createWorkoutSession(db, client.clientProfile.id, coach.coachProfile.id);
  const comment = await createComment(db, client.clientProfile.id, coach.user.id, {
    targetType: 'workout_session',
    targetId: session.id,
  });

  return { coach, client, session, comment };
}

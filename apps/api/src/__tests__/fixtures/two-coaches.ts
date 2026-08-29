// The shared fixture `03-owns-resource.md`'s Files table names: two coaches,
// each with a client, each client with one row of every seeded registry
// kind — plus a second client on coach A, for the "same coach, different
// client" row of the matrix. Every later authorization test in the plan
// tree imports this rather than re-seeding its own.
import { schema, type DbClient } from '@coachos/db';
import { generateInviteCode } from '@coachos/utils';

interface ClientFixture {
  userId: string;
  profileId: string;
  workoutSessionId: string;
  setLogId: string;
  mealId: string;
  mediaAssetId: string;
  commentId: string;
  checkinId: string;
  liveSessionId: string;
}

interface CoachFixture {
  userId: string;
  profileId: string;
  programId: string;
  inviteId: string;
}

export interface TwoCoachesFixture {
  coachA: CoachFixture & { coachNoteId: string };
  clientA1: ClientFixture;
  clientA2: ClientFixture;
  coachB: CoachFixture & { coachNoteId: string };
  clientB1: ClientFixture;
}

async function insertUser(
  db: DbClient,
  role: 'coach' | 'client',
  emailLocal: string,
): Promise<string> {
  const [row] = await db
    .insert(schema.users)
    .values({
      email: `${emailLocal}@two-coaches-fixture.com`,
      passwordHash: 'x',
      name: 'Fixture',
      role,
    })
    .returning({ id: schema.users.id });
  if (!row) throw new Error('seed insert into users did not return a row');
  return row.id;
}

async function insertCoach(db: DbClient, emailLocal: string): Promise<CoachFixture> {
  const userId = await insertUser(db, 'coach', emailLocal);
  const [profile] = await db
    .insert(schema.coachProfiles)
    .values({ userId })
    .returning({ id: schema.coachProfiles.id });
  if (!profile) throw new Error('seed insert into coach_profiles did not return a row');

  const [program] = await db
    .insert(schema.programs)
    .values({ coachId: profile.id, name: 'Fixture Program', durationWeeks: 4 })
    .returning({ id: schema.programs.id });
  if (!program) throw new Error('seed insert into programs did not return a row');

  const [invite] = await db
    .insert(schema.invites)
    .values({
      coachId: profile.id,
      email: `${emailLocal}-invite@two-coaches-fixture.com`,
      code: generateInviteCode(),
    })
    .returning({ id: schema.invites.id });
  if (!invite) throw new Error('seed insert into invites did not return a row');

  return { userId, profileId: profile.id, programId: program.id, inviteId: invite.id };
}

async function insertClient(
  db: DbClient,
  coachProfileId: string,
  emailLocal: string,
): Promise<ClientFixture> {
  const userId = await insertUser(db, 'client', emailLocal);
  const [profile] = await db
    .insert(schema.clientProfiles)
    .values({ userId, coachId: coachProfileId, status: 'active', activatedAt: new Date() })
    .returning({ id: schema.clientProfiles.id });
  if (!profile) throw new Error('seed insert into client_profiles did not return a row');
  const clientProfileId = profile.id;

  const [session] = await db
    .insert(schema.workoutSessions)
    .values({
      clientId: clientProfileId,
      coachId: coachProfileId,
      scheduledDate: '2026-08-01',
      status: 'scheduled',
    })
    .returning({ id: schema.workoutSessions.id });
  if (!session) throw new Error('seed insert into workout_sessions did not return a row');

  const [exercise] = await db
    .insert(schema.exercises)
    .values({
      name: `Fixture Exercise ${emailLocal}`,
      primaryMuscle: 'quads',
      equipment: 'barbell',
      movementPattern: 'squat',
    })
    .returning({ id: schema.exercises.id });
  if (!exercise) throw new Error('seed insert into exercises did not return a row');

  const [setLog] = await db
    .insert(schema.setLogs)
    .values({
      workoutSessionId: session.id,
      exerciseId: exercise.id,
      clientId: clientProfileId,
      setNumber: 1,
      reps: 5,
      clientLocalId: `fixture-${emailLocal}-set-1`,
    })
    .returning({ id: schema.setLogs.id });
  if (!setLog) throw new Error('seed insert into set_logs did not return a row');

  const [meal] = await db
    .insert(schema.meals)
    .values({
      clientId: clientProfileId,
      coachId: coachProfileId,
      loggedDate: '2026-08-01',
      mealType: 'breakfast',
      clientLocalId: `fixture-${emailLocal}-meal-1`,
    })
    .returning({ id: schema.meals.id });
  if (!meal) throw new Error('seed insert into meals did not return a row');

  const [media] = await db
    .insert(schema.mediaAssets)
    .values({
      ownerUserId: userId,
      coachId: coachProfileId,
      clientId: clientProfileId,
      kind: 'video',
      storageKey: `fixture/${emailLocal}/video-1`,
      mimeType: 'video/mp4',
      sizeBytes: 1024,
    })
    .returning({ id: schema.mediaAssets.id });
  if (!media) throw new Error('seed insert into media_assets did not return a row');

  const [comment] = await db
    .insert(schema.comments)
    .values({
      authorUserId: userId,
      targetType: 'workout_session',
      targetId: session.id,
      clientId: clientProfileId,
      body: 'Fixture comment',
    })
    .returning({ id: schema.comments.id });
  if (!comment) throw new Error('seed insert into comments did not return a row');

  const [checkin] = await db
    .insert(schema.checkins)
    .values({
      clientId: clientProfileId,
      coachId: coachProfileId,
      templateSnapshot: {},
      periodStart: '2026-08-01',
      periodEnd: '2026-08-07',
    })
    .returning({ id: schema.checkins.id });
  if (!checkin) throw new Error('seed insert into checkins did not return a row');

  const [live] = await db
    .insert(schema.liveSessions)
    .values({
      coachId: coachProfileId,
      clientId: clientProfileId,
      roomName: `fixture-${emailLocal}-room`,
      kind: 'checkin_call',
    })
    .returning({ id: schema.liveSessions.id });
  if (!live) throw new Error('seed insert into live_sessions did not return a row');

  return {
    userId,
    profileId: clientProfileId,
    workoutSessionId: session.id,
    setLogId: setLog.id,
    mealId: meal.id,
    mediaAssetId: media.id,
    commentId: comment.id,
    checkinId: checkin.id,
    liveSessionId: live.id,
  };
}

async function insertCoachNote(
  db: DbClient,
  coachProfileId: string,
  clientProfileId: string,
  body: string,
): Promise<string> {
  const [note] = await db
    .insert(schema.coachClientNotes)
    .values({ coachId: coachProfileId, clientId: clientProfileId, body })
    .returning({ id: schema.coachClientNotes.id });
  if (!note) throw new Error('seed insert into coach_client_notes did not return a row');
  return note.id;
}

export async function createTwoCoachesFixture(db: DbClient): Promise<TwoCoachesFixture> {
  const coachA = await insertCoach(db, 'coach-a');
  const clientA1 = await insertClient(db, coachA.profileId, 'client-a1');
  const clientA2 = await insertClient(db, coachA.profileId, 'client-a2');
  const coachB = await insertCoach(db, 'coach-b');
  const clientB1 = await insertClient(db, coachB.profileId, 'client-b1');

  const coachNoteAId = await insertCoachNote(
    db,
    coachA.profileId,
    clientA1.profileId,
    'Fixture note A',
  );
  const coachNoteBId = await insertCoachNote(
    db,
    coachB.profileId,
    clientB1.profileId,
    'Fixture note B',
  );

  return {
    coachA: { ...coachA, coachNoteId: coachNoteAId },
    clientA1,
    clientA2,
    coachB: { ...coachB, coachNoteId: coachNoteBId },
    clientB1,
  };
}

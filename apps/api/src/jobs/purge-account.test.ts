// Real Postgres (`testing` skill §4) — DB§19.2's exact claim is that the
// cascade chain reaches every table it names; that can only be proven
// against a real foreign-key graph, never a mocked Drizzle client. This is
// `account-lifecycle/04`'s own required Verification: a full fixture user
// with data across every schema this project has built, purged, then
// asserted to leave zero rows behind.
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { and, desc, eq } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type { purgeAccount as PurgeAccount } from './purge-account.ts';

// R2 has no real bucket in tests — stubbed at the boundary so this suite
// proves *what* would be deleted (the exact keys) without needing live
// credentials, same reasoning as `../features/invites/create-invite.test.ts`'s
// `sendEmail` mock.
const deleteR2Objects = jest.fn().mockResolvedValue(undefined);
jest.mock('../lib/storage/r2-client.ts', () => ({
  deleteR2Objects: (keys: string[]) => deleteR2Objects(keys),
}));

let pgContainer: StartedTestContainer;
let db: DbClient;
let purgeAccount: typeof PurgeAccount;

beforeAll(async () => {
  pgContainer = await new GenericContainer('postgres:16')
    .withEnvironment({
      POSTGRES_USER: 'coachos',
      POSTGRES_PASSWORD: 'coachos',
      POSTGRES_DB: 'coachos',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
    .start();

  process.env.DATABASE_URL = `postgres://coachos:coachos@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/coachos`; // secret-scan-ignore — well-known local dev credential

  const migrateScript = path.join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'packages',
    'db',
    'src',
    'migrate.ts',
  );
  execFileSync(process.execPath, ['--experimental-strip-types', migrateScript], {
    env: { ...process.env },
    stdio: 'inherit',
  });

  db = createDbClient({ connectionString: process.env.DATABASE_URL, sslMode: false });
  ({ purgeAccount } = await import('./purge-account.ts'));
}, 60_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
});

beforeEach(() => {
  deleteR2Objects.mockClear();
});

// ---------------------------------------------------------------------------
// Minimal local fixture builders — one insert per table DB§19.2 names.
// Deliberately not `packages/db/src/fixtures` (unused by any test today and
// not wired into this package's module resolution) — same self-contained
// pattern every other `apps/api` test file already uses.
// ---------------------------------------------------------------------------

let seq = 0;
function unique(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}-${randomUUID()}`;
}

async function insertCoach() {
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `${unique('coach')}@purge-test.com`,
      passwordHash: 'fixture-hash',
      name: 'Fixture Coach',
      role: 'coach',
      timezone: 'UTC',
      emailVerifiedAt: new Date(),
    })
    .returning();
  if (!user) throw new Error('insertCoach: users insert returned no row');
  const [coachProfile] = await db
    .insert(schema.coachProfiles)
    .values({ userId: user.id })
    .returning();
  if (!coachProfile) throw new Error('insertCoach: coach_profiles insert returned no row');
  return { user, coachProfile };
}

async function insertClient(coachId: string) {
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `${unique('client')}@purge-test.com`,
      passwordHash: 'fixture-hash',
      name: 'Fixture Client',
      role: 'client',
      timezone: 'UTC',
      emailVerifiedAt: new Date(),
    })
    .returning();
  if (!user) throw new Error('insertClient: users insert returned no row');
  const [clientProfile] = await db
    .insert(schema.clientProfiles)
    .values({ userId: user.id, coachId })
    .returning();
  if (!clientProfile) throw new Error('insertClient: client_profiles insert returned no row');
  return { user, clientProfile };
}

async function insertExercise(coachId: string | null) {
  const [row] = await db
    .insert(schema.exercises)
    .values({
      coachId,
      name: unique('Exercise'),
      primaryMuscle: 'chest',
      equipment: 'barbell',
      movementPattern: 'push',
    })
    .returning();
  if (!row) throw new Error('insertExercise: no row returned');
  return row;
}

async function insertProgram(coachId: string) {
  const [row] = await db
    .insert(schema.programs)
    .values({ coachId, name: unique('Program'), durationWeeks: 8 })
    .returning();
  if (!row) throw new Error('insertProgram: no row returned');
  return row;
}

async function insertWorkoutSession(clientId: string, coachId: string) {
  const [row] = await db
    .insert(schema.workoutSessions)
    .values({ clientId, coachId, scheduledDate: '2026-01-05' })
    .returning();
  if (!row) throw new Error('insertWorkoutSession: no row returned');
  return row;
}

async function insertSetLog(workoutSessionId: string, exerciseId: string, clientId: string) {
  const [row] = await db
    .insert(schema.setLogs)
    .values({
      workoutSessionId,
      exerciseId,
      clientId,
      setNumber: 1,
      reps: 5,
      weightKg: '100',
      clientLocalId: randomUUID(),
    })
    .returning();
  if (!row) throw new Error('insertSetLog: no row returned');
  return row;
}

async function insertPersonalRecord(clientId: string, exerciseId: string) {
  const [row] = await db
    .insert(schema.personalRecords)
    .values({
      clientId,
      exerciseId,
      recordType: 'max_weight',
      value: '100',
      achievedAt: new Date(),
    })
    .returning();
  if (!row) throw new Error('insertPersonalRecord: no row returned');
  return row;
}

async function insertFood(
  createdByUserId: string | null,
  overrides: Partial<typeof schema.foods.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.foods)
    .values({
      source: 'client',
      createdByUserId,
      name: unique('Food'),
      caloriesPer100g: '150',
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('insertFood: no row returned');
  return row;
}

async function insertMeal(clientId: string, coachId: string) {
  const [row] = await db
    .insert(schema.meals)
    .values({
      clientId,
      coachId,
      loggedDate: '2026-01-05',
      mealType: 'breakfast',
      clientLocalId: randomUUID(),
    })
    .returning();
  if (!row) throw new Error('insertMeal: no row returned');
  return row;
}

async function insertMealItem(mealId: string, foodId: string) {
  const [row] = await db
    .insert(schema.mealItems)
    .values({ mealId, foodId, quantityG: '100', calories: '150' })
    .returning();
  if (!row) throw new Error('insertMealItem: no row returned');
  return row;
}

async function insertWaterLog(clientId: string) {
  await db.insert(schema.waterLogs).values({
    clientId,
    loggedDate: '2026-01-05',
    amountMl: 500,
    clientLocalId: randomUUID(),
  });
}

async function insertDailyNutritionSummary(clientId: string) {
  await db.insert(schema.dailyNutritionSummary).values({ clientId, date: '2026-01-05' });
}

async function insertCheckinTemplate(coachId: string) {
  const [row] = await db
    .insert(schema.checkinTemplates)
    .values({ coachId, name: unique('Template'), fields: [] })
    .returning();
  if (!row) throw new Error('insertCheckinTemplate: no row returned');
  return row;
}

async function insertCheckin(clientId: string, coachId: string, templateId: string) {
  const [row] = await db
    .insert(schema.checkins)
    .values({
      clientId,
      coachId,
      templateId,
      templateSnapshot: [],
      periodStart: '2026-01-01',
      periodEnd: '2026-01-07',
    })
    .returning();
  if (!row) throw new Error('insertCheckin: no row returned');
  return row;
}

async function insertBodyMetric(clientId: string) {
  const [row] = await db
    .insert(schema.bodyMetrics)
    .values({ clientId, recordedAt: new Date(), recordedDate: '2026-01-05', weightKg: '80' })
    .returning();
  if (!row) throw new Error('insertBodyMetric: no row returned');
  return row;
}

async function insertMediaAsset(
  ownerUserId: string,
  coachId: string | null,
  clientId: string | null,
) {
  const [row] = await db
    .insert(schema.mediaAssets)
    .values({
      ownerUserId,
      coachId,
      clientId,
      kind: 'video',
      storageKey: `media/${unique('key')}.mp4`,
      thumbnailKey: `media/${unique('thumb')}.jpg`,
      mimeType: 'video/mp4',
      sizeBytes: 1024,
    })
    .returning();
  if (!row) throw new Error('insertMediaAsset: no row returned');
  return row;
}

async function insertProgressPhoto(clientId: string, assetId: string) {
  await db.insert(schema.progressPhotos).values({
    clientId,
    assetId,
    angle: 'front',
    takenAt: new Date(),
  });
}

async function insertComment(clientId: string, authorUserId: string) {
  const [row] = await db
    .insert(schema.comments)
    .values({
      authorUserId,
      clientId,
      targetType: 'workout_session',
      targetId: randomUUID(),
      body: 'Fixture comment',
    })
    .returning();
  if (!row) throw new Error('insertComment: no row returned');
  return row;
}

async function insertReaction(userId: string) {
  await db.insert(schema.reactions).values({
    userId,
    targetType: 'workout_session',
    targetId: randomUUID(),
    emoji: '💪',
  });
}

async function insertHabit(clientId: string, coachId: string) {
  const [row] = await db
    .insert(schema.habits)
    .values({ clientId, coachId, name: unique('Habit') })
    .returning();
  if (!row) throw new Error('insertHabit: no row returned');
  return row;
}

async function insertHabitLog(habitId: string) {
  await db.insert(schema.habitLogs).values({ habitId, date: '2026-01-05' });
}

async function insertConversation(coachId: string, clientId: string) {
  const [row] = await db.insert(schema.conversations).values({ coachId, clientId }).returning();
  if (!row) throw new Error('insertConversation: no row returned');
  return row;
}

async function insertMessage(conversationId: string, senderUserId: string) {
  await db.insert(schema.messages).values({
    conversationId,
    senderUserId,
    body: 'hi',
    clientLocalId: randomUUID(),
  });
}

async function insertLiveSession(coachId: string, clientId: string) {
  const [row] = await db
    .insert(schema.liveSessions)
    .values({ coachId, clientId, roomName: unique('room'), kind: 'checkin_call' })
    .returning();
  if (!row) throw new Error('insertLiveSession: no row returned');
  return row;
}

async function insertLiveSessionParticipant(liveSessionId: string, userId: string) {
  await db.insert(schema.liveSessionParticipants).values({ liveSessionId, userId });
}

async function insertDevice(userId: string) {
  const [row] = await db.insert(schema.devices).values({ userId, platform: 'ios' }).returning();
  if (!row) throw new Error('insertDevice: no row returned');
  return row;
}

async function insertAuthProvider(userId: string) {
  await db.insert(schema.authProviders).values({
    userId,
    provider: 'apple',
    providerUid: unique('apple-uid'),
  });
}

async function insertRefreshToken(userId: string) {
  await db.insert(schema.refreshTokens).values({
    userId,
    tokenHash: unique('token-hash'),
    familyId: randomUUID(),
    expiresAt: new Date(Date.now() + 60_000),
  });
}

async function insertCoachClientNote(coachId: string, clientId: string) {
  await db.insert(schema.coachClientNotes).values({ coachId, clientId, body: 'note' });
}

async function insertInvite(coachId: string) {
  await db.insert(schema.invites).values({
    coachId,
    email: `${unique('invitee')}@purge-test.com`,
    code: unique('CODE').slice(0, 8).toUpperCase(),
  });
}

async function countRows(table: PgTable): Promise<number> {
  const rows = await db.select().from(table);
  return rows.length;
}

// ---------------------------------------------------------------------------

describe('purgeAccount', () => {
  it("purges a client's entire history, leaving the coach's own account untouched", async () => {
    const { coachProfile, user: coachUser } = await insertCoach();
    const { user: clientUser, clientProfile } = await insertClient(coachProfile.id);

    const exercise = await insertExercise(coachProfile.id);
    const session = await insertWorkoutSession(clientProfile.id, coachProfile.id);
    await insertSetLog(session.id, exercise.id, clientProfile.id);
    await insertPersonalRecord(clientProfile.id, exercise.id);

    const food = await insertFood(clientUser.id);
    const meal = await insertMeal(clientProfile.id, coachProfile.id);
    await insertMealItem(meal.id, food.id);
    await insertWaterLog(clientProfile.id);
    await insertDailyNutritionSummary(clientProfile.id);

    const template = await insertCheckinTemplate(coachProfile.id);
    await insertCheckin(clientProfile.id, coachProfile.id, template.id);
    await insertBodyMetric(clientProfile.id);

    const asset = await insertMediaAsset(clientUser.id, coachProfile.id, clientProfile.id);
    await insertProgressPhoto(clientProfile.id, asset.id);

    await insertComment(clientProfile.id, coachUser.id);
    await insertReaction(clientUser.id);

    const habit = await insertHabit(clientProfile.id, coachProfile.id);
    await insertHabitLog(habit.id);

    const conversation = await insertConversation(coachProfile.id, clientProfile.id);
    await insertMessage(conversation.id, clientUser.id);

    const liveSession = await insertLiveSession(coachProfile.id, clientProfile.id);
    await insertLiveSessionParticipant(liveSession.id, clientUser.id);

    await insertDevice(clientUser.id);
    await insertAuthProvider(clientUser.id);
    await insertRefreshToken(clientUser.id);
    await insertCoachClientNote(coachProfile.id, clientProfile.id);

    await purgeAccount(db, clientUser.id);

    // Every table scoped to the purged client, in this test's isolated
    // database, is now empty — this test creates exactly one client and
    // puts nothing else into these tables for anyone else, so an
    // whole-table count is a valid proxy for "this client's rows are gone".
    for (const table of [
      schema.clientProfiles,
      schema.workoutSessions,
      schema.setLogs,
      schema.personalRecords,
      schema.meals,
      schema.mealItems,
      schema.waterLogs,
      schema.dailyNutritionSummary,
      schema.checkins,
      schema.bodyMetrics,
      schema.progressPhotos,
      schema.comments,
      schema.reactions,
      schema.habits,
      schema.habitLogs,
      schema.conversations,
      schema.messages,
      schema.liveSessions,
      schema.liveSessionParticipants,
      schema.mediaAssets,
    ]) {
      expect(await countRows(table)).toBe(0);
    }

    // The client's own identity rows are gone …
    const [remainingClientUser] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, clientUser.id));
    expect(remainingClientUser).toBeUndefined();
    expect(
      await db.select().from(schema.devices).where(eq(schema.devices.userId, clientUser.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.authProviders)
        .where(eq(schema.authProviders.userId, clientUser.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(schema.refreshTokens)
        .where(eq(schema.refreshTokens.userId, clientUser.id)),
    ).toHaveLength(0);
    const [remainingNote] = await db
      .select()
      .from(schema.coachClientNotes)
      .where(eq(schema.coachClientNotes.clientId, clientProfile.id));
    expect(remainingNote).toBeUndefined();

    // … but the coach's own account is untouched — this purge only removed the client.
    const [remainingCoach] = await db
      .select()
      .from(schema.coachProfiles)
      .where(eq(schema.coachProfiles.id, coachProfile.id));
    expect(remainingCoach).toBeDefined();
    const [remainingCoachUser] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, coachUser.id));
    expect(remainingCoachUser).toBeDefined();
    const [remainingExercise] = await db
      .select()
      .from(schema.exercises)
      .where(eq(schema.exercises.id, exercise.id));
    expect(remainingExercise).toBeDefined(); // coach-owned, survives a client purge

    // R2 was asked to delete exactly this client's media (storage + thumbnail key).
    expect(deleteR2Objects).toHaveBeenCalledWith(
      expect.arrayContaining([asset.storageKey, asset.thumbnailKey]),
    );
  });

  it("purges a coach's own account, including their owned exercises, programs, and invites", async () => {
    const { user: coachUser, coachProfile } = await insertCoach();
    const exercise = await insertExercise(coachProfile.id);
    const program = await insertProgram(coachProfile.id);
    await insertInvite(coachProfile.id);

    await purgeAccount(db, coachUser.id);

    const [remainingCoach] = await db
      .select()
      .from(schema.coachProfiles)
      .where(eq(schema.coachProfiles.id, coachProfile.id));
    expect(remainingCoach).toBeUndefined();
    const [remainingExercise] = await db
      .select()
      .from(schema.exercises)
      .where(eq(schema.exercises.id, exercise.id));
    expect(remainingExercise).toBeUndefined();
    expect(
      await db.select().from(schema.invites).where(eq(schema.invites.coachId, coachProfile.id)),
    ).toHaveLength(0);
    const [remainingProgram] = await db
      .select()
      .from(schema.programs)
      .where(eq(schema.programs.id, program.id));
    expect(remainingProgram).toBeUndefined();
  });

  it('refuses to purge a coach who still has a client (client_profiles.coach_id RESTRICT)', async () => {
    const { user: coachUser, coachProfile } = await insertCoach();
    await insertClient(coachProfile.id);

    // Detachment is account-lifecycle/05's job, not this function's — the
    // database itself is what refuses here, deliberately (this task's own
    // Approach/Risks sections).
    await expect(purgeAccount(db, coachUser.id)).rejects.toThrow();
  });

  it('writes one audit_log summary row with a hashed id, never the plaintext id', async () => {
    const { user: coachUser } = await insertCoach();

    await purgeAccount(db, coachUser.id);

    // Ordered — earlier tests in this file have already purged other
    // accounts, each leaving its own 'account.purged' row; this test's is
    // the most recent one.
    const [entry] = await db
      .select()
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.action, 'account.purged'), eq(schema.auditLog.targetType, 'user')),
      )
      .orderBy(desc(schema.auditLog.id))
      .limit(1);
    expect(entry).toBeDefined();
    expect(entry?.actorUserId).toBeNull(); // nulled by the FK when users was deleted
    expect(entry?.targetId).toBeNull(); // never the plaintext id
    const expectedHash = createHash('sha256').update(coachUser.id).digest('hex');
    expect(entry?.metadata).toEqual({ purgedUserIdHash: expectedHash });
  });

  it('rewrites an unverified food the user created, but leaves a verified one alone', async () => {
    const { user: coachUser } = await insertCoach();
    const unverified = await insertFood(coachUser.id, {
      name: 'My Special Shake',
      brand: 'Homemade',
      isVerified: false,
    });
    const verified = await insertFood(coachUser.id, {
      name: 'Chicken Breast',
      brand: 'Generic',
      isVerified: true,
    });

    // Another user's diary references the unverified food — must keep
    // resolving to the right calories after the purge (DB§19.2's own note).
    const { coachProfile: otherCoach } = await insertCoach();
    const { clientProfile: otherClient } = await insertClient(otherCoach.id);
    const otherMeal = await insertMeal(otherClient.id, otherCoach.id);
    const otherItem = await insertMealItem(otherMeal.id, unverified.id);

    await purgeAccount(db, coachUser.id);

    const [rewrittenFood] = await db
      .select()
      .from(schema.foods)
      .where(eq(schema.foods.id, unverified.id));
    expect(rewrittenFood?.name).toBe('Custom food');
    expect(rewrittenFood?.brand).toBeNull();
    expect(rewrittenFood?.createdByUserId).toBeNull(); // nulled by the FK
    expect(rewrittenFood?.caloriesPer100g).toBe('150.00'); // nutrition values untouched

    const [untouchedFood] = await db
      .select()
      .from(schema.foods)
      .where(eq(schema.foods.id, verified.id));
    expect(untouchedFood?.name).toBe('Chicken Breast');
    expect(untouchedFood?.brand).toBe('Generic');

    const [survivingItem] = await db
      .select()
      .from(schema.mealItems)
      .where(eq(schema.mealItems.id, otherItem.id));
    expect(survivingItem).toBeDefined(); // the other client's diary entry still resolves
    expect(survivingItem?.calories).toBe('150.00'); // its snapshot never depended on foods.name
  });
});

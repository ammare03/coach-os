// `account-lifecycle/09`'s two highest-severity ACs, proven directly
// against the collectors rather than through the packaged archive — real
// Postgres (`testing` skill §4), same fixture-builder pattern
// `../../jobs/purge-account.test.ts` already established for this exact
// kind of "prove it against a real foreign-key graph" requirement.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type {
  collectCoaching as CollectCoaching,
  collectNutrition as CollectNutrition,
  collectProfile as CollectProfile,
  collectTraining as CollectTraining,
  resolveExportSubject as ResolveExportSubject,
} from './collect.ts';

let pgContainer: StartedTestContainer;
let db: DbClient;
let collectCoaching: typeof CollectCoaching;
let collectNutrition: typeof CollectNutrition;
let collectProfile: typeof CollectProfile;
let collectTraining: typeof CollectTraining;
let resolveExportSubject: typeof ResolveExportSubject;

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
  ({ collectCoaching, collectNutrition, collectProfile, collectTraining, resolveExportSubject } =
    await import('./collect.ts'));
}, 60_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
}, 60_000);

let seq = 0;
function unique(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}-${randomUUID()}`;
}

async function insertCoach() {
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `${unique('coach')}@export-test.com`,
      passwordHash: 'fixture-hash',
      name: 'Fixture Coach',
      role: 'coach',
      timezone: 'UTC',
      emailVerifiedAt: new Date(),
    })
    .returning();
  if (!user) throw new Error('insertCoach: no user row');
  const [coachProfile] = await db
    .insert(schema.coachProfiles)
    .values({ userId: user.id })
    .returning();
  if (!coachProfile) throw new Error('insertCoach: no coach_profiles row');
  return { user, coachProfile };
}

async function insertClient(coachId: string) {
  const [user] = await db
    .insert(schema.users)
    .values({
      email: `${unique('client')}@export-test.com`,
      passwordHash: 'fixture-hash',
      name: 'Fixture Client',
      role: 'client',
      timezone: 'UTC',
      emailVerifiedAt: new Date(),
    })
    .returning();
  if (!user) throw new Error('insertClient: no user row');
  const [clientProfile] = await db
    .insert(schema.clientProfiles)
    .values({ userId: user.id, coachId })
    .returning();
  if (!clientProfile) throw new Error('insertClient: no client_profiles row');
  return { user, clientProfile };
}

describe('export collectors — role isolation', () => {
  it("a coach's collectors return zero of a client's training, nutrition, and coaching content", async () => {
    const { coachProfile } = await insertCoach();
    const { clientProfile, user: clientUser } = await insertClient(coachProfile.id);

    const exercise = (
      await db
        .insert(schema.exercises)
        .values({
          coachId: coachProfile.id,
          name: unique('Ex'),
          primaryMuscle: 'chest',
          equipment: 'barbell',
          movementPattern: 'push',
        })
        .returning()
    )[0];
    if (!exercise) throw new Error('no exercise row');
    const session = (
      await db
        .insert(schema.workoutSessions)
        .values({
          clientId: clientProfile.id,
          coachId: coachProfile.id,
          scheduledDate: '2026-01-05',
        })
        .returning()
    )[0];
    if (!session) throw new Error('no session row');
    await db.insert(schema.setLogs).values({
      workoutSessionId: session.id,
      exerciseId: exercise.id,
      clientId: clientProfile.id,
      setNumber: 1,
      reps: 5,
      weightKg: '100',
      clientLocalId: randomUUID(),
    });
    await db.insert(schema.meals).values({
      clientId: clientProfile.id,
      coachId: coachProfile.id,
      loggedDate: '2026-01-05',
      mealType: 'breakfast',
      clientLocalId: randomUUID(),
    });
    const template = (
      await db
        .insert(schema.checkinTemplates)
        .values({ coachId: coachProfile.id, name: 'T', fields: [] })
        .returning()
    )[0];
    if (!template) throw new Error('no template row');
    await db.insert(schema.checkins).values({
      clientId: clientProfile.id,
      coachId: coachProfile.id,
      templateId: template.id,
      templateSnapshot: [],
      periodStart: '2026-01-01',
      periodEnd: '2026-01-07',
    });
    await db.insert(schema.bodyMetrics).values({
      clientId: clientProfile.id,
      recordedAt: new Date(),
      recordedDate: '2026-01-05',
      weightKg: '80',
    });
    await db
      .insert(schema.habits)
      .values({ clientId: clientProfile.id, coachId: coachProfile.id, name: 'Habit' });
    // A client's own annotated video comment — must never appear in the coach's export.
    await db.insert(schema.comments).values({
      authorUserId: clientUser.id,
      clientId: clientProfile.id,
      targetType: 'workout_session',
      targetId: session.id,
      body: 'client-authored, must not leak into coach export',
    });

    const subject = await resolveExportSubject(db, coachProfile.userId);
    expect(subject.role).toBe('coach');

    const training = await collectTraining(db, subject);
    expect(training.sessions).toEqual([]);
    expect(training.personalRecords).toEqual([]);

    const nutrition = await collectNutrition(db, subject);
    expect(nutrition.meals).toEqual([]);

    const coaching = await collectCoaching(db, subject);
    expect(coaching.checkins).toEqual([]);
    expect(coaching.bodyMetrics).toEqual([]);
    expect(coaching.habits).toEqual([]);
    // The coach never authored or replied to the client's comment above.
    expect(coaching.comments).toEqual([]);
  });

  it("a client's export never contains coach_client_notes", async () => {
    const { coachProfile } = await insertCoach();
    const { clientProfile } = await insertClient(coachProfile.id);
    await db.insert(schema.coachClientNotes).values({
      coachId: coachProfile.id,
      clientId: clientProfile.id,
      body: 'private professional note',
    });

    const subject = await resolveExportSubject(db, clientProfile.userId);
    expect(subject.role).toBe('client');

    const coaching = await collectCoaching(db, subject);
    expect(coaching.coachNotes).toEqual([]);
  });

  it("a coach's export includes their own coach_client_notes", async () => {
    const { coachProfile } = await insertCoach();
    const { clientProfile } = await insertClient(coachProfile.id);
    await db
      .insert(schema.coachClientNotes)
      .values({ coachId: coachProfile.id, clientId: clientProfile.id, body: 'my own note' });

    const subject = await resolveExportSubject(db, coachProfile.userId);
    const coaching = await collectCoaching(db, subject);
    expect(coaching.coachNotes).toHaveLength(1);
    expect(coaching.coachNotes[0]?.body).toBe('my own note');
  });

  it("a client's collectors return their own training, nutrition, and coaching content", async () => {
    const { coachProfile } = await insertCoach();
    const { clientProfile } = await insertClient(coachProfile.id);
    const exercise = (
      await db
        .insert(schema.exercises)
        .values({
          coachId: coachProfile.id,
          name: unique('Ex'),
          primaryMuscle: 'chest',
          equipment: 'barbell',
          movementPattern: 'push',
        })
        .returning()
    )[0];
    if (!exercise) throw new Error('no exercise row');
    const session = (
      await db
        .insert(schema.workoutSessions)
        .values({
          clientId: clientProfile.id,
          coachId: coachProfile.id,
          scheduledDate: '2026-01-05',
        })
        .returning()
    )[0];
    if (!session) throw new Error('no session row');
    await db.insert(schema.setLogs).values({
      workoutSessionId: session.id,
      exerciseId: exercise.id,
      clientId: clientProfile.id,
      setNumber: 1,
      reps: 5,
      weightKg: '100',
      clientLocalId: randomUUID(),
    });

    const subject = await resolveExportSubject(db, clientProfile.userId);
    const training = await collectTraining(db, subject);
    expect(training.sessions).toHaveLength(1);
    expect(training.sessions[0]?.setLogs).toHaveLength(1);
  });

  it('collectProfile never returns a password hash or internal-only column', async () => {
    const { coachProfile } = await insertCoach();
    const subject = await resolveExportSubject(db, coachProfile.userId);
    const profile = await collectProfile(db, subject);
    expect(profile.account).not.toHaveProperty('passwordHash');
    expect(profile.account).not.toHaveProperty('internalOperator');
  });
});

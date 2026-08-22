// Composable, minimal fixture builders for tests — DB§21's realistic
// dataset (`../seed/`) is right for local development and demos; it is
// wrong for most automated tests (README.md explains why at length).
// Every function here:
//   - takes only the parameters that vary for a given test's purpose,
//   - defaults every other column to the simplest value satisfying every
//     `CHECK`/unique/foreign-key constraint the preceding schema features
//     built, relying on the column's own Postgres default wherever one
//     exists rather than restating it,
//   - returns the row(s) it created, typed via `../types.ts`'s inferred
//     types — never a hand-written shape (code-conventions),
//   - never depends on `../seed/`'s dataset having run first.
//
// Unlike `../seed/`, these do NOT need to be deterministic — DB§21's
// byte-identical requirement is specific to `pnpm db:seed`. Each call here
// generates fresh, randomly-suffixed unique values (`crypto.randomUUID()`),
// so calling a builder twice in the same test run never collides.
import { randomUUID } from 'node:crypto';

import type { Transaction } from '../aggregates/types.ts';
import type { DbClient } from '../client.ts';
import { comments } from '../schema/coaching.ts';
import { clientProfiles, coachProfiles, users } from '../schema/identity.ts';
import { exercises, programs, workoutSessions } from '../schema/training.ts';
import type {
  ClientProfile,
  CoachProfile,
  Comment,
  Exercise,
  NewClientProfile,
  NewCoachProfile,
  NewComment,
  NewExercise,
  NewProgram,
  NewUser,
  NewWorkoutSession,
  Program,
  User,
  WorkoutSession,
} from '../types.ts';

/** Every builder accepts either a plain `DbClient` or a transaction handle — both support `.insert()`. */
export type DbOrTx = DbClient | Transaction;

function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID()}@fixtures.test`;
}

/** A bare user row — most tests want `createCoach`/`createClient` instead, which build on this. */
export async function createUser(db: DbOrTx, overrides: Partial<NewUser> = {}): Promise<User> {
  const [row] = await db
    .insert(users)
    .values({
      email: uniqueEmail('user'),
      passwordHash: 'fixture-hash', // satisfies users_email_or_social; never a real credential
      name: 'Fixture User',
      role: 'client',
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('createUser: insert did not return a row');
  return row;
}

/** A coach — a `users` row (role='coach') plus its `coach_profiles` row. */
export async function createCoach(
  db: DbOrTx,
  overrides: { user?: Partial<NewUser>; profile?: Partial<NewCoachProfile> } = {},
): Promise<{ user: User; coachProfile: CoachProfile }> {
  const user = await createUser(db, {
    email: uniqueEmail('coach'),
    name: 'Fixture Coach',
    role: 'coach',
    ...overrides.user,
  });

  const [coachProfile] = await db
    .insert(coachProfiles)
    .values({ userId: user.id, ...overrides.profile })
    .returning();
  if (!coachProfile)
    throw new Error('createCoach: insert into coach_profiles did not return a row');

  return { user, coachProfile };
}

/**
 * A client belonging to `coachId` — a `users` row (role='client') plus its
 * `client_profiles` row. This is the single most important fixture in the
 * product (README.md): every cross-coach authorization test starts here.
 */
export async function createClient(
  db: DbOrTx,
  coachId: string,
  overrides: { user?: Partial<NewUser>; profile?: Partial<NewClientProfile> } = {},
): Promise<{ user: User; clientProfile: ClientProfile }> {
  const user = await createUser(db, {
    email: uniqueEmail('client'),
    name: 'Fixture Client',
    role: 'client',
    ...overrides.user,
  });

  const [clientProfile] = await db
    .insert(clientProfiles)
    .values({ userId: user.id, coachId, ...overrides.profile })
    .returning();
  if (!clientProfile)
    throw new Error('createClient: insert into client_profiles did not return a row');

  return { user, clientProfile };
}

/** A global exercise by default (`coachId` omitted); pass one to make it coach-custom. */
export async function createExercise(
  db: DbOrTx,
  coachId?: string,
  overrides: Partial<NewExercise> = {},
): Promise<Exercise> {
  const [row] = await db
    .insert(exercises)
    .values({
      coachId: coachId ?? null,
      name: `Fixture Exercise ${randomUUID()}`, // unique within (coachId, lower(name))
      primaryMuscle: 'chest',
      equipment: 'barbell',
      movementPattern: 'push',
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('createExercise: insert did not return a row');
  return row;
}

/** A coach-owned program — no weeks/days/exercises; add those explicitly if a test needs them. */
export async function createProgram(
  db: DbOrTx,
  coachId: string,
  overrides: Partial<NewProgram> = {},
): Promise<Program> {
  const [row] = await db
    .insert(programs)
    .values({
      coachId,
      name: 'Fixture Program',
      durationWeeks: 8,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('createProgram: insert did not return a row');
  return row;
}

/**
 * A workout session for `clientId`. `coachId` is required — it's the exact
 * denormalised column `ownsResource` (`phase-02-api-foundation/
 * authorization-middleware/03`) checks, so a fixture that omitted it would
 * be useless for the tests this builder exists to support.
 */
export async function createWorkoutSession(
  db: DbOrTx,
  clientId: string,
  coachId: string,
  overrides: Partial<NewWorkoutSession> = {},
): Promise<WorkoutSession> {
  const [row] = await db
    .insert(workoutSessions)
    .values({
      clientId,
      coachId,
      scheduledDate: new Date().toISOString().slice(0, 10),
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('createWorkoutSession: insert did not return a row');
  return row;
}

/**
 * A comment targeting `targetId` (defaults to a fresh random uuid — fine
 * for authorization tests, which assert on `clientId`/`authorUserId`, not
 * on the polymorphic target actually resolving; DB§10's own documented
 * gap, not something this fixture needs to work around).
 */
export async function createComment(
  db: DbOrTx,
  clientId: string,
  authorUserId: string,
  overrides: Partial<NewComment> = {},
): Promise<Comment> {
  const [row] = await db
    .insert(comments)
    .values({
      authorUserId,
      clientId,
      targetType: 'workout_session',
      targetId: randomUUID(),
      body: 'Fixture comment',
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('createComment: insert did not return a row');
  return row;
}

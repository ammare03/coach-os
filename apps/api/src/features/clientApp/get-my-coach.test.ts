// `relationship-controls/03` — real Postgres (`testing` skill §4), same
// reasoning as every other suite in this folder: the claim under test is
// that a projection over a real join returns real column values, which a
// mocked Drizzle would assert about the mock.
//
// What this file exists to prove: `getMyCoach` is the ONE read behind
// **Settings → What {coach} can see**. 03's Interfaces section names
// `me.get`, but `get-me.ts` states its own contract in its first doc
// comment — "role-specific fields live on coach_profiles/client_profiles
// and are returned by their own routers, never here" — and the three
// `*_shared_from` columns are `client_profiles` columns. So the screen's
// current state rides on this projection, and one query means no waterfall
// (`UI-UX.md` §UX8).
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import {
  createTwoCoachesFixture,
  type TwoCoachesFixture,
} from '../../__tests__/fixtures/two-coaches.ts';

import { getMyCoach } from './get-my-coach.ts';

let container: StartedTestContainer;
let db: DbClient;
let fixture: TwoCoachesFixture;

beforeAll(async () => {
  container = await new GenericContainer('postgres:16')
    .withEnvironment({
      POSTGRES_USER: 'coachos',
      POSTGRES_PASSWORD: 'coachos',
      POSTGRES_DB: 'coachos',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
    .start();

  const connectionString = `postgres://coachos:coachos@${container.getHost()}:${container.getMappedPort(5432)}/coachos`; // secret-scan-ignore — well-known local dev credential

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
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'inherit',
  });

  db = createDbClient({ connectionString, sslMode: false });
  fixture = await createTwoCoachesFixture(db);
}, 180_000);

afterAll(async () => {
  await db.$client.end();
  await container.stop();
}, 120_000);

const ROLLBACK = Symbol('get-my-coach-rollback');
async function withRolledBackTx<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
  let out: T | undefined;
  try {
    await db.transaction(async (tx) => {
      out = await fn(tx as unknown as DbClient);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
  return out as T;
}

describe('getMyCoach', () => {
  it('returns the coach identity a coached client is bound to', async () => {
    const result = await getMyCoach(db, fixture.clientA1.profileId);

    expect(result).toMatchObject({ id: fixture.coachA.profileId, name: 'Fixture' });
  });

  it('returns null for a client with no coach', async () => {
    await withRolledBackTx(async (tx) => {
      await tx
        .update(schema.clientProfiles)
        .set({ coachId: null })
        .where(eq(schema.clientProfiles.id, fixture.clientA1.profileId));

      expect(await getMyCoach(tx, fixture.clientA1.profileId)).toBeNull();
    });
  });

  // The widening `relationship-controls/03` needs: the settings screen
  // renders the CURRENT setting, not a default, and these four columns are
  // what "current" means.
  it('carries the four sharing columns the sharing screen renders', async () => {
    const sharedFrom = new Date('2026-06-20T00:00:00.000Z');

    await withRolledBackTx(async (tx) => {
      await tx
        .update(schema.clientProfiles)
        .set({
          historySharingChoice: 'twelve_weeks',
          historySharedFrom: sharedFrom,
          metricsSharedFrom: sharedFrom,
          nutritionSharedFrom: null,
        })
        .where(eq(schema.clientProfiles.id, fixture.clientA1.profileId));

      expect(await getMyCoach(tx, fixture.clientA1.profileId)).toMatchObject({
        historySharingChoice: 'twelve_weeks',
        historySharedFrom: sharedFrom,
        metricsSharedFrom: sharedFrom,
        nutritionSharedFrom: null,
      });
    });
  });

  // A client who has never made the decision — a first-timer, or any row
  // written before the column existed. The screen must render no selected
  // segment rather than guess one, so this has to arrive as null and not as
  // a fabricated default.
  it('reports a never-decided client as null on every sharing column', async () => {
    await withRolledBackTx(async (tx) => {
      await tx
        .update(schema.clientProfiles)
        .set({
          historySharingChoice: null,
          historySharedFrom: null,
          metricsSharedFrom: null,
          nutritionSharedFrom: null,
        })
        .where(eq(schema.clientProfiles.id, fixture.clientA1.profileId));

      expect(await getMyCoach(tx, fixture.clientA1.profileId)).toMatchObject({
        historySharingChoice: null,
        historySharedFrom: null,
        metricsSharedFrom: null,
        nutritionSharedFrom: null,
      });
    });
  });
});

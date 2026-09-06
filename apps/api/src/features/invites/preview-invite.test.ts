// Real Postgres (`testing` skill §4) — this is a join and an email match,
// and the security-relevant behaviour is which rows are refused. A mocked
// Drizzle client would test the mock. Same container-then-dynamic-import
// shape as `create-invite.test.ts`, for the same reason (`env.ts` freezes
// `DATABASE_URL` at module load).
//
// It covers `clientApp.coach`'s read too: both were added by
// `client-onboarding/01` for the same fork, they share every fixture, and
// a second container for four assertions is 60 seconds of CI nobody gets
// back.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type { getMyCoach as GetMyCoach } from '../clientApp/get-my-coach.ts';

import type { previewInvite as PreviewInvite } from './preview-invite.ts';

let pgContainer: StartedTestContainer;
let db: DbClient;
let previewInvite: typeof PreviewInvite;
let getMyCoach: typeof GetMyCoach;

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
  ({ previewInvite } = await import('./preview-invite.ts'));
  ({ getMyCoach } = await import('../clientApp/get-my-coach.ts'));
}, 120_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
}, 60_000);

let seq = 0;
function uniq(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}@preview-invite-test.com`;
}

async function insertCoach(name: string): Promise<{ coachProfileId: string }> {
  const [user] = await db
    .insert(schema.users)
    .values({
      email: uniq('coach'),
      passwordHash: 'argon2id$placeholder',
      name,
      role: 'coach',
      timezone: 'UTC',
      emailVerifiedAt: new Date(),
    })
    .returning();
  if (!user) throw new Error('seed insert into users did not return a row');
  const [profile] = await db
    .insert(schema.coachProfiles)
    .values({ userId: user.id, businessName: `${name} Strength` })
    .returning();
  if (!profile) throw new Error('seed insert into coach_profiles did not return a row');
  return { coachProfileId: profile.id };
}

async function insertClient(
  coachProfileId: string | null,
): Promise<{ userId: string; email: string; clientProfileId: string }> {
  const email = uniq('client');
  const [user] = await db
    .insert(schema.users)
    .values({
      email,
      passwordHash: 'argon2id$placeholder',
      name: 'A Client',
      role: 'client',
      timezone: 'UTC',
    })
    .returning();
  if (!user) throw new Error('seed insert into users did not return a row');
  const [profile] = await db
    .insert(schema.clientProfiles)
    .values({
      userId: user.id,
      coachId: coachProfileId,
      status: coachProfileId === null ? 'invited' : 'active',
      ...(coachProfileId === null ? {} : { activatedAt: new Date() }),
    })
    .returning();
  if (!profile) throw new Error('seed insert into client_profiles did not return a row');
  // Postgres `citext` lower-cases nothing on its own; the schema's `email`
  // primitive does, and the comparison in `previewInvite` is on the stored
  // value either way — return what was stored.
  return { userId: user.id, email: user.email, clientProfileId: profile.id };
}

async function insertInvite(
  coachProfileId: string,
  email: string,
  overrides: Partial<typeof schema.invites.$inferInsert> = {},
): Promise<string> {
  const code = Math.random().toString(36).slice(2, 10).toUpperCase();
  await db.insert(schema.invites).values({ coachId: coachProfileId, email, code, ...overrides });
  return code;
}

describe('previewInvite', () => {
  it('returns the inviting coach’s name for an invite addressed to the caller', async () => {
    const { coachProfileId } = await insertCoach('Marcus Adeyemi');
    const client = await insertClient(null);
    const code = await insertInvite(coachProfileId, client.email);

    await expect(previewInvite(db, { user: { email: client.email } }, code)).resolves.toEqual({
      coachName: 'Marcus Adeyemi',
    });
  });

  // The anti-enumeration rule, and the whole reason this is a
  // `clientProcedure` with an email check rather than a public lookup.
  it('refuses an invite addressed to someone else with INVITE_NOT_FOUND, the same code an unknown invite gets', async () => {
    const { coachProfileId } = await insertCoach('Priya Nair');
    const invited = await insertClient(null);
    const someoneElse = await insertClient(null);
    const code = await insertInvite(coachProfileId, invited.email);

    await expect(
      previewInvite(db, { user: { email: someoneElse.email } }, code),
    ).rejects.toMatchObject({ cause: { appCode: 'INVITE_NOT_FOUND' } });

    await expect(
      previewInvite(db, { user: { email: someoneElse.email } }, 'ZZZZZZZZ'),
    ).rejects.toMatchObject({ cause: { appCode: 'INVITE_NOT_FOUND' } });
  });

  it('reports an expired invite as expired, not as missing', async () => {
    const { coachProfileId } = await insertCoach('Sam Oyelaran');
    const client = await insertClient(null);
    const code = await insertInvite(coachProfileId, client.email, {
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(previewInvite(db, { user: { email: client.email } }, code)).rejects.toMatchObject({
      cause: { appCode: 'INVITE_EXPIRED' },
    });
  });

  it('reports a revoked invite as revoked', async () => {
    const { coachProfileId } = await insertCoach('Lena Fischer');
    const client = await insertClient(null);
    const code = await insertInvite(coachProfileId, client.email, { revokedAt: new Date() });

    await expect(previewInvite(db, { user: { email: client.email } }, code)).rejects.toMatchObject({
      cause: { appCode: 'INVITE_REVOKED' },
    });
  });
});

describe('getMyCoach', () => {
  it('returns the current coach for a coached client', async () => {
    const { coachProfileId } = await insertCoach('Rhea Kapoor');
    const client = await insertClient(coachProfileId);

    await expect(getMyCoach(db, client.clientProfileId)).resolves.toEqual({
      id: coachProfileId,
      name: 'Rhea Kapoor',
      businessName: 'Rhea Kapoor Strength',
    });
  });

  // The fork the invite route turns on: coachless is a real state
  // (`account-lifecycle/06`), not an error and not a missing row.
  it('returns null for a client between coaches', async () => {
    const client = await insertClient(null);

    await expect(getMyCoach(db, client.clientProfileId)).resolves.toBeNull();
  });
});

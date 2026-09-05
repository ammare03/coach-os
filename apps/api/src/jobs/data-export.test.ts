// `account-lifecycle/09` — the job end to end, against a real Postgres
// (`testing` skill §4). R2 and email are stubbed at the boundary, same
// reasoning `purge-account.test.ts` already applies to `deleteR2Objects`:
// this suite proves what the job DOES (row transitions, the archive it
// hands to the uploader, idempotent key derivation), not whether a real
// bucket or a real inbox received anything.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import type { buildDataExport as BuildDataExport } from './data-export.ts';

const uploadFileToR2 = jest.fn().mockResolvedValue(undefined);
const getR2ObjectStream = jest.fn().mockResolvedValue(null);
const getSignedDownloadUrl = jest.fn().mockResolvedValue('https://example.com/signed');
jest.mock('../lib/storage/r2-client.ts', () => ({
  uploadFileToR2: (...args: unknown[]) => uploadFileToR2(...args),
  getR2ObjectStream: (...args: unknown[]) => getR2ObjectStream(...args),
  getSignedDownloadUrl: (...args: unknown[]) => getSignedDownloadUrl(...args),
}));

const sendEmail = jest.fn().mockResolvedValue({ ok: true });
jest.mock('../lib/email/client.ts', () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));

let pgContainer: StartedTestContainer;
let db: DbClient;
let buildDataExport: typeof BuildDataExport;

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
  ({ buildDataExport } = await import('./data-export.ts'));
}, 60_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
}, 60_000);

beforeEach(() => {
  uploadFileToR2.mockClear();
  getR2ObjectStream.mockClear();
  getSignedDownloadUrl.mockClear();
  sendEmail.mockClear();
});

async function insertClientUser() {
  const [coachUser] = await db
    .insert(schema.users)
    .values({
      email: `${randomUUID()}@export-job-test.com`,
      passwordHash: 'fixture-hash',
      name: 'Fixture Coach',
      role: 'coach',
      timezone: 'UTC',
      emailVerifiedAt: new Date(),
    })
    .returning();
  if (!coachUser) throw new Error('no coach user row');
  const [coachProfile] = await db
    .insert(schema.coachProfiles)
    .values({ userId: coachUser.id })
    .returning();
  if (!coachProfile) throw new Error('no coach profile row');

  const [clientUser] = await db
    .insert(schema.users)
    .values({
      email: `${randomUUID()}@export-job-test.com`,
      passwordHash: 'fixture-hash',
      name: 'Fixture Client',
      role: 'client',
      timezone: 'UTC',
      emailVerifiedAt: new Date(),
    })
    .returning();
  if (!clientUser) throw new Error('no client user row');
  const [clientProfile] = await db
    .insert(schema.clientProfiles)
    .values({ userId: clientUser.id, coachId: coachProfile.id })
    .returning();
  if (!clientProfile) throw new Error('no client profile row');

  const exercise = (
    await db
      .insert(schema.exercises)
      .values({
        coachId: coachProfile.id,
        name: `Ex-${randomUUID()}`,
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
      .values({ clientId: clientProfile.id, coachId: coachProfile.id, scheduledDate: '2026-01-05' })
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

  return { clientUser, clientProfile };
}

async function insertQueuedExportRequest(userId: string) {
  const [row] = await db
    .insert(schema.exportRequests)
    .values({ userId, status: 'queued' })
    .returning();
  if (!row) throw new Error('no export_requests row');
  return row;
}

describe('buildDataExport', () => {
  it('builds an archive, uploads it, marks the row ready, and emails the subject', async () => {
    const { clientUser } = await insertClientUser();
    const request = await insertQueuedExportRequest(clientUser.id);

    await buildDataExport(db, request.id);

    expect(uploadFileToR2).toHaveBeenCalledTimes(1);
    const [tempPath, objectKey, contentType] = uploadFileToR2.mock.calls[0] as [
      string,
      string,
      string,
    ];
    expect(objectKey).toBe(`exports/${clientUser.id}/${request.id}.zip`);
    expect(contentType).toBe('application/zip');
    expect(tempPath).toContain(request.id);

    expect(sendEmail).toHaveBeenCalledTimes(1);
    const emailArg = sendEmail.mock.calls[0]?.[0] as { to: string };
    expect(emailArg.to).toBe(clientUser.email);

    const [row] = await db
      .select()
      .from(schema.exportRequests)
      .where(eq(schema.exportRequests.id, request.id));
    expect(row?.status).toBe('ready');
    expect(row?.objectKey).toBe(`exports/${clientUser.id}/${request.id}.zip`);
    expect(row?.bytes).toBeGreaterThan(0);
    expect(row?.formatVersion).toBe(1);
    expect(row?.expiresAt).toBeInstanceOf(Date);
    expect(row?.completedAt).toBeInstanceOf(Date);
    // One workout session, one set log — proves the training collector's
    // output actually reached the row's own row-count bookkeeping.
    expect((row?.rowCounts as Record<string, number> | null)?.sessions).toBe(1);

    const [auditRow] = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'account.export_generated'));
    expect(auditRow).toBeDefined();
    expect(auditRow?.targetId).toBe(clientUser.id);
  });

  it('is idempotent under a re-run: the object key never changes across attempts', async () => {
    const { clientUser } = await insertClientUser();
    const request = await insertQueuedExportRequest(clientUser.id);

    await buildDataExport(db, request.id);
    const firstKey = (uploadFileToR2.mock.calls[0] as [string, string])[1];
    uploadFileToR2.mockClear();

    await buildDataExport(db, request.id);
    const secondKey = (uploadFileToR2.mock.calls[0] as [string, string])[1];

    expect(secondKey).toBe(firstKey);
  });

  it('marks the row failed with a catalogued error code when packaging throws', async () => {
    const { clientUser } = await insertClientUser();
    const request = await insertQueuedExportRequest(clientUser.id);
    uploadFileToR2.mockRejectedValueOnce(new Error('R2 unavailable'));

    await expect(buildDataExport(db, request.id)).rejects.toThrow('R2 unavailable');

    const [row] = await db
      .select()
      .from(schema.exportRequests)
      .where(eq(schema.exportRequests.id, request.id));
    expect(row?.status).toBe('failed');
    expect(row?.errorCode).toBe('INTERNAL_ERROR');
  });

  it('cleans up its temp file after a successful build', async () => {
    const { clientUser } = await insertClientUser();
    const request = await insertQueuedExportRequest(clientUser.id);
    let tempPathAtUploadTime = '';
    uploadFileToR2.mockImplementationOnce(async (filePath: string) => {
      tempPathAtUploadTime = filePath;
      expect(fs.existsSync(filePath)).toBe(true);
    });

    await buildDataExport(db, request.id);

    // Cleanup is fire-and-forget (a leftover temp file is not this job's
    // real failure mode — see the job's own doc comment), so poll briefly
    // rather than assume it's finished after exactly one tick.
    const deadline = Date.now() + 2000;
    while (fs.existsSync(tempPathAtUploadTime) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(fs.existsSync(tempPathAtUploadTime)).toBe(false);
  });
});

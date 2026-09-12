// Real Postgres (`testing` skill §4). `coach_client_notes` is the one table
// in the schema carrying an in-line "never expose this to a client" warning
// (DB§5.1, `packages/db/src/schema/identity.ts`), so this suite is weighted
// toward the leak matrix rather than the CRUD happy path:
//
//   1. **Private to the AUTHORING coach**, not merely to the client's coach
//      (DB§5.4). A second coach with a note on the same client must be
//      invisible — a condition `ownsResource('client')` does not check, so
//      `listForClient` re-states it and this suite proves it with a real row.
//   2. **No client branch at all.** `coachNote`'s registry entry has
//      `clientOwnedIds: null`, so a client reaching any notes procedure is
//      refused before ownership is even consulted.
//   3. **Soft delete**, per DB§2 — a deleted note leaves the row behind and
//      disappears from every read.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import {
  createTwoCoachesFixture,
  type TwoCoachesFixture,
} from '../../__tests__/fixtures/two-coaches.ts';
import { createTestContext } from '../../__tests__/test-context.ts';
import type { ContextUser } from '../../trpc/context.ts';
import { appRouter } from '../index.ts';

let pgContainer: StartedTestContainer;
let db: DbClient;
let fixture: TwoCoachesFixture;

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

  const connectionString = `postgres://coachos:coachos@${pgContainer.getHost()}:${pgContainer.getMappedPort(5432)}/coachos`; // secret-scan-ignore — well-known local dev credential

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
}, 300_000);

afterAll(async () => {
  await db.$client.end();
  await pgContainer.stop();
}, 120_000);

// ---------------------------------------------------------------------------
// Callers
// ---------------------------------------------------------------------------

function coachUser(profileId: string, userId: string): ContextUser {
  return {
    id: userId,
    email: 'coach@two-coaches-fixture.com',
    role: 'coach',
    timezone: 'UTC',
    locale: 'en',
    isMinor: false,
    guardianConsentAt: null,
    coachProfileId: profileId,
    clientProfileId: null,
    deletionScheduledFor: null,
    deletedAt: null,
  };
}

function clientUser(profileId: string, userId: string): ContextUser {
  return {
    id: userId,
    email: 'client@two-coaches-fixture.com',
    role: 'client',
    timezone: 'UTC',
    locale: 'en',
    isMinor: false,
    guardianConsentAt: null,
    coachProfileId: null,
    clientProfileId: profileId,
    deletionScheduledFor: null,
    deletedAt: null,
  };
}

function asCoach(coach: { profileId: string; userId: string }) {
  return appRouter.createCaller(
    createTestContext({ db, user: coachUser(coach.profileId, coach.userId) }),
  );
}

function asClient(client: { profileId: string; userId: string }) {
  return appRouter.createCaller(
    createTestContext({ db, user: clientUser(client.profileId, client.userId) }),
  );
}

/** A well-formed UUIDv7 that names nothing — the enumeration-oracle probe. */
const NOWHERE_ID = '00000000-0000-7000-8000-00000000dead';

// ---------------------------------------------------------------------------

describe('notes.create', () => {
  it('writes a note scoped to the calling coach and the named client', async () => {
    const note = await asCoach(fixture.coachA).notes.create({
      clientId: fixture.clientA2.profileId,
      body: 'Knee is settling; keep unilateral work in.',
    });

    expect(note).toMatchObject({
      clientId: fixture.clientA2.profileId,
      body: 'Knee is settling; keep unilateral work in.',
      isPinned: false,
    });

    const [row] = await db
      .select({ coachId: schema.coachClientNotes.coachId })
      .from(schema.coachClientNotes)
      .where(eq(schema.coachClientNotes.id, note.noteId));
    // `coach_id` comes from the session, never from input — there is no
    // input field for it.
    expect(row?.coachId).toBe(fixture.coachA.profileId);
  });

  it("refuses another coach's client", async () => {
    await expect(
      asCoach(fixture.coachA).notes.create({
        clientId: fixture.clientB1.profileId,
        body: 'Should never be written.',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', cause: { appCode: 'NOT_YOUR_CLIENT' } });
  });

  it('refuses a client id that names nothing, with the same code', async () => {
    await expect(
      asCoach(fixture.coachA).notes.create({ clientId: NOWHERE_ID, body: 'Nowhere.' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', cause: { appCode: 'NOT_YOUR_CLIENT' } });
  });
});

describe('notes.listForClient', () => {
  it('returns only the calling coach’s own notes, newest first', async () => {
    const coachA = asCoach(fixture.coachA);
    const first = await coachA.notes.create({
      clientId: fixture.clientA1.profileId,
      body: 'First note.',
    });
    const second = await coachA.notes.create({
      clientId: fixture.clientA1.profileId,
      body: 'Second note.',
    });

    // Coach B's note about coach A's client. Not reachable in the product —
    // B cannot open this client — but the row can exist (a reassignment, an
    // assistant), and DB§5.4 says A must never read it.
    await db.insert(schema.coachClientNotes).values({
      coachId: fixture.coachB.profileId,
      clientId: fixture.clientA1.profileId,
      body: "Another coach's private note.",
    });

    const page = await coachA.notes.listForClient({ clientId: fixture.clientA1.profileId });

    const bodies = page.items.map((item) => item.body);
    expect(bodies).not.toContain("Another coach's private note.");
    expect(bodies.slice(0, 2)).toEqual(['Second note.', 'First note.']);
    expect(page.items.map((item) => item.noteId)).toEqual(
      expect.arrayContaining([first.noteId, second.noteId]),
    );
  });

  it("refuses another coach's client", async () => {
    await expect(
      asCoach(fixture.coachA).notes.listForClient({ clientId: fixture.clientB1.profileId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', cause: { appCode: 'NOT_YOUR_CLIENT' } });
  });

  it('pages with a cursor rather than an offset', async () => {
    const coachA = asCoach(fixture.coachA);
    for (const body of ['page A', 'page B', 'page C']) {
      await coachA.notes.create({ clientId: fixture.clientA2.profileId, body });
    }

    const first = await coachA.notes.listForClient({
      clientId: fixture.clientA2.profileId,
      limit: 2,
    });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await coachA.notes.listForClient({
      clientId: fixture.clientA2.profileId,
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    const firstIds = new Set(first.items.map((item) => item.noteId));
    for (const item of second.items) {
      expect(firstIds.has(item.noteId)).toBe(false);
    }
  });
});

describe('notes.update', () => {
  it('rewrites the body of the coach’s own note', async () => {
    const coachA = asCoach(fixture.coachA);
    const note = await coachA.notes.create({
      clientId: fixture.clientA1.profileId,
      body: 'Before.',
    });

    const updated = await coachA.notes.update({ coachNoteId: note.noteId, body: 'After.' });

    expect(updated).toMatchObject({ noteId: note.noteId, body: 'After.' });
  });

  it("refuses another coach's note", async () => {
    await expect(
      asCoach(fixture.coachA).notes.update({
        coachNoteId: fixture.coachB.coachNoteId,
        body: 'Should never land.',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', cause: { appCode: 'NOT_YOUR_CLIENT' } });

    const [row] = await db
      .select({ body: schema.coachClientNotes.body })
      .from(schema.coachClientNotes)
      .where(eq(schema.coachClientNotes.id, fixture.coachB.coachNoteId));
    expect(row?.body).toBe('Fixture note B');
  });

  it('refuses a note id that names nothing, with the same code', async () => {
    await expect(
      asCoach(fixture.coachA).notes.update({ coachNoteId: NOWHERE_ID, body: 'Nowhere.' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', cause: { appCode: 'NOT_YOUR_CLIENT' } });
  });
});

describe('notes.setPinned', () => {
  it('pins and unpins the coach’s own note', async () => {
    const coachA = asCoach(fixture.coachA);
    const note = await coachA.notes.create({
      clientId: fixture.clientA1.profileId,
      body: 'Pin me.',
    });

    const pinned = await coachA.notes.setPinned({ coachNoteId: note.noteId, isPinned: true });
    expect(pinned.isPinned).toBe(true);

    const unpinned = await coachA.notes.setPinned({ coachNoteId: note.noteId, isPinned: false });
    expect(unpinned.isPinned).toBe(false);
  });

  it("refuses another coach's note", async () => {
    await expect(
      asCoach(fixture.coachA).notes.setPinned({
        coachNoteId: fixture.coachB.coachNoteId,
        isPinned: true,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', cause: { appCode: 'NOT_YOUR_CLIENT' } });
  });
});

describe('notes.delete', () => {
  it('soft-deletes — the row stays, the read does not', async () => {
    const coachA = asCoach(fixture.coachA);
    const note = await coachA.notes.create({
      clientId: fixture.clientA1.profileId,
      body: 'Delete me.',
    });

    await coachA.notes.delete({ coachNoteId: note.noteId });

    const [row] = await db
      .select({ deletedAt: schema.coachClientNotes.deletedAt })
      .from(schema.coachClientNotes)
      .where(eq(schema.coachClientNotes.id, note.noteId));
    expect(row?.deletedAt).toBeInstanceOf(Date);

    const page = await coachA.notes.listForClient({ clientId: fixture.clientA1.profileId });
    expect(page.items.map((item) => item.noteId)).not.toContain(note.noteId);
  });

  it('is idempotent — a repeat delete is not an error', async () => {
    const coachA = asCoach(fixture.coachA);
    const note = await coachA.notes.create({
      clientId: fixture.clientA1.profileId,
      body: 'Delete me twice.',
    });

    await coachA.notes.delete({ coachNoteId: note.noteId });
    await expect(coachA.notes.delete({ coachNoteId: note.noteId })).resolves.toEqual({
      noteId: note.noteId,
    });
  });

  it('refuses to edit a note that is already deleted', async () => {
    const coachA = asCoach(fixture.coachA);
    const note = await coachA.notes.create({
      clientId: fixture.clientA1.profileId,
      body: 'Gone.',
    });
    await coachA.notes.delete({ coachNoteId: note.noteId });

    // `ownsResource` deliberately ignores `deleted_at` (03-owns-resource
    // step 6) — the guard passes and the resolver answers "no longer
    // there", with the guard's own byte-identical refusal so the pair is
    // never an existence oracle (step 2's accepted cost).
    await expect(
      coachA.notes.update({ coachNoteId: note.noteId, body: 'Resurrected.' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', cause: { appCode: 'NOT_YOUR_CLIENT' } });
  });

  it("refuses another coach's note and leaves it intact", async () => {
    await expect(
      asCoach(fixture.coachA).notes.delete({ coachNoteId: fixture.coachB.coachNoteId }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', cause: { appCode: 'NOT_YOUR_CLIENT' } });

    const [row] = await db
      .select({ deletedAt: schema.coachClientNotes.deletedAt })
      .from(schema.coachClientNotes)
      .where(eq(schema.coachClientNotes.id, fixture.coachB.coachNoteId));
    expect(row?.deletedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The property the whole feature exists for
// ---------------------------------------------------------------------------

describe('a client can reach no notes procedure at all', () => {
  // `coachNote`'s registry entry has `clientOwnedIds: null` — not a function
  // returning an empty set (`03-owns-resource.md` step 8). Every procedure
  // here is additionally a `coachProcedure`, so the refusal arrives at
  // `hasRole` before ownership is consulted; both locks are in place and
  // this asserts the outcome rather than which one fired.
  it('refuses every procedure for the client the notes are about', async () => {
    const client = asClient(fixture.clientA1);
    const own = { clientId: fixture.clientA1.profileId };

    await expect(client.notes.listForClient(own)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      cause: { appCode: 'ROLE_REQUIRED' },
    });
    await expect(client.notes.create({ ...own, body: 'Mine?' })).rejects.toMatchObject({
      cause: { appCode: 'ROLE_REQUIRED' },
    });
    await expect(
      client.notes.update({ coachNoteId: fixture.coachA.coachNoteId, body: 'Mine?' }),
    ).rejects.toMatchObject({ cause: { appCode: 'ROLE_REQUIRED' } });
    await expect(
      client.notes.setPinned({ coachNoteId: fixture.coachA.coachNoteId, isPinned: true }),
    ).rejects.toMatchObject({ cause: { appCode: 'ROLE_REQUIRED' } });
    await expect(
      client.notes.delete({ coachNoteId: fixture.coachA.coachNoteId }),
    ).rejects.toMatchObject({ cause: { appCode: 'ROLE_REQUIRED' } });
  });

  it('leaves no note body anywhere in the refusal', async () => {
    const client = asClient(fixture.clientA1);

    const error = await client.notes.listForClient({ clientId: fixture.clientA1.profileId }).then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toMatchObject({ cause: { appCode: 'ROLE_REQUIRED' } });
    expect(JSON.stringify(error)).not.toContain('Fixture note A');
  });
});

// ---------------------------------------------------------------------------
// The `.output()` gate — the "second lock" the router README requires for
// `identity.coach_client_notes`
// ---------------------------------------------------------------------------

describe('output gate', () => {
  it('never returns coach_id, even though the resolver owns the row', async () => {
    const coachA = asCoach(fixture.coachA);
    const note = await coachA.notes.create({
      clientId: fixture.clientA1.profileId,
      body: 'No coach_id on the wire.',
    });

    expect(note).not.toHaveProperty('coachId');
    expect(note).not.toHaveProperty('deletedAt');

    const page = await coachA.notes.listForClient({ clientId: fixture.clientA1.profileId });
    for (const item of page.items) {
      expect(item).not.toHaveProperty('coachId');
      expect(item).not.toHaveProperty('deletedAt');
    }
  });
});

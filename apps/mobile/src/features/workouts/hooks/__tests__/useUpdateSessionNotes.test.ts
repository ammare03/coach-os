import type {
  UpcomingSession,
  UpcomingSessionExercise,
} from 'api/src/features/workouts/upcoming.ts';
import { sql } from 'drizzle-orm';

import { getLocalDb, resetLocalDbForTests } from '../../../../db/client.ts';
import { localWorkoutSessions } from '../../../../db/schema/local-training.ts';
import { deserializeOutboxPayload, enqueueMutation } from '../../../../lib/outbox/enqueue.ts';
import { resetOutboxFlushStateForTests } from '../../../../lib/outbox/flush.ts';
import { serialiseSessionPayload } from '../../../../lib/prefetch/sessions.ts';
import {
  UPDATE_NOTES_PROCEDURE,
  clientPortionOf,
  composeSessionNotes,
  saveSessionNotes,
} from '../useUpdateSessionNotes.ts';

// `phase-09-workout-logger/session-summary/03`. The whole file exists for one
// failure: a client adds a note and the skip record `session-modifications/03`
// wrote to the same column disappears. Everything below is either that
// property or the ordering that keeps a second save from undoing the first.

jest.mock('expo-sqlite', () =>
  require('../../../../lib/outbox/__fixtures__/sqlite-fake.ts').createSqliteFake(),
);

jest.mock('expo-network', () => ({
  addNetworkStateListener: jest.fn(),
  getNetworkStateAsync: jest.fn(),
}));

const sqlite = jest.requireMock('expo-sqlite') as { __reset: () => void };

beforeEach(() => {
  sqlite.__reset();
  resetLocalDbForTests();
  resetOutboxFlushStateForTests();
});

const STARTED = new Date('2026-08-15T09:00:00.000Z');
const FINISHED = new Date('2026-08-15T10:12:30.000Z');
const SAVED_AT = new Date('2026-08-15T10:13:00.000Z');
const SERVER_ID = '018f4b1e-0000-7000-8000-000000000001';
const LOCAL_KEY = '018f4b1e-0000-7000-8000-0000000000aa';

const SKIP_LINE = 'Skipped: Leg press — equipment unavailable (machine was taken)';
const SECOND_SKIP = 'Skipped: Calf raise — ran out of time';
const OWN_WORDS = 'Right knee felt tight on the last two squat sets.';

/** See `useStartAdHocSession.test.ts` — the outbox's Drizzle table may not be imported here. */
// eslint-disable-next-line local/no-hand-written-row-type -- a snake_case projection of the device-local outbox
interface QueuedMutation {
  id: string;
  procedure: string;
  client_local_id: string;
  payload_json: string;
  depends_on: string | null;
}

function upcomingSession(): UpcomingSession {
  return {
    id: SERVER_ID,
    clientLocalId: LOCAL_KEY,
    assignmentId: '018f4b1e-0000-7000-8000-0000000000bb',
    programDayId: 'day-1',
    name: 'Lower body A',
    scheduledDate: '2026-08-15',
    status: 'completed',
    startedAt: STARTED,
    completedAt: FINISHED,
    updatedAt: FINISHED,
    dayName: 'Lower body A',
    dayNotes: null,
    exercises: [] as UpcomingSessionExercise[],
  } as UpcomingSession;
}

/** A session as `useCompleteSession` leaves it. */
async function seedCompleted(overrides: Partial<typeof localWorkoutSessions.$inferInsert> = {}) {
  const db = await getLocalDb();
  await db.insert(localWorkoutSessions).values({
    id: SERVER_ID,
    clientLocalId: LOCAL_KEY,
    serverId: SERVER_ID,
    scheduledDate: '2026-08-15',
    programDayId: 'day-1',
    name: 'Lower body A',
    status: 'completed',
    startedAt: STARTED.getTime(),
    completedAt: FINISHED.getTime(),
    payloadJson: serialiseSessionPayload({ session: upcomingSession(), exercises: [] }),
    startOutboxId: null,
    completeOutboxId: null,
    notesOutboxId: null,
    syncState: 'pending',
    updatedAt: FINISHED.getTime(),
    ...overrides,
  });
}

async function readRows() {
  const db = await getLocalDb();
  const sessions = await db.select().from(localWorkoutSessions);
  const entries = db.all<QueuedMutation>(sql`SELECT * FROM outbox ORDER BY id`);
  return { sessions, entries };
}

function payloadOf(entry: QueuedMutation): Record<string, unknown> {
  return deserializeOutboxPayload(entry.payload_json) as Record<string, unknown>;
}

describe('composeSessionNotes', () => {
  it('keeps the session record when the client adds nothing', () => {
    expect(composeSessionNotes(SKIP_LINE, '')).toBe(SKIP_LINE);
  });

  it('is the client’s own words when the session recorded nothing', () => {
    expect(composeSessionNotes('', OWN_WORDS)).toBe(OWN_WORDS);
  });

  it('is null when there is nothing at all to say', () => {
    // `null`, never `''` — an empty string in `client_notes` is a note the
    // client wrote that says nothing, which is not what happened.
    expect(composeSessionNotes('', '')).toBeNull();
    expect(composeSessionNotes('   ', '  \n ')).toBeNull();
  });

  it('APPENDS the client’s words after the record, separated by a blank line', () => {
    const composed = composeSessionNotes(`${SKIP_LINE}\n${SECOND_SKIP}`, OWN_WORDS);

    expect(composed).toBe(`${SKIP_LINE}\n${SECOND_SKIP}\n\n${OWN_WORDS}`);
  });

  it('never loses the record, whatever the client types', () => {
    // The task's Risks section in one assertion: the skip lines survive every
    // input, including one that looks like a deletion.
    for (const own of ['', ' ', OWN_WORDS, '\n\n\n', 'Skipped:', SKIP_LINE.slice(0, 10)]) {
      expect(composeSessionNotes(SKIP_LINE, own)).toContain(SKIP_LINE);
    }
  });

  it('is idempotent — re-composing an already-composed value repeats nothing', () => {
    const once = composeSessionNotes(SKIP_LINE, OWN_WORDS);
    if (once === null) throw new Error('composeSessionNotes returned null for a non-empty note');

    const twice = composeSessionNotes(SKIP_LINE, once);

    expect(twice).toBe(once);
  });
});

describe('clientPortionOf', () => {
  it('gives back only what the client typed', () => {
    const composed = composeSessionNotes(SKIP_LINE, OWN_WORDS);

    expect(clientPortionOf(composed, SKIP_LINE)).toBe(OWN_WORDS);
  });

  it('is empty for a stored value that is only the session record', () => {
    expect(clientPortionOf(SKIP_LINE, SKIP_LINE)).toBe('');
  });

  it('is empty for a session with nothing stored', () => {
    expect(clientPortionOf(null, SKIP_LINE)).toBe('');
  });

  it('returns the whole value when the record is not its prefix', () => {
    // A note stored by a build that composed it differently. Returning it
    // keeps the client's words on screen, and `composeSessionNotes` is
    // idempotent, so the round trip cannot duplicate the record either.
    expect(clientPortionOf(OWN_WORDS, SKIP_LINE)).toBe(OWN_WORDS);
  });
});

describe('saveSessionNotes — the local write', () => {
  it('stores the composed value, not the client’s words alone', async () => {
    await seedCompleted();

    await saveSessionNotes({
      sessionLocalId: LOCAL_KEY,
      perceivedExertion: 7,
      clientNote: OWN_WORDS,
      priorNotes: SKIP_LINE,
      now: () => SAVED_AT,
    });

    const { sessions } = await readRows();
    expect(sessions[0]?.clientNotes).toBe(`${SKIP_LINE}\n\n${OWN_WORDS}`);
    expect(sessions[0]?.perceivedExertion).toBe(7);
  });

  it('leaves the row pending, so the next prefetch cannot revert it', async () => {
    await seedCompleted({ syncState: 'synced' });

    await saveSessionNotes({
      sessionLocalId: LOCAL_KEY,
      perceivedExertion: null,
      clientNote: OWN_WORDS,
      priorNotes: '',
      now: () => SAVED_AT,
    });

    const { sessions } = await readRows();
    expect(sessions[0]?.syncState).toBe('pending');
    expect(sessions[0]?.updatedAt).toBe(SAVED_AT.getTime());
  });

  it('throws rather than queue a note for a session this device does not hold', async () => {
    await expect(
      saveSessionNotes({
        sessionLocalId: LOCAL_KEY,
        perceivedExertion: 7,
        clientNote: OWN_WORDS,
        priorNotes: '',
      }),
    ).rejects.toThrow(/no local_workout_sessions row/);
  });
});

describe('saveSessionNotes — the outbox', () => {
  it('queues one update carrying the composed note and the exertion', async () => {
    await seedCompleted();

    await saveSessionNotes({
      sessionLocalId: LOCAL_KEY,
      perceivedExertion: 7,
      clientNote: OWN_WORDS,
      priorNotes: SKIP_LINE,
    });

    const { entries } = await readRows();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.procedure).toBe(UPDATE_NOTES_PROCEDURE);
    expect(payloadOf(entries[0] as QueuedMutation)).toEqual({
      sessionClientLocalId: LOCAL_KEY,
      perceivedExertion: 7,
      clientNotes: `${SKIP_LINE}\n\n${OWN_WORDS}`,
    });
  });

  it('chains the update behind the session’s completion', async () => {
    const completion = await enqueueMutation({
      procedure: 'workouts.complete',
      payload: { sessionClientLocalId: LOCAL_KEY, completedAt: FINISHED },
    });
    await seedCompleted({ completeOutboxId: completion.outboxId });

    await saveSessionNotes({
      sessionLocalId: LOCAL_KEY,
      perceivedExertion: 7,
      clientNote: OWN_WORDS,
      priorNotes: '',
    });

    const { entries, sessions } = await readRows();
    const update = entries.find((entry) => entry.procedure === UPDATE_NOTES_PROCEDURE);
    expect(update?.depends_on).toBe(completion.outboxId);
    expect(sessions[0]?.notesOutboxId).toBe(update?.id);
  });

  it('chains a second save behind the first, never alongside it', async () => {
    // Siblings flush concurrently, so two updates hung off the completion
    // could land in either order and the OLDER text could win — the same
    // failure `enqueueMutation`'s re-send chaining exists to prevent.
    const completion = await enqueueMutation({
      procedure: 'workouts.complete',
      payload: { sessionClientLocalId: LOCAL_KEY, completedAt: FINISHED },
    });
    await seedCompleted({ completeOutboxId: completion.outboxId });

    const first = await saveSessionNotes({
      sessionLocalId: LOCAL_KEY,
      perceivedExertion: 7,
      clientNote: 'first',
      priorNotes: '',
    });
    const second = await saveSessionNotes({
      sessionLocalId: LOCAL_KEY,
      perceivedExertion: 8,
      clientNote: 'second',
      priorNotes: '',
    });

    const { entries, sessions } = await readRows();
    const firstEntry = entries.find((entry) => entry.id === first.outboxId);
    const secondEntry = entries.find((entry) => entry.id === second.outboxId);
    expect(firstEntry?.depends_on).toBe(completion.outboxId);
    expect(secondEntry?.depends_on).toBe(first.outboxId);
    expect(sessions[0]?.notesOutboxId).toBe(second.outboxId);
  });

  it('queues UNCHAINED when the row carries no completion id', async () => {
    // `completeSession` rule (f): a repeat completion returns no id, and a
    // session an older build finished stored none. `enqueueMutation` throws
    // on a `dependsOn` naming nothing, so an invented parent would strand the
    // note entirely — unordered beats stranded.
    await seedCompleted({ completeOutboxId: null });

    await saveSessionNotes({
      sessionLocalId: LOCAL_KEY,
      perceivedExertion: 7,
      clientNote: OWN_WORDS,
      priorNotes: '',
    });

    const { entries } = await readRows();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.depends_on).toBeNull();
  });

  it('generates a fresh idempotency key per save, never reusing one', async () => {
    await seedCompleted();

    const first = await saveSessionNotes({
      sessionLocalId: LOCAL_KEY,
      perceivedExertion: 7,
      clientNote: 'first',
      priorNotes: '',
    });
    const second = await saveSessionNotes({
      sessionLocalId: LOCAL_KEY,
      perceivedExertion: 8,
      clientNote: 'second',
      priorNotes: '',
    });

    expect(second.clientLocalId).not.toBe(first.clientLocalId);
  });

  it('sends null for a cleared exertion rather than omitting the field', async () => {
    // `updateSessionNotesInput` is a `strictObject` with both fields
    // required-and-nullable: an omitted field would leave the server's old
    // value standing with nothing to correct it.
    await seedCompleted();

    await saveSessionNotes({
      sessionLocalId: LOCAL_KEY,
      perceivedExertion: null,
      clientNote: '',
      priorNotes: '',
    });

    const { entries } = await readRows();
    expect(payloadOf(entries[0] as QueuedMutation)).toEqual({
      sessionClientLocalId: LOCAL_KEY,
      perceivedExertion: null,
      clientNotes: null,
    });
  });
});

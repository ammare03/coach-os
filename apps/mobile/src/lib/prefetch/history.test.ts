import { sql } from 'drizzle-orm';

import { getLocalDb, resetLocalDbForTests } from '../../db/client.ts';

import {
  buildHistoryComment,
  buildHistoryMeal,
  buildHistorySession,
  buildMealItem,
  buildSetLog,
} from './__fixtures__/history.ts';
import {
  HISTORY_DAYS,
  historyRange,
  parseHistorySessionPayload,
  parseMealItems,
  prefetchHistory,
  writeHistoryComments,
  writeHistoryMeals,
  writeHistorySessions,
} from './history.ts';

type Row = Record<string, unknown>;

jest.mock('expo-sqlite', () => require('../outbox/__fixtures__/sqlite-fake.ts').createSqliteFake());

const sqliteFake = jest.requireMock('expo-sqlite') as { __reset: () => void };

async function readTable(table: string): Promise<Row[]> {
  const db = await getLocalDb();
  return db.all<Row>(sql.raw(`SELECT * FROM ${table}`));
}

const emptyHistory = { sessions: [], meals: [], comments: [] };

beforeEach(() => {
  sqliteFake.__reset();
  resetLocalDbForTests();
});

describe('historyRange', () => {
  it('covers the 30 days ending on the client’s local today', () => {
    const range = historyRange(new Date('2026-08-15T09:00:00.000Z'), 'UTC');

    expect(range).toEqual({ from: '2026-07-17', to: '2026-08-15' });
    expect(HISTORY_DAYS).toBe(30);
  });

  it('uses the client’s local day, not the UTC one', () => {
    // 19:00Z is 00:30 the next day in Kolkata — `CLAUDE.md` §25.5.
    const at = new Date('2026-08-14T19:00:00.000Z');

    expect(historyRange(at, 'Asia/Kolkata').to).toBe('2026-08-15');
    expect(historyRange(at, 'UTC').to).toBe('2026-08-14');
  });
});

describe('writeHistorySessions', () => {
  it('writes a past session with its logged sets in the payload', async () => {
    const db = await getLocalDb();

    const result = await writeHistorySessions(db, [buildHistorySession()], {
      upcomingOwnsFrom: '2026-08-15',
    });

    expect(result).toEqual({
      inserted: 1,
      updated: 0,
      skippedUnsynced: 0,
      skippedToUpcoming: 0,
    });
    const rows = await readTable('local_workout_sessions');
    expect(rows[0]).toMatchObject({
      id: 'session-1',
      client_local_id: 'session-local-1',
      scheduled_date: '2026-08-10',
      status: 'completed',
      sync_state: 'synced',
    });
    const payload = parseHistorySessionPayload(String(rows[0]?.payload_json));
    expect(payload.setLogs).toHaveLength(1);
    expect(payload.setLogs[0]).toMatchObject({
      exerciseName: 'Back Squat',
      reps: 5,
      weightKg: 102.5,
    });
    // superjson, not JSON.stringify: a timestamp must still be a Date
    // after an app restart, or every history screen re-parses strings.
    expect(payload.setLogs[0]?.loggedAt).toBeInstanceOf(Date);
    expect(payload.session.completedAt).toBeInstanceOf(Date);
  });

  it("leaves today and tomorrow to task 01's prescription prefetch", async () => {
    const db = await getLocalDb();

    const result = await writeHistorySessions(
      db,
      [
        buildHistorySession({ id: 'past', clientLocalId: 'past', scheduledDate: '2026-08-14' }),
        buildHistorySession({ id: 'today', clientLocalId: 'today', scheduledDate: '2026-08-15' }),
      ],
      { upcomingOwnsFrom: '2026-08-15' },
    );

    expect(result).toMatchObject({ inserted: 1, skippedToUpcoming: 1 });
    expect((await readTable('local_workout_sessions')).map((row) => row.id)).toEqual(['past']);
  });

  it('never clobbers a session the device has not synced yet', async () => {
    const db = await getLocalDb();
    await writeHistorySessions(db, [buildHistorySession()], { upcomingOwnsFrom: '2026-08-15' });
    db.run(
      sql`UPDATE local_workout_sessions SET sync_state = ${'pending'}, status = ${'in_progress'}`,
    );

    const result = await writeHistorySessions(
      db,
      [buildHistorySession({ status: 'completed', clientNotes: 'server truth' })],
      { upcomingOwnsFrom: '2026-08-15' },
    );

    expect(result).toMatchObject({ inserted: 0, updated: 0, skippedUnsynced: 1 });
    expect((await readTable('local_workout_sessions'))[0]).toMatchObject({
      status: 'in_progress',
      sync_state: 'pending',
    });
  });

  it('refreshes a synced session in place rather than duplicating it', async () => {
    const db = await getLocalDb();
    await writeHistorySessions(db, [buildHistorySession()], { upcomingOwnsFrom: '2026-08-15' });

    const result = await writeHistorySessions(
      db,
      [
        buildHistorySession({
          setLogs: [buildSetLog(), buildSetLog({ id: 'set-2', setNumber: 2 })],
        }),
      ],
      { upcomingOwnsFrom: '2026-08-15' },
    );

    expect(result).toMatchObject({ inserted: 0, updated: 1 });
    const rows = await readTable('local_workout_sessions');
    expect(rows).toHaveLength(1);
    expect(parseHistorySessionPayload(String(rows[0]?.payload_json)).setLogs).toHaveLength(2);
  });
});

describe('writeHistoryMeals', () => {
  it('writes a meal with its items denormalised for offline rendering', async () => {
    const db = await getLocalDb();

    const result = await writeHistoryMeals(db, [buildHistoryMeal()]);

    expect(result).toEqual({ inserted: 1, updated: 0, skippedUnsynced: 0 });
    const rows = await readTable('local_meals');
    expect(rows[0]).toMatchObject({
      id: 'meal-1',
      client_local_id: 'meal-local-1',
      logged_date: '2026-08-10',
      meal_type: 'lunch',
      logged_at: new Date('2026-08-10T12:00:00.000Z').getTime(),
      sync_state: 'synced',
    });
    expect(parseMealItems(String(rows[0]?.items_json))).toEqual([
      { name: 'Dal', quantityG: 150, calories: 247.5, proteinG: 46.5, carbsG: 0, fatG: 5.4 },
    ]);
  });

  it('never clobbers a meal the device logged offline and has not synced', async () => {
    const db = await getLocalDb();
    await writeHistoryMeals(db, [buildHistoryMeal()]);
    db.run(sql`UPDATE local_meals SET sync_state = ${'pending'}, notes = ${'my edit'}`);

    const result = await writeHistoryMeals(db, [buildHistoryMeal({ notes: 'server truth' })]);

    expect(result).toMatchObject({ updated: 0, skippedUnsynced: 1 });
    expect((await readTable('local_meals'))[0]).toMatchObject({ notes: 'my edit' });
  });

  it('refreshes a synced meal in place', async () => {
    const db = await getLocalDb();
    await writeHistoryMeals(db, [buildHistoryMeal()]);

    const result = await writeHistoryMeals(db, [
      buildHistoryMeal({ items: [buildMealItem(), buildMealItem({ name: 'Rice' })] }),
    ]);

    expect(result).toMatchObject({ inserted: 0, updated: 1 });
    const rows = await readTable('local_meals');
    expect(rows).toHaveLength(1);
    expect(parseMealItems(String(rows[0]?.items_json))).toHaveLength(2);
  });
});

describe('writeHistoryComments', () => {
  it('writes a comment with its annotation and asset ids, but no signed URL', async () => {
    const db = await getLocalDb();

    const result = await writeHistoryComments(db, [
      buildHistoryComment({
        voiceNoteAssetId: 'asset-9',
        timestampMs: 12_500,
        annotation: [{ frame_ms: 1200, shape: 'arrow' }],
      }),
    ]);

    expect(result).toEqual({ inserted: 1, updated: 0 });
    const rows = await readTable('local_comments');
    expect(rows[0]).toMatchObject({
      id: 'comment-1',
      target_type: 'workout_session',
      target_id: 'session-1',
      author_user_id: 'coach-user-1',
      body: 'Nice depth on set three',
      voice_note_asset_id: 'asset-9',
      timestamp_ms: 12_500,
      is_ai_generated: 0,
      created_at: new Date('2026-08-10T19:00:00.000Z').getTime(),
    });
    expect(JSON.parse(String(rows[0]?.annotation_json))).toEqual([
      { frame_ms: 1200, shape: 'arrow' },
    ]);
  });

  it('refreshes an edited comment in place rather than duplicating it', async () => {
    const db = await getLocalDb();
    await writeHistoryComments(db, [buildHistoryComment()]);

    const result = await writeHistoryComments(db, [buildHistoryComment({ body: 'Edited' })]);

    expect(result).toEqual({ inserted: 0, updated: 1 });
    const rows = await readTable('local_comments');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ body: 'Edited' });
  });

  it('stores null, not the string "null", when there is no annotation', async () => {
    const db = await getLocalDb();

    await writeHistoryComments(db, [buildHistoryComment()]);

    expect((await readTable('local_comments'))[0]).toMatchObject({ annotation_json: null });
  });
});

describe('prefetchHistory', () => {
  it('asks for the trailing 30 days in the client’s own zone', async () => {
    const fetchHistory = jest.fn().mockResolvedValue(emptyHistory);

    await prefetchHistory({
      fetchHistory,
      now: new Date('2026-08-15T09:00:00.000Z'),
      timeZone: 'UTC',
    });

    expect(fetchHistory).toHaveBeenCalledWith({ from: '2026-07-17', to: '2026-08-15' });
  });

  it('writes all three tables in one pass and reports what it did', async () => {
    const result = await prefetchHistory({
      now: new Date('2026-08-15T09:00:00.000Z'),
      timeZone: 'UTC',
      fetchHistory: async () => ({
        sessions: [buildHistorySession()],
        meals: [buildHistoryMeal()],
        comments: [buildHistoryComment()],
      }),
    });

    expect(result).toMatchObject({
      sessions: { inserted: 1, updated: 0, skippedUnsynced: 0, skippedToUpcoming: 0 },
      meals: { inserted: 1, updated: 0, skippedUnsynced: 0 },
      comments: { inserted: 1, updated: 0 },
      range: { from: '2026-07-17', to: '2026-08-15' },
    });
    expect(await readTable('local_workout_sessions')).toHaveLength(1);
    expect(await readTable('local_meals')).toHaveLength(1);
    expect(await readTable('local_comments')).toHaveLength(1);
  });

  it('writes nothing at all for a client with no history', async () => {
    const result = await prefetchHistory({
      now: new Date('2026-08-15T09:00:00.000Z'),
      timeZone: 'UTC',
      fetchHistory: async () => emptyHistory,
    });

    expect(result.sessions.inserted + result.meals.inserted + result.comments.inserted).toBe(0);
    expect(await readTable('local_comments')).toHaveLength(0);
  });
});

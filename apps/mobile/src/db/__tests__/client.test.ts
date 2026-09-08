import { sql } from 'drizzle-orm';

import { DATABASE_NAME, getLocalDb, resetLocalDbForTests } from '../client.ts';

// `expo-sqlite`'s native module has no Jest-side implementation, same
// situation as `lib/query/persister.ts`'s tests. A hand-rolled fake statement
// that recognises the four statements a "throwaway table" round trip needs
// (create, insert, select, drop) stands in for the real driver — the SQL
// text, params, and Drizzle's session/query layer above it are all real.

type FakeRow = { value: string };

jest.mock('expo-sqlite', () => {
  let rows: FakeRow[] = [];

  function makeResult(resultRows: FakeRow[], changes = 0, lastInsertRowId = 0) {
    return {
      changes,
      lastInsertRowId,
      getFirstSync: () => resultRows[0],
      getAllSync: () => resultRows,
    };
  }

  const database = {
    prepareSync: jest.fn((sqlText: string) => ({
      executeSync: (params: unknown[] = []) => {
        if (/^CREATE TABLE/i.test(sqlText)) {
          rows = [];
          return makeResult([]);
        }
        if (/^INSERT INTO/i.test(sqlText)) {
          const row: FakeRow = { value: String(params[0]) };
          rows.push(row);
          return makeResult([row], 1, rows.length);
        }
        if (/^SELECT/i.test(sqlText)) {
          return makeResult([...rows]);
        }
        if (/^DROP TABLE/i.test(sqlText)) {
          rows = [];
          return makeResult([]);
        }
        throw new Error(`Unhandled SQL in fake expo-sqlite: ${sqlText}`);
      },
    })),
  };

  return {
    openDatabaseAsync: jest.fn(async () => database),
    __database: database,
  };
});

const sqliteFake = jest.requireMock('expo-sqlite') as {
  openDatabaseAsync: jest.Mock;
  __database: { prepareSync: jest.Mock };
};

beforeEach(() => {
  resetLocalDbForTests();
  sqliteFake.openDatabaseAsync.mockClear();
});

describe('the local SQLite + Drizzle connection', () => {
  it('opens the Drizzle expo-sqlite connection and round-trips a throwaway table', async () => {
    const db = await getLocalDb();

    db.run(sql`CREATE TABLE IF NOT EXISTS round_trip_check (id INTEGER PRIMARY KEY, value TEXT)`);
    db.run(sql`INSERT INTO round_trip_check (value) VALUES (${'ok'})`);
    const row = db.get<FakeRow>(sql`SELECT value FROM round_trip_check LIMIT 1`);
    db.run(sql`DROP TABLE round_trip_check`);

    expect(row).toEqual({ value: 'ok' });
  });

  it('opens a stable, literal file name — not one derived per launch', async () => {
    await getLocalDb();

    expect(DATABASE_NAME).toBe('coachos.db');
    expect(sqliteFake.openDatabaseAsync).toHaveBeenCalledWith('coachos.db');
  });

  it('memoises the connection — a second call does not reopen the database', async () => {
    const first = await getLocalDb();
    const second = await getLocalDb();

    expect(second).toBe(first);
    expect(sqliteFake.openDatabaseAsync).toHaveBeenCalledTimes(1);
  });

  it('does not memoise a failed open, so a later call can retry', async () => {
    sqliteFake.openDatabaseAsync.mockRejectedValueOnce(new Error('native module unavailable'));

    await expect(getLocalDb()).rejects.toThrow('native module unavailable');

    const db = await getLocalDb();

    expect(db).toBeDefined();
    expect(sqliteFake.openDatabaseAsync).toHaveBeenCalledTimes(2);
  });
});

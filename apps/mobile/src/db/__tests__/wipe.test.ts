import { DATABASE_NAME, getLocalDb, resetLocalDbForTests } from '../client.ts';
import { wipeLocalDatabase } from '../wipe.ts';

// Same hand-rolled fake philosophy as `client.test.ts`: recognise exactly
// the SQL shapes this flow produces (the bootstrap's CREATE statements, and
// `wipe.ts`'s own pending-count query), plus `closeAsync` and the top-level
// `deleteDatabaseAsync` the wipe itself calls.

jest.mock('expo-sqlite', () => {
  let pendingCount = 0;

  function makeResult(row: unknown) {
    return {
      changes: 0,
      lastInsertRowId: 0,
      getFirstSync: () => row,
      getAllSync: () => (row === undefined ? [] : [row]),
    };
  }

  const database = {
    prepareSync: jest.fn((sqlText: string) => ({
      executeSync: () => {
        if (/^CREATE TABLE/i.test(sqlText) || /^CREATE INDEX/i.test(sqlText)) {
          return makeResult(undefined);
        }
        if (/^SELECT COUNT\(\*\)/i.test(sqlText)) {
          return makeResult({ pending: pendingCount });
        }
        throw new Error(`Unhandled SQL in fake expo-sqlite: ${sqlText}`);
      },
    })),
    closeAsync: jest.fn(async () => undefined),
  };

  return {
    openDatabaseAsync: jest.fn(async () => database),
    deleteDatabaseAsync: jest.fn(async () => undefined),
    __database: database,
    __setPendingCount: (count: number) => {
      pendingCount = count;
    },
  };
});

const sqliteFake = jest.requireMock('expo-sqlite') as {
  openDatabaseAsync: jest.Mock;
  deleteDatabaseAsync: jest.Mock;
  __database: { closeAsync: jest.Mock };
  __setPendingCount: (count: number) => void;
};

beforeEach(() => {
  resetLocalDbForTests();
  sqliteFake.openDatabaseAsync.mockClear();
  sqliteFake.deleteDatabaseAsync.mockClear();
  sqliteFake.__database.closeAsync.mockClear();
  sqliteFake.__setPendingCount(0);
});

describe('wipeLocalDatabase', () => {
  it('deletes the entire SQLite file when the outbox is empty', async () => {
    const result = await wipeLocalDatabase();

    expect(result).toEqual({ outcome: 'wiped' });
    expect(sqliteFake.deleteDatabaseAsync).toHaveBeenCalledWith(DATABASE_NAME);
  });

  it('closes the connection before deleting the file, not after', async () => {
    const closeOrder: string[] = [];
    sqliteFake.__database.closeAsync.mockImplementation(async () => {
      closeOrder.push('close');
    });
    sqliteFake.deleteDatabaseAsync.mockImplementation(async () => {
      closeOrder.push('delete');
    });

    await wipeLocalDatabase();

    expect(closeOrder).toEqual(['close', 'delete']);
  });

  it('blocks and reports the pending count, without deleting, when the outbox has unsynced rows', async () => {
    sqliteFake.__setPendingCount(3);

    const result = await wipeLocalDatabase();

    expect(result).toEqual({ outcome: 'blocked', pendingCount: 3 });
    expect(sqliteFake.deleteDatabaseAsync).not.toHaveBeenCalled();
  });

  it('deletes the file anyway when force is set, despite pending rows', async () => {
    sqliteFake.__setPendingCount(1);

    const result = await wipeLocalDatabase({ force: true });

    expect(result).toEqual({ outcome: 'wiped' });
    expect(sqliteFake.deleteDatabaseAsync).toHaveBeenCalledWith(DATABASE_NAME);
  });

  it('reopens a fresh connection on the next call after wiping', async () => {
    await wipeLocalDatabase();

    await getLocalDb();

    expect(sqliteFake.openDatabaseAsync).toHaveBeenCalledTimes(2);
  });

  it('reports failed, rather than throwing, when the database cannot be opened', async () => {
    sqliteFake.openDatabaseAsync.mockRejectedValueOnce(new Error('native module unavailable'));

    const result = await wipeLocalDatabase();

    expect(result).toMatchObject({ outcome: 'failed' });
    expect(sqliteFake.deleteDatabaseAsync).not.toHaveBeenCalled();
  });
});

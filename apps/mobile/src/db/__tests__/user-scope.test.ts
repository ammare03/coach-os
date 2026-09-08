import { clearPersistedQueryCache } from '../../lib/query/persister.ts';
import { resetLocalDbForTests } from '../client.ts';
import { ensureLocalDatabaseBelongsTo } from '../user-scope.ts';
import { wipeLocalDatabase } from '../wipe.ts';

// `wipeLocalDatabase` and `clearPersistedQueryCache` are already covered by
// their own test files (`wipe.test.ts`, `persister.ts`'s own tests) — this
// file's concern is the composition: which of the three outcomes
// `ensureLocalDatabaseBelongsTo` picks, and in what order it calls them,
// same philosophy as `useSignOut.test.ts`. The `meta` table itself is a
// hand-rolled in-memory fake, same shape as `schema-version.test.ts`'s.

jest.mock('../wipe.ts', () => ({ wipeLocalDatabase: jest.fn() }));
jest.mock('../../lib/query/persister.ts', () => ({ clearPersistedQueryCache: jest.fn() }));

jest.mock('expo-sqlite', () => {
  const metaStore = new Map<string, string>();

  function makeResult(rows: unknown[]) {
    return { changes: 0, lastInsertRowId: 0, getFirstSync: () => rows[0], getAllSync: () => rows };
  }

  const database = {
    prepareSync: jest.fn((sqlText: string) => ({
      executeSync: (params: unknown[] = []) => {
        if (/^CREATE TABLE/i.test(sqlText) || /^CREATE INDEX/i.test(sqlText)) {
          return makeResult([]);
        }
        if (/^SELECT value FROM meta/i.test(sqlText)) {
          const key = params[0] as string;
          const value = metaStore.get(key);
          return makeResult(value === undefined ? [] : [{ value }]);
        }
        if (/^INSERT INTO meta/i.test(sqlText)) {
          const [key, value] = params as [string, string];
          metaStore.set(key, value);
          return makeResult([{ key, value }]);
        }
        throw new Error(`Unhandled SQL in fake expo-sqlite: ${sqlText}`);
      },
    })),
  };

  return {
    openDatabaseAsync: jest.fn(async () => database),
    __setStoredUserId: (id: string | undefined) => {
      if (id === undefined) {
        metaStore.delete('user_id');
      } else {
        metaStore.set('user_id', id);
      }
    },
    __getStoredUserId: () => metaStore.get('user_id'),
  };
});

const sqliteFake = jest.requireMock('expo-sqlite') as {
  openDatabaseAsync: jest.Mock;
  __setStoredUserId: (id: string | undefined) => void;
  __getStoredUserId: () => string | undefined;
};

const mockWipeLocalDatabase = wipeLocalDatabase as jest.Mock;
const mockClearPersistedQueryCache = clearPersistedQueryCache as jest.Mock;

beforeEach(() => {
  resetLocalDbForTests();
  sqliteFake.openDatabaseAsync.mockClear();
  sqliteFake.__setStoredUserId(undefined);
  mockWipeLocalDatabase.mockReset().mockResolvedValue({ outcome: 'wiped' });
  mockClearPersistedQueryCache.mockReset().mockResolvedValue(undefined);
});

describe('ensureLocalDatabaseBelongsTo', () => {
  it('claims the database for the first user when there is no stored owner', async () => {
    const result = await ensureLocalDatabaseBelongsTo('user-a');

    expect(result).toEqual({ outcome: 'claimed' });
    expect(mockWipeLocalDatabase).not.toHaveBeenCalled();
    expect(mockClearPersistedQueryCache).not.toHaveBeenCalled();
    expect(sqliteFake.__getStoredUserId()).toBe('user-a');
  });

  it('does nothing when the same user signs in again', async () => {
    sqliteFake.__setStoredUserId('user-a');

    const result = await ensureLocalDatabaseBelongsTo('user-a');

    expect(result).toEqual({ outcome: 'same-user' });
    expect(mockWipeLocalDatabase).not.toHaveBeenCalled();
    expect(mockClearPersistedQueryCache).not.toHaveBeenCalled();
    expect(sqliteFake.__getStoredUserId()).toBe('user-a');
  });

  it('force-wipes and reclaims the database when a different user signs in', async () => {
    sqliteFake.__setStoredUserId('user-a');

    const result = await ensureLocalDatabaseBelongsTo('user-b');

    expect(result).toEqual({ outcome: 'wiped' });
    expect(mockWipeLocalDatabase).toHaveBeenCalledWith({ force: true });
    expect(mockClearPersistedQueryCache).toHaveBeenCalledTimes(1);
    expect(sqliteFake.__getStoredUserId()).toBe('user-b');
  });

  it.each([
    ['blocked', { outcome: 'blocked', pendingCount: 2 }],
    ['failed', { outcome: 'failed', error: new Error('disk full') }],
  ])(
    'fails closed when the wipe reports %s: throws, never claims, never clears the query cache',
    async (_label, wipeResult) => {
      sqliteFake.__setStoredUserId('user-a');
      mockWipeLocalDatabase.mockResolvedValue(wipeResult);

      await expect(ensureLocalDatabaseBelongsTo('user-b')).rejects.toThrow();

      expect(mockClearPersistedQueryCache).not.toHaveBeenCalled();
      // The database still belongs to user-a — a failed wipe must not let
      // user-b's session claim it anyway.
      expect(sqliteFake.__getStoredUserId()).toBe('user-a');
    },
  );
});

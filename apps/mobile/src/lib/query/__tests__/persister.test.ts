import {
  persistQueryClientRestore,
  persistQueryClientSave,
} from '@tanstack/query-persist-client-core';
import type { Persister } from '@tanstack/query-persist-client-core';
import { QueryClient } from '@tanstack/react-query';

import { keys } from '../keys.ts';
import {
  clearPersistedQueryCache,
  createSQLitePersister,
  QUERY_CACHE_BUSTER,
  QUERY_CACHE_MAX_AGE_MS,
  resetQueryCacheForTests,
  shouldPersistQuery,
} from '../persister.ts';

// providers-and-gates/02's second acceptance criterion. The real
// `expo-sqlite` has no native side under Jest, so an in-memory table stands
// in for the file — the SQL, the serialisation, the throttle, the 24h window
// and the media exclusion are all still the real ones.

type FakeRows = Map<string, string>;

jest.mock('expo-sqlite', () => {
  const rows: FakeRows = new Map();
  const database = {
    execAsync: jest.fn(async () => undefined),
    runAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith('INSERT OR REPLACE')) {
        rows.set(String(params[0]), String(params[1]));
      } else if (sql.startsWith('DELETE FROM query_cache WHERE key')) {
        rows.delete(String(params[0]));
      } else if (sql.startsWith('DELETE FROM query_cache')) {
        rows.clear();
      }
      return { changes: 1, lastInsertRowId: 0 };
    }),
    getFirstAsync: jest.fn(async (_sql: string, params: unknown[] = []) => {
      const value = rows.get(String(params[0]));
      return value === undefined ? null : { value };
    }),
  };
  return {
    openDatabaseAsync: jest.fn(async () => database),
    __rows: rows,
    __database: database,
  };
});

const sqliteFake = jest.requireMock('expo-sqlite') as {
  __rows: FakeRows;
  __database: { runAsync: jest.Mock };
};

const CLIENT_ID = '0199a1f0-0000-7000-8000-000000000001';
const ASSET_ID = '0199a1f0-0000-7000-8000-000000000003';
const NOW = new Date('2026-08-15T09:00:00.000Z');
const THROTTLE_WINDOW_MS = 1_000;

let persister: Persister;

beforeEach(async () => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  sqliteFake.__rows.clear();
  resetQueryCacheForTests();
  persister = await createSQLitePersister();
});

afterEach(() => {
  jest.useRealTimers();
});

/**
 * `persistClient` is fire-and-forget by contract and coalesced over a
 * throttle window, so a save only reaches "disk" once that window passes.
 */
async function save(client: QueryClient): Promise<void> {
  await persistQueryClientSave({
    queryClient: client,
    persister,
    buster: QUERY_CACHE_BUSTER,
    dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
  });
  await jest.advanceTimersByTimeAsync(THROTTLE_WINDOW_MS);
}

async function restoreInto(client: QueryClient): Promise<void> {
  await persistQueryClientRestore({
    queryClient: client,
    persister,
    maxAge: QUERY_CACHE_MAX_AGE_MS,
    buster: QUERY_CACHE_BUSTER,
  });
}

describe('the SQLite query persister', () => {
  it('restores a cache written by a previous launch', async () => {
    const before = new QueryClient();
    before.setQueryData(keys.clients.detail(CLIENT_ID), { adherence: 82 });

    await save(before);
    const after = new QueryClient();
    await restoreInto(after);

    expect(after.getQueryData(keys.clients.detail(CLIENT_ID))).toEqual({ adherence: 82 });
  });

  it('restores a Date as a Date, not as a string', async () => {
    // superjson, not JSON — the tRPC link puts real Dates in the cache
    // (CLAUDE.md §3.2), and a Date that silently becomes a string only on
    // the second launch is the exact bug that choice prevents.
    const loggedAt = new Date('2026-08-14T19:00:00.000Z');
    const before = new QueryClient();
    before.setQueryData(keys.sessions.detail('s1'), { loggedAt });

    await save(before);
    const after = new QueryClient();
    await restoreInto(after);

    const restored = after.getQueryData<{ loggedAt: Date }>(keys.sessions.detail('s1'));

    expect(restored?.loggedAt).toBeInstanceOf(Date);
    expect(restored?.loggedAt).toEqual(loggedAt);
  });

  it('discards a cache older than the 24h window instead of showing it', async () => {
    const before = new QueryClient();
    before.setQueryData(keys.clients.detail(CLIENT_ID), { adherence: 82 });
    await save(before);

    jest.setSystemTime(new Date(NOW.getTime() + QUERY_CACHE_MAX_AGE_MS + 1));
    const after = new QueryClient();
    await restoreInto(after);

    expect(after.getQueryData(keys.clients.detail(CLIENT_ID))).toBeUndefined();
    expect(sqliteFake.__rows.size).toBe(0);
  });

  it('keeps a cache that is exactly on the window boundary', async () => {
    const before = new QueryClient();
    before.setQueryData(keys.clients.detail(CLIENT_ID), { adherence: 82 });
    await save(before);

    jest.setSystemTime(new Date(NOW.getTime() + QUERY_CACHE_MAX_AGE_MS));
    const after = new QueryClient();
    await restoreInto(after);

    expect(after.getQueryData(keys.clients.detail(CLIENT_ID))).toEqual({ adherence: 82 });
  });

  it('discards a cache written under a different buster', async () => {
    const before = new QueryClient();
    before.setQueryData(keys.clients.detail(CLIENT_ID), { adherence: 82 });
    await save(before);

    const after = new QueryClient();
    await persistQueryClientRestore({
      queryClient: after,
      persister,
      maxAge: QUERY_CACHE_MAX_AGE_MS,
      buster: 'a-later-payload-shape',
    });

    expect(after.getQueryData(keys.clients.detail(CLIENT_ID))).toBeUndefined();
  });

  it('never writes a media query to disk', async () => {
    // `offline-sync` §8 — a media payload is a signed R2 URL for §21.1
    // Sensitive data. It must not outlive the render, let alone the logout.
    const before = new QueryClient();
    before.setQueryData(keys.clients.list(), [{ id: CLIENT_ID }]);
    before.setQueryData(keys.media.detail(ASSET_ID), { playbackUrl: 'https://r2/signed?sig=x' });

    await save(before);
    const after = new QueryClient();
    await restoreInto(after);

    expect(after.getQueryData(keys.clients.list())).toEqual([{ id: CLIENT_ID }]);
    expect(after.getQueryData(keys.media.detail(ASSET_ID))).toBeUndefined();
    expect([...sqliteFake.__rows.values()].join()).not.toContain('r2/signed');
  });

  it('coalesces a burst of cache writes into one row write', async () => {
    // The logger mutates the cache on every set; one disk write per set is
    // JS-thread work §19's < 100ms budget cannot afford.
    const client = new QueryClient();
    sqliteFake.__database.runAsync.mockClear();

    for (let set = 0; set < 10; set += 1) {
      client.setQueryData(keys.sessions.detail('s1'), { sets: set });
      await persistQueryClientSave({ queryClient: client, persister, buster: QUERY_CACHE_BUSTER });
    }
    await jest.advanceTimersByTimeAsync(THROTTLE_WINDOW_MS);

    expect(sqliteFake.__database.runAsync).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(keys.sessions.detail('s1'))).toEqual({ sets: 9 });
  });

  it('starts clean rather than throwing when the stored row is unreadable', async () => {
    sqliteFake.__rows.set('react-query', 'not superjson');

    await expect(persister.restoreClient()).resolves.toBeUndefined();
  });

  it('wipes every row on logout', async () => {
    const before = new QueryClient();
    before.setQueryData(keys.clients.detail(CLIENT_ID), { adherence: 82 });
    await save(before);
    expect(sqliteFake.__rows.size).toBe(1);

    // `offline-sync` §8 — no user's data survives an account switch on a
    // shared device, and coaches do hand phones to clients.
    await clearPersistedQueryCache();

    expect(sqliteFake.__rows.size).toBe(0);
  });
});

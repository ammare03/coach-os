import { sql } from 'drizzle-orm';

import { getLocalDb, resetLocalDbForTests } from '../../db/client.ts';

import { buildMyFood } from './__fixtures__/history.ts';
import { DEFAULT_FOOD_CACHE_SIZE, prefetchFoods, writeFoodsCache } from './foods.ts';

type Row = Record<string, unknown>;

jest.mock('expo-sqlite', () => require('../outbox/__fixtures__/sqlite-fake.ts').createSqliteFake());

const sqliteFake = jest.requireMock('expo-sqlite') as { __reset: () => void };

async function readCache(): Promise<Row[]> {
  const db = await getLocalDb();
  return db.all<Row>(sql`SELECT * FROM local_foods_cache`);
}

beforeEach(() => {
  sqliteFake.__reset();
  resetLocalDbForTests();
});

describe('prefetchFoods', () => {
  it('asks the server for the 100 foods CLAUDE.md §11.2 names', async () => {
    const fetchMyFoods = jest.fn().mockResolvedValue([]);

    await prefetchFoods({ fetchMyFoods });

    expect(fetchMyFoods).toHaveBeenCalledWith({ limit: DEFAULT_FOOD_CACHE_SIZE });
    expect(DEFAULT_FOOD_CACHE_SIZE).toBe(100);
  });

  it('writes the macros and the identifiers offline food logging needs', async () => {
    const result = await prefetchFoods({
      fetchMyFoods: async () => [buildMyFood()],
    });

    expect(result).toMatchObject({ inserted: 1, updated: 0 });
    const rows = await readCache();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'food-1',
      name: 'Ragi Mudde',
      brand: null,
      barcode: '8901234567890',
      calories_per_100g: 132,
      protein_g: 3.2,
      carbs_g: 28.1,
      fat_g: 0.5,
      last_used_at: new Date('2026-08-14T07:30:00.000Z').getTime(),
    });
  });

  it("keeps the server's personal ordering — the client's own staple outranks a global row", async () => {
    const staple = buildMyFood({ id: 'staple', name: 'Ragi Mudde', logCount: 12 });
    const topUp = buildMyFood({
      id: 'top-up',
      name: 'Oats',
      ranking: 'global',
      logCount: 0,
      lastLoggedAt: null,
    });

    await prefetchFoods({ fetchMyFoods: async () => [staple, topUp] });

    const rows = await readCache();
    expect(rows.find((row) => row.id === 'staple')).toMatchObject({
      last_used_at: new Date('2026-08-14T07:30:00.000Z').getTime(),
    });
    // A global top-up row has no personal use behind it, so nothing may
    // claim it was used — it sorts last on the device for the same reason.
    expect(rows.find((row) => row.id === 'top-up')).toMatchObject({ last_used_at: null });
  });
});

describe('writeFoodsCache', () => {
  it('updates an already-cached food without duplicating it', async () => {
    const db = await getLocalDb();
    await writeFoodsCache(db, [buildMyFood()]);

    const result = await writeFoodsCache(db, [buildMyFood({ name: 'Ragi Mudde (steamed)' })]);

    expect(result).toEqual({ inserted: 0, updated: 1 });
    const rows = await readCache();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Ragi Mudde (steamed)' });
  });

  it('never moves last_used_at backwards past a use the device recorded', async () => {
    const db = await getLocalDb();
    await writeFoodsCache(db, [buildMyFood()]);
    // A meal logged offline since the last prefetch: the device knows
    // about a use the server does not.
    const loggedOffline = new Date('2026-08-20T06:00:00.000Z').getTime();
    db.run(sql`UPDATE local_foods_cache SET last_used_at = ${loggedOffline}`);

    await writeFoodsCache(db, [buildMyFood()]);

    expect((await readCache())[0]).toMatchObject({ last_used_at: loggedOffline });
  });

  it('advances last_used_at when the server knows about a newer use', async () => {
    const db = await getLocalDb();
    await writeFoodsCache(db, [buildMyFood()]);
    const onAnotherDevice = new Date('2026-08-25T06:00:00.000Z');

    await writeFoodsCache(db, [buildMyFood({ lastLoggedAt: onAnotherDevice })]);

    expect((await readCache())[0]).toMatchObject({ last_used_at: onAnotherDevice.getTime() });
  });

  it('leaves a cached last_used_at alone when the server reports none', async () => {
    const db = await getLocalDb();
    await writeFoodsCache(db, [buildMyFood()]);
    const known = new Date('2026-08-14T07:30:00.000Z').getTime();

    await writeFoodsCache(db, [buildMyFood({ lastLoggedAt: null })]);

    expect((await readCache())[0]).toMatchObject({ last_used_at: known });
  });

  it('writes nothing when there is nothing to cache', async () => {
    const db = await getLocalDb();

    expect(await writeFoodsCache(db, [])).toEqual({ inserted: 0, updated: 0 });
    expect(await readCache()).toHaveLength(0);
  });
});

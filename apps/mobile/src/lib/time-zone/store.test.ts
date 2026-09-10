import { sql } from 'drizzle-orm';

import { getLocalDb, resetLocalDbForTests } from '../../db/client.ts';

import {
  CLIENT_TIME_ZONE_META_KEY,
  ensureClientTimeZoneHydrated,
  publishClientTimeZone,
  resetClientTimeZoneForTests,
  resolveClientTimeZone,
  resolveDeviceTimeZone,
} from './store.ts';

jest.mock('expo-sqlite', () => require('../outbox/__fixtures__/sqlite-fake.ts').createSqliteFake());

const sqliteFake = jest.requireMock('expo-sqlite') as { __reset: () => void };

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

async function storedRow(): Promise<string | null> {
  const db = await getLocalDb();
  const row = db.get<{ value: string | null }>(
    sql`SELECT value FROM meta WHERE key = ${CLIENT_TIME_ZONE_META_KEY}`,
  );
  return row?.value ?? null;
}

beforeEach(() => {
  sqliteFake.__reset();
  resetLocalDbForTests();
  resetClientTimeZoneForTests();
});

afterEach(() => {
  resetClientTimeZoneForTests();
});

describe('the one client-timezone resolver', () => {
  it('falls back to the device zone until something has resolved the stored one', () => {
    expect(resolveClientTimeZone()).toBe(resolveDeviceTimeZone());
  });

  it('answers with the published zone, synchronously, for background callers', () => {
    publishClientTimeZone('Asia/Kolkata');

    expect(resolveClientTimeZone()).toBe('Asia/Kolkata');
  });

  it('persists the published zone so the next cold start starts from it', async () => {
    publishClientTimeZone('America/New_York');
    await settle();

    expect(await storedRow()).toBe('America/New_York');

    // A fresh app run: nothing in memory, the row still on disk.
    resetClientTimeZoneForTests();
    expect(resolveClientTimeZone()).toBe(resolveDeviceTimeZone());

    await expect(ensureClientTimeZoneHydrated()).resolves.toBe('America/New_York');
    expect(resolveClientTimeZone()).toBe('America/New_York');
  });

  it('never lets the persisted copy overwrite a freshly published one', async () => {
    publishClientTimeZone('America/New_York');
    await settle();
    resetClientTimeZoneForTests();

    publishClientTimeZone('Europe/Berlin');
    await expect(ensureClientTimeZoneHydrated()).resolves.toBe('Europe/Berlin');
  });

  it('resolves to the device zone rather than rejecting when nothing has been stored', async () => {
    await expect(ensureClientTimeZoneHydrated()).resolves.toBe(resolveDeviceTimeZone());
  });

  it('forgets the zone on a sign-out, so the next user does not inherit it', async () => {
    publishClientTimeZone('Asia/Kolkata');
    await settle();

    resetClientTimeZoneForTests();

    expect(resolveClientTimeZone()).toBe(resolveDeviceTimeZone());
  });
});

import { LIGHT_SCHEME_AVAILABLE, type Scheme } from '@coachos/ui';
import { act, renderHook } from '@testing-library/react-native';
import { eq } from 'drizzle-orm';

import { getLocalDb, resetLocalDbForTests } from '../../../../db/client.ts';
import { meta } from '../../../../db/schema/sync.ts';
import {
  APPEARANCE_META_KEY,
  DEFAULT_SCHEME,
  ensureAppearanceLoaded,
  flushAppearanceWrites,
  isAvailableScheme,
  parseScheme,
  resetAppearanceForTests,
  setScheme,
  useAppearance,
} from '../useAppearance.ts';

// `settings-shell/03`. Four things have to be true, and three of them are
// ways a user could end up looking at the undesigned light fallback:
//
// 1. Dark is the value from the first render, before the read resolves, and
//    the provider is never handed `undefined` or a non-`Scheme` in between.
// 2. A stored value applies once the read lands, and `isReady` flips with it.
// 3. `'light'` is refused — at the READ, so a row written by a future build
//    cannot come back, and at the STORE, so a deep link or a fixture cannot
//    put someone there.
// 4. The preference goes with the mirror at sign-out and the next read
//    starts dark. That is the chosen behaviour, and this is where it is
//    written down.

// `expo-sqlite` has no Jest-side native module — the same fake `lib/outbox`
// maintains, for the same reason as `rest-timer-persistence.test.ts`.
jest.mock('expo-sqlite', () =>
  require('../../../../lib/outbox/__fixtures__/sqlite-fake.ts').createSqliteFake(),
);

const sqlite = jest.requireMock('expo-sqlite') as { __reset: () => void };

beforeEach(() => {
  sqlite.__reset();
  resetLocalDbForTests();
  resetAppearanceForTests();
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function seedStoredScheme(value: string): Promise<void> {
  const db = await getLocalDb();
  await db
    .insert(meta)
    .values({ key: APPEARANCE_META_KEY, value })
    .onConflictDoUpdate({ target: meta.key, set: { value } });
}

async function readStoredRow(): Promise<string | null | undefined> {
  const db = await getLocalDb();
  const [row] = await db
    .select({ value: meta.value })
    .from(meta)
    .where(eq(meta.key, APPEARANCE_META_KEY))
    .limit(1);
  return row?.value;
}

function isScheme(value: unknown): value is Scheme {
  return value === 'dark' || value === 'light';
}

describe('useAppearance — dark on the first frame, always', () => {
  it('is dark and not-ready before the read resolves', async () => {
    const { result } = renderHook(() => useAppearance());

    expect(result.current.scheme).toBe('dark');
    expect(result.current.isReady).toBe(false);

    // Drain the read the mount started, so its state update lands inside
    // this test rather than warning from the next one.
    await act(async () => {
      await ensureAppearanceLoaded();
    });
  });

  it('never hands the provider undefined or a non-Scheme while the read is pending', async () => {
    await seedStoredScheme('dark');
    const seen: unknown[] = [];

    const { result } = renderHook(() => {
      const appearance = useAppearance();
      seen.push(appearance.scheme);
      return appearance;
    });

    // The pending window: every value the provider could have been handed
    // between mount and the read landing.
    expect(seen.length).toBeGreaterThan(0);
    for (const value of seen) {
      expect(value).toBeDefined();
      expect(isScheme(value)).toBe(true);
    }

    await act(async () => {
      await ensureAppearanceLoaded();
    });

    expect(result.current.scheme).toBe('dark');
    for (const value of seen) {
      expect(isScheme(value)).toBe(true);
    }
  });

  it('applies the stored value and flips isReady once the read lands', async () => {
    await seedStoredScheme('dark');
    const { result } = renderHook(() => useAppearance());

    await act(async () => {
      await ensureAppearanceLoaded();
    });

    expect(result.current.scheme).toBe('dark');
    expect(result.current.isReady).toBe(true);
  });

  it('is dark with no stored row at all — an absent preference is not an error', async () => {
    const { result } = renderHook(() => useAppearance());

    await act(async () => {
      await ensureAppearanceLoaded();
    });

    expect(result.current.scheme).toBe(DEFAULT_SCHEME);
    expect(result.current.isReady).toBe(true);
  });

  it('reads once per process however many consumers mount', async () => {
    await seedStoredScheme('dark');
    const db = await getLocalDb();
    const select = jest.spyOn(db, 'select');

    renderHook(() => useAppearance());
    renderHook(() => useAppearance());
    await act(async () => {
      await ensureAppearanceLoaded();
      await ensureAppearanceLoaded();
    });

    expect(select).toHaveBeenCalledTimes(1);
  });
});

describe('useAppearance — a corrupt value falls back to dark, silently', () => {
  it.each(['', 'neon', 'DARK', '{"scheme":"dark"}', 'system'])(
    'ignores a stored %p',
    async (stored) => {
      await seedStoredScheme(stored);

      await expect(ensureAppearanceLoaded()).resolves.toBe('dark');
    },
  );

  it('falls back to dark rather than throwing when the mirror will not answer', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const db = await getLocalDb();
    jest.spyOn(db, 'select').mockImplementation(() => {
      throw new Error('database is locked');
    });

    await expect(ensureAppearanceLoaded()).resolves.toBe('dark');
  });
});

describe("useAppearance — 'light' is refused while LIGHT_SCHEME_AVAILABLE is false", () => {
  it('is the flag this build actually ships', () => {
    // The guard below only means anything while this is false. When
    // `light-scheme/02` flips it, this test is the one that says so.
    expect(LIGHT_SCHEME_AVAILABLE).toBe(false);
  });

  it('refuses it at the read — a row a future build wrote cannot come back', async () => {
    await seedStoredScheme('light');

    await expect(ensureAppearanceLoaded()).resolves.toBe('dark');
  });

  it('refuses it at the store, so a deep link or a fixture cannot get there either', async () => {
    const { result } = renderHook(() => useAppearance());
    await act(async () => {
      await ensureAppearanceLoaded();
    });

    act(() => {
      result.current.setScheme('light');
    });
    await flushAppearanceWrites();

    expect(result.current.scheme).toBe('dark');
    // And nothing was written: a refused setter must not leave a row that a
    // later build with the flag on would read back as a real preference.
    expect(await readStoredRow()).toBeUndefined();
  });

  it('agrees with itself about what is selectable', () => {
    expect(isAvailableScheme('dark')).toBe(true);
    expect(isAvailableScheme('light')).toBe(LIGHT_SCHEME_AVAILABLE);
    expect(isAvailableScheme('system')).toBe(false);
    expect(isAvailableScheme(undefined)).toBe(false);
    expect(parseScheme('light')).toBe('dark');
  });
});

describe('useAppearance — writing through', () => {
  it('persists the selection, and a cold start reads it back', async () => {
    await ensureAppearanceLoaded();
    expect(await readStoredRow()).toBeUndefined();

    setScheme('dark');
    await flushAppearanceWrites();

    expect(await readStoredRow()).toBe('dark');

    // The cold start: forget the memoised read and the applied scheme, keep
    // the mirror.
    resetAppearanceForTests();
    await expect(ensureAppearanceLoaded()).resolves.toBe('dark');
  });

  it('records the choice even when it changes nothing on screen', async () => {
    await ensureAppearanceLoaded();

    // Dark is already in effect. Choosing it is still a choice, and once
    // Light exists it is the one that has to survive a relaunch.
    setScheme('dark');
    await flushAppearanceWrites();

    expect(await readStoredRow()).toBe('dark');
  });

  it('overwrites rather than accumulating — one row, not a history', async () => {
    await seedStoredScheme('neon');
    await ensureAppearanceLoaded();

    setScheme('dark');
    setScheme('dark');
    await flushAppearanceWrites();

    const db = await getLocalDb();
    const rows = await db
      .select({ value: meta.value })
      .from(meta)
      .where(eq(meta.key, APPEARANCE_META_KEY));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe('dark');
  });
});

describe('useAppearance — sign-out takes the preference with the mirror', () => {
  it('starts dark on the next sign-in, which is the chosen behaviour', async () => {
    await ensureAppearanceLoaded();
    setScheme('dark');
    await flushAppearanceWrites();
    expect(await readStoredRow()).toBe('dark');

    // `local-database/03` deletes the file at sign-out; the fake's reset is
    // the same outcome — the row is gone, not emptied.
    sqlite.__reset();
    resetLocalDbForTests();
    resetAppearanceForTests();

    expect(await readStoredRow()).toBeUndefined();
    await expect(ensureAppearanceLoaded()).resolves.toBe(DEFAULT_SCHEME);
  });
});

import { getLocalDb } from '../../../../db/client.ts';
import { meta } from '../../../../db/schema/sync.ts';
import { loggerPositionKey, readLoggerPosition, writeLoggerPosition } from '../logger-position.ts';

// `expo-sqlite` has no Jest-side native module, so the whole local database
// runs against the fake `lib/outbox` already maintains — same mock, same
// reason, as `useLoggerSession.test.ts`.
jest.mock('expo-sqlite', () =>
  require('../../../../lib/outbox/__fixtures__/sqlite-fake.ts').createSqliteFake(),
);

// Every test uses its own session id rather than clearing the table between
// runs: the fake implements INSERT / UPDATE / SELECT and no DELETE, and a
// per-test key is a truer model of the real thing anyway — sessions never
// share a row.
let counter = 0;
function nextSession(): string {
  counter += 1;
  return `local-session-${String(counter)}`;
}

describe('loggerPositionKey', () => {
  it('namespaces the key per session, so two sessions never share a position', () => {
    expect(loggerPositionKey('a')).not.toBe(loggerPositionKey('b'));
    expect(loggerPositionKey('local-1')).toContain('local-1');
  });
});

describe('writeLoggerPosition / readLoggerPosition', () => {
  it('round-trips an index', async () => {
    const db = await getLocalDb();
    const session = nextSession();

    await writeLoggerPosition(db, session, 3);

    await expect(readLoggerPosition(db, session)).resolves.toBe(3);
  });

  it('overwrites rather than appending, so one session has one position', async () => {
    const db = await getLocalDb();
    const session = nextSession();

    await writeLoggerPosition(db, session, 1);
    await writeLoggerPosition(db, session, 4);

    await expect(readLoggerPosition(db, session)).resolves.toBe(4);
  });

  it('keeps two sessions apart', async () => {
    const db = await getLocalDb();
    const a = nextSession();
    const b = nextSession();

    await writeLoggerPosition(db, a, 1);
    await writeLoggerPosition(db, b, 5);

    await expect(readLoggerPosition(db, a)).resolves.toBe(1);
    await expect(readLoggerPosition(db, b)).resolves.toBe(5);
  });

  it('reads null for a session that has never been paged', async () => {
    const db = await getLocalDb();

    await expect(readLoggerPosition(db, nextSession())).resolves.toBeNull();
  });

  it('degrades a corrupted value to null rather than throwing', async () => {
    // A bad cache row must not be able to take the logger down —
    // `db/schema-version.ts` treats a malformed `meta` value the same way.
    const db = await getLocalDb();
    const session = nextSession();
    await db.insert(meta).values({ key: loggerPositionKey(session), value: 'not a number' });

    await expect(readLoggerPosition(db, session)).resolves.toBeNull();
  });

  it('degrades a negative value to null', async () => {
    const db = await getLocalDb();
    const session = nextSession();
    await db.insert(meta).values({ key: loggerPositionKey(session), value: '-1' });

    await expect(readLoggerPosition(db, session)).resolves.toBeNull();
  });
});

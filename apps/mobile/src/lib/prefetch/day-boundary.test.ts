import { addCalendarDays, localDateRangeUtc, toLocalDate, type CalendarDate } from '@coachos/utils';
import type { ClientHistory } from 'api/src/features/clientApp/history.ts';
import type { UpcomingWorkouts } from 'api/src/features/workouts/upcoming.ts';
import { sql } from 'drizzle-orm';

import { getLocalDb, resetLocalDbForTests } from '../../db/client.ts';
import { useAuthStore } from '../../features/auth/store.ts';
import { resetConnectivityForTests, useConnectivityStore } from '../connectivity/store.ts';
import {
  publishClientTimeZone,
  resetClientTimeZoneForTests,
  resolveDeviceTimeZone,
} from '../time-zone/store.ts';

import { buildHistorySession } from './__fixtures__/history.ts';
import {
  buildBlock,
  buildContext,
  buildDayContext,
  buildExercise,
  buildSession,
} from './__fixtures__/upcoming.ts';
import { runPrefetch, resetPrefetchSchedulerForTests } from './scheduler.ts';
import { readSessionPayload } from './sessions.ts';

// `docs/UNFORGET.md` S32, from the writer's side: `./sessions.ts` and
// `./history.ts` put DIFFERENT shapes into the one
// `local_workout_sessions.payload_json` column and divide it by date, and
// each used to compute that date from its own `new Date()` and its own
// zone. This suite drives the real scheduler over both real writers and a
// real (faked-native) SQLite, and asserts the only thing that matters
// downstream: the row on the client's own today still parses as
// `{ session, exercises }` — the prescription the Today card and the logger
// render.
//
// Nothing here asserts on which prefetcher "won". The reader-side
// degradation (`readSessionPayload`, commit `1ce8228`) stays as defence in
// depth; this is the writer no longer needing it.

jest.mock('expo-sqlite', () => require('../outbox/__fixtures__/sqlite-fake.ts').createSqliteFake());

// The scheduler reaches the radio through `ensureConnectivityTracking()`;
// connectivity is driven through the store directly below.
jest.mock('expo-network', () => ({
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
  getNetworkStateAsync: jest.fn(() => new Promise(() => {})),
}));

// The one seam: the network. Every writer, every local write, and the day
// boundary itself are the real code.
jest.mock('./trpc-client.ts', () => ({
  prefetchQuery: jest.fn(),
  resetPrefetchStateForTests: jest.fn(),
}));

const sqliteFake = jest.requireMock('expo-sqlite') as { __reset: () => void };
const network = jest.requireMock('./trpc-client.ts') as { prefetchQuery: jest.Mock };

/** What the server answers `workouts.upcoming` with: a session on the first day of the range. */
function upcomingFor(range: { from: CalendarDate; to: CalendarDate }): UpcomingWorkouts {
  return {
    sessions: [
      buildSession({
        id: `session-${range.from}`,
        clientLocalId: `local-${range.from}`,
        scheduledDate: range.from,
        exercises: [buildBlock({ exerciseId: 'exercise-1', orderIndex: 1, targetSets: 4 })],
      }),
    ],
    exercises: [buildExercise({ id: 'exercise-1' })],
    context: buildContext({
      days: [buildDayContext({ date: range.from }), buildDayContext({ date: range.to })],
    }),
  };
}

/**
 * What the server answers `clientApp.history` with. Its range ends at the
 * caller's *today*, so today's session is always in the response — the
 * client-side guard is the only thing that keeps it out of the row, which
 * is precisely why the boundary the guard is given has to be the same one
 * the sessions prefetch used.
 */
function historyFor(range: { from: CalendarDate; to: CalendarDate }): ClientHistory {
  return {
    sessions: [range.to, addCalendarDays(range.to, -1)].map((date) =>
      buildHistorySession({
        id: `session-${date}`,
        clientLocalId: `local-${date}`,
        scheduledDate: date,
        setLogs: [],
      }),
    ),
    meals: [],
    comments: [],
  };
}

/** Runs when the pass reaches the foods step — the seam between sessions and history. */
let onFoodsStep: () => void = () => {};

async function payloadOn(date: CalendarDate): Promise<string | null> {
  const db = await getLocalDb();
  const row = db.get<{ payload_json: string }>(
    sql`SELECT payload_json FROM local_workout_sessions WHERE scheduled_date = ${date}`,
  );
  return row?.payload_json ?? null;
}

/** `null` when nothing was written, or when what was written is not a prescription. */
async function prescriptionOn(date: CalendarDate) {
  const payloadJson = await payloadOn(date);
  return payloadJson === null ? null : readSessionPayload(payloadJson);
}

beforeEach(() => {
  sqliteFake.__reset();
  resetLocalDbForTests();
  resetClientTimeZoneForTests();
  onFoodsStep = () => {};

  network.prefetchQuery.mockReset().mockImplementation(async (path: string, input: unknown) => {
    if (path === 'workouts.upcoming')
      return upcomingFor(input as { from: CalendarDate; to: CalendarDate });
    if (path === 'clientApp.history')
      return historyFor(input as { from: CalendarDate; to: CalendarDate });
    if (path === 'nutrition.myFoods') {
      onFoodsStep();
      return [];
    }
    throw new Error(`unexpected prefetch path: ${path}`);
  });

  useConnectivityStore.setState({ isConnected: true });
  useAuthStore.getState().setAuthenticated({
    userId: 'user-1',
    role: 'client',
    isOnboarded: true,
  });
});

afterEach(() => {
  jest.useRealTimers();
  resetPrefetchSchedulerForTests();
  resetConnectivityForTests();
  resetClientTimeZoneForTests();
  useAuthStore.getState().setSignedOut();
});

describe('the two prefetchers never disagree about which day is today', () => {
  it("keeps the prescription when the pass straddles the client's local midnight", async () => {
    // 23:59:59.5 in Kolkata on the 14th. The pass is sequential, so the
    // history step lands at 00:00:01 on the 15th — one second later, one
    // calendar day on, and every date it derives is off by one.
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-08-14T18:29:59.500Z'));
    onFoodsStep = () => jest.setSystemTime(new Date('2026-08-14T18:30:01.000Z'));
    publishClientTimeZone('Asia/Kolkata');

    await runPrefetch();

    expect(await prescriptionOn('2026-08-14')).not.toBeNull();
  });

  it("resolves today from the client's stored zone, not the device's", async () => {
    // A client whose profile says one zone while the phone in their hand
    // says another — a traveller, or anyone who has edited their profile.
    // `Etc/GMT+12` is UTC-12, behind every inhabited zone, so at half past
    // local midnight on the device it is still yesterday there.
    const deviceZone = resolveDeviceTimeZone();
    const deviceToday = toLocalDate(new Date('2026-08-15T12:00:00.000Z'), deviceZone);
    const now = new Date(localDateRangeUtc(deviceToday, deviceZone).start.getTime() + 30 * 60_000);
    const storedZone = 'Etc/GMT+12';
    const storedToday = toLocalDate(now, storedZone);

    // Stated rather than assumed: without this the test could pass by
    // agreeing with the device instead of by using the stored zone.
    expect(storedToday).toBe(addCalendarDays(deviceToday, -1));

    publishClientTimeZone(storedZone);

    await runPrefetch({ now });

    expect(await prescriptionOn(storedToday)).not.toBeNull();
  });
});

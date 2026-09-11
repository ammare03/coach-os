import { getLocalDb } from '../../../../db/client.ts';
import { localWorkoutSessions } from '../../../../db/schema/local-training.ts';
import {
  checkForInProgressSession,
  decideRecovery,
  SESSION_RESUME_WINDOW_MS,
  type RecoverableSessionRow,
} from '../session-recovery.ts';

// `expo-sqlite` has no Jest-side native module, so the local database runs
// against the fake `lib/outbox` maintains — same mock, same reason, as
// `logger-position.test.ts` and `useLoggerSession.test.ts`.
jest.mock('expo-sqlite', () =>
  require('../../../../lib/outbox/__fixtures__/sqlite-fake.ts').createSqliteFake(),
);

const NOW = new Date('2026-09-11T18:00:00.000Z');
const HOUR_MS = 60 * 60 * 1_000;

function row(overrides: Partial<RecoverableSessionRow> = {}): RecoverableSessionRow {
  return {
    clientLocalId: 'local-1',
    status: 'in_progress',
    startedAt: NOW.getTime() - HOUR_MS,
    ...overrides,
  };
}

describe('SESSION_RESUME_WINDOW_MS', () => {
  it('is DB§14.5’s six-hour claim ceiling, not a second threshold', () => {
    // Pinned rather than imported: `apps/api/src/features/workouts/claim.ts`
    // exports the same number as `CLAIM_CEILING_MS` but pulls in
    // `@coachos/db`, which cannot cross into the Metro bundle. Two
    // disagreeing answers to "is this session still live" is the bug this
    // assertion exists to prevent (`session-recovery.ts` rule (b)).
    expect(SESSION_RESUME_WINDOW_MS).toBe(6 * 60 * 60 * 1_000);
  });
});

describe('decideRecovery', () => {
  it('resumes a session started minutes ago — the app-kill case itself', () => {
    const recovery = decideRecovery([row({ startedAt: NOW.getTime() - 90_000 })], NOW);

    expect(recovery).toEqual({
      kind: 'resume',
      sessionLocalId: 'local-1',
      startedAt: new Date(NOW.getTime() - 90_000),
    });
  });

  it('finds nothing when the device holds no open session', () => {
    expect(decideRecovery([], NOW)).toEqual({ kind: 'none' });
  });

  it('ignores a scheduled, completed, or skipped session', () => {
    const rows = [
      row({ clientLocalId: 'a', status: 'scheduled' }),
      row({ clientLocalId: 'b', status: 'completed' }),
      row({ clientLocalId: 'c', status: 'skipped' }),
    ];

    expect(decideRecovery(rows, NOW)).toEqual({ kind: 'none' });
  });

  it('ignores an in-progress row that carries no started_at', () => {
    // The pairing `summariseLoggerSession` already reports as not in
    // progress; a third opinion here would put a clock on screen counting
    // from the epoch (rule (d)).
    expect(decideRecovery([row({ startedAt: null })], NOW)).toEqual({ kind: 'none' });
  });

  it('resumes right up to the six-hour boundary', () => {
    const startedAt = NOW.getTime() - SESSION_RESUME_WINDOW_MS;

    expect(decideRecovery([row({ startedAt })], NOW).kind).toBe('resume');
  });

  it('reports a session older than the window as stale rather than resuming it', () => {
    const startedAt = NOW.getTime() - SESSION_RESUME_WINDOW_MS - 1_000;

    expect(decideRecovery([row({ startedAt })], NOW)).toEqual({
      kind: 'stale',
      sessionLocalId: 'local-1',
      startedAt: new Date(startedAt),
    });
  });

  it('reports a session abandoned days ago as stale, and does not discard it', () => {
    // Rule (c): the row keeps every set and its position, Today still
    // offers Continue, and the only thing withheld is the app choosing a
    // fullscreen focus mode nobody asked for on every launch.
    const startedAt = NOW.getTime() - 4 * 24 * HOUR_MS;
    const rows = [row({ startedAt })];

    expect(decideRecovery(rows, NOW).kind).toBe('stale');
    expect(rows[0]).toEqual(row({ startedAt }));
  });

  it('resumes a session whose start is in the future, rather than ageing the skew', () => {
    // A device whose clock moved backwards is still a device the client is
    // standing in a gym holding.
    const startedAt = NOW.getTime() + HOUR_MS;

    expect(decideRecovery([row({ startedAt })], NOW).kind).toBe('resume');
  });

  it('picks the most recently started when two sessions are somehow open', () => {
    const rows = [
      row({ clientLocalId: 'older', startedAt: NOW.getTime() - 3 * HOUR_MS }),
      row({ clientLocalId: 'newer', startedAt: NOW.getTime() - HOUR_MS }),
    ];

    expect(decideRecovery(rows, NOW)).toMatchObject({
      kind: 'resume',
      sessionLocalId: 'newer',
    });
    // Order of the rows must not decide it.
    expect(decideRecovery([...rows].reverse(), NOW)).toMatchObject({
      sessionLocalId: 'newer',
    });
  });
});

describe('checkForInProgressSession', () => {
  // Every test takes its own session id: the fake implements INSERT /
  // UPDATE / SELECT and no DELETE, and per-test ids are a truer model
  // anyway, since sessions never share a row.
  let counter = 0;
  function nextSession(): string {
    counter += 1;
    return `recovery-session-${String(counter)}`;
  }

  async function seed(overrides: {
    clientLocalId: string;
    status: string;
    startedAt: number | null;
  }) {
    const db = await getLocalDb();
    await db.insert(localWorkoutSessions).values({
      id: overrides.clientLocalId,
      clientLocalId: overrides.clientLocalId,
      serverId: null,
      scheduledDate: '2026-09-11',
      programDayId: null,
      name: null,
      status: overrides.status,
      startedAt: overrides.startedAt,
      completedAt: null,
      payloadJson: '{}',
      startOutboxId: null,
      syncState: 'pending',
      updatedAt: NOW.getTime(),
    });
  }

  it('reads the open session straight out of the local mirror, with no network', async () => {
    const session = nextSession();
    await seed({
      clientLocalId: session,
      status: 'in_progress',
      startedAt: NOW.getTime() - 5 * 60_000,
    });

    await expect(checkForInProgressSession({ now: () => NOW })).resolves.toMatchObject({
      kind: 'resume',
      sessionLocalId: session,
    });
  });

  it('does not return a session the client already finished', async () => {
    const session = nextSession();
    await seed({ clientLocalId: session, status: 'completed', startedAt: NOW.getTime() });

    const recovery = await checkForInProgressSession({ now: () => NOW });

    expect(recovery.kind === 'none' || recovery.sessionLocalId !== session).toBe(true);
  });
});

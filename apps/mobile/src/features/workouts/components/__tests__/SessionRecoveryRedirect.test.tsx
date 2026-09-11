import { render, waitFor } from '@testing-library/react-native';

import { useAuthStore } from '../../../auth/store.ts';
import { LOGGER_ROUTE, type SessionRecovery } from '../../lib/session-recovery.ts';
import { SessionRecoveryRedirect } from '../SessionRecoveryRedirect.tsx';

const mockPush = jest.fn();
const mockReplace = jest.fn();
/** Rule (f)'s restore. Injected everywhere so no test opens the real mirror. */
const mockRestoreRest = jest.fn<Promise<unknown>, []>(() => Promise.resolve({ kind: 'none' }));
let mockNavigationKey: string | undefined = 'root';

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
  },
  useRootNavigationState: () =>
    mockNavigationKey === undefined ? undefined : { key: mockNavigationKey },
}));

// What is tested here is the gate, not the rule: `lib/session-recovery.ts`
// owns which session is recoverable and has its own tests. This file covers
// the four reasons the app must NOT navigate, and the one time it must.

const RESUME: SessionRecovery = {
  kind: 'resume',
  sessionLocalId: 'local-7',
  startedAt: new Date('2026-09-11T17:00:00.000Z'),
};

function signIn(overrides: Partial<Parameters<typeof useAuthStore.setState>[0]> = {}) {
  useAuthStore.setState({
    status: 'authenticated',
    userId: 'user-1',
    role: 'client',
    isOnboarded: true,
    ...overrides,
  });
}

beforeEach(() => {
  mockPush.mockClear();
  mockReplace.mockClear();
  mockRestoreRest.mockClear();
  mockNavigationKey = 'root';
  useAuthStore.setState({ status: 'loading', userId: null, role: null, isOnboarded: false });
});

describe('SessionRecoveryRedirect', () => {
  it('re-enters the session with no prompt and no client action', async () => {
    // §8.4's criterion: recovery happens automatically on app start.
    signIn();

    render(
      <SessionRecoveryRedirect
        isLocalDatabaseReady
        restoreRestTimer={mockRestoreRest}
        check={() => Promise.resolve(RESUME)}
      />,
    );

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith({
        pathname: LOGGER_ROUTE,
        params: { sessionId: 'local-7' },
      });
    });
    // `push`, not `replace`: the logger's exit prefers `router.back()` and
    // an emptied history would send it down the fallback branch.
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('navigates nowhere when nothing is in progress', async () => {
    signIn();
    const check = jest.fn<Promise<SessionRecovery>, []>(() => Promise.resolve({ kind: 'none' }));

    render(
      <SessionRecoveryRedirect
        isLocalDatabaseReady
        restoreRestTimer={mockRestoreRest}
        check={check}
      />,
    );

    await waitFor(() => {
      expect(check).toHaveBeenCalled();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('navigates nowhere for a stale session, and does not discard it', async () => {
    // The deliberate decision (`session-recovery.ts` rule (c)): the row is
    // untouched and Today still offers Continue. The only thing withheld is
    // the app choosing a focus mode on every launch for a workout the
    // client walked away from days ago.
    signIn();

    render(
      <SessionRecoveryRedirect
        isLocalDatabaseReady
        restoreRestTimer={mockRestoreRest}
        check={() =>
          Promise.resolve({ kind: 'stale', sessionLocalId: 'local-9', startedAt: new Date(0) })
        }
      />,
    );

    await waitFor(() => {
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  it('does not read the mirror until the schema-version check has answered', async () => {
    // `local-database/04` may drop and re-fetch the whole file; a read that
    // beat it would resume into a row about to be discarded.
    signIn();
    const check = jest.fn<Promise<SessionRecovery>, []>(() => Promise.resolve(RESUME));

    const { rerender } = render(
      <SessionRecoveryRedirect
        isLocalDatabaseReady={false}
        restoreRestTimer={mockRestoreRest}
        check={check}
      />,
    );
    expect(check).not.toHaveBeenCalled();

    rerender(
      <SessionRecoveryRedirect
        isLocalDatabaseReady
        restoreRestTimer={mockRestoreRest}
        check={check}
      />,
    );

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalled();
    });
  });

  it('waits for the root navigator, because a navigation before it is dropped', async () => {
    signIn();
    mockNavigationKey = undefined;
    const check = jest.fn<Promise<SessionRecovery>, []>(() => Promise.resolve(RESUME));

    const { rerender } = render(
      <SessionRecoveryRedirect
        isLocalDatabaseReady
        restoreRestTimer={mockRestoreRest}
        check={check}
      />,
    );
    expect(check).not.toHaveBeenCalled();

    mockNavigationKey = 'root';
    rerender(
      <SessionRecoveryRedirect
        isLocalDatabaseReady
        restoreRestTimer={mockRestoreRest}
        check={check}
      />,
    );

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalled();
    });
  });

  it('never recovers for a coach — the logger lives under (client)', async () => {
    signIn({ role: 'coach' });
    const check = jest.fn<Promise<SessionRecovery>, []>(() => Promise.resolve(RESUME));

    render(
      <SessionRecoveryRedirect
        isLocalDatabaseReady
        restoreRestTimer={mockRestoreRest}
        check={check}
      />,
    );

    await waitFor(() => {
      expect(check).not.toHaveBeenCalled();
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('never recovers a client still inside onboarding', async () => {
    signIn({ isOnboarded: false });
    const check = jest.fn<Promise<SessionRecovery>, []>(() => Promise.resolve(RESUME));

    render(
      <SessionRecoveryRedirect
        isLocalDatabaseReady
        restoreRestTimer={mockRestoreRest}
        check={check}
      />,
    );

    await waitFor(() => {
      expect(check).not.toHaveBeenCalled();
    });
  });

  it('checks once per launch, so a client who left the logger is not dragged back', async () => {
    signIn();
    const check = jest.fn<Promise<SessionRecovery>, []>(() => Promise.resolve(RESUME));

    const { rerender } = render(
      <SessionRecoveryRedirect
        isLocalDatabaseReady
        restoreRestTimer={mockRestoreRest}
        check={check}
      />,
    );
    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledTimes(1);
    });

    rerender(
      <SessionRecoveryRedirect
        isLocalDatabaseReady
        restoreRestTimer={mockRestoreRest}
        check={check}
      />,
    );
    useAuthStore.setState({ isOnboarded: true });
    rerender(
      <SessionRecoveryRedirect
        isLocalDatabaseReady
        restoreRestTimer={mockRestoreRest}
        check={check}
      />,
    );

    expect(check).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('lands the client on Today rather than a screen when the mirror will not answer', async () => {
    // `ERRORS.md` ER§1.4 has no surface for this: Today already ranks an
    // in-progress session first and offers Continue, so the cost is one tap.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    signIn();

    render(
      <SessionRecoveryRedirect
        isLocalDatabaseReady
        restoreRestTimer={mockRestoreRest}
        check={() => Promise.reject(new Error('database is locked'))}
      />,
    );

    await waitFor(() => {
      expect(warn).toHaveBeenCalledWith('workouts.session_recovery_failed', {
        errorName: 'Error',
      });
    });
    expect(mockPush).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('restores the rest timer on the same launch it checks for a session', async () => {
    // `rest-timer/02` rule (f). A rest survives an app kill through the same
    // mirror, behind the same schema gate.
    signIn();

    render(
      <SessionRecoveryRedirect
        isLocalDatabaseReady
        restoreRestTimer={mockRestoreRest}
        check={() => Promise.resolve(RESUME)}
      />,
    );

    await waitFor(() => {
      expect(mockRestoreRest).toHaveBeenCalledTimes(1);
    });
  });

  it('restores the rest timer even when there is no session to navigate into', async () => {
    // A rest whose session is stale still has to be read and discarded, or
    // it comes back on the launch after this one.
    signIn();

    render(
      <SessionRecoveryRedirect
        isLocalDatabaseReady
        restoreRestTimer={mockRestoreRest}
        check={() => Promise.resolve({ kind: 'none' })}
      />,
    );

    await waitFor(() => {
      expect(mockRestoreRest).toHaveBeenCalledTimes(1);
    });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('does not touch the mirror for a coach, or before the schema check answers', async () => {
    signIn({ role: 'coach' });
    const { rerender } = render(
      <SessionRecoveryRedirect
        isLocalDatabaseReady
        restoreRestTimer={mockRestoreRest}
        check={() => Promise.resolve(RESUME)}
      />,
    );

    signIn();
    rerender(
      <SessionRecoveryRedirect
        isLocalDatabaseReady={false}
        restoreRestTimer={mockRestoreRest}
        check={() => Promise.resolve(RESUME)}
      />,
    );

    await waitFor(() => {
      expect(mockRestoreRest).not.toHaveBeenCalled();
    });
  });
});

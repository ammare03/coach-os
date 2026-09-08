import { ensureLocalDatabaseBelongsTo } from '../../../db/user-scope.ts';
import { commitOpenedSession, type OpenedSessionLike } from '../session-result.ts';
import { useAuthStore } from '../store.ts';
import { setDeviceId, setTokens } from '../token-store.ts';

// `ensureLocalDatabaseBelongsTo` itself is covered in
// `db/__tests__/user-scope.test.ts` — this file's concern is that
// `commitOpenedSession` calls it, and awaits it, before flipping the store.
jest.mock('../../../db/user-scope.ts', () => ({
  ensureLocalDatabaseBelongsTo: jest.fn(async () => ({ outcome: 'same-user' })),
}));
jest.mock('../token-store.ts', () => ({
  setDeviceId: jest.fn(async () => undefined),
  setTokens: jest.fn(async () => undefined),
}));

function makeSession(overrides: Partial<OpenedSessionLike['user']> = {}): OpenedSessionLike {
  return {
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresAt: new Date('2026-08-28T01:00:00.000Z'),
    deviceId: 'device-1',
    user: {
      id: 'user-1',
      role: 'coach',
      onboardingCompletedAt: new Date('2026-08-01T00:00:00.000Z'),
      ...overrides,
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ status: 'loading', userId: null, role: null, isOnboarded: false });
});

describe('commitOpenedSession', () => {
  it('persists the session and authenticates once the local-database guard passes', async () => {
    await commitOpenedSession(makeSession());

    expect(setDeviceId).toHaveBeenCalledWith('device-1');
    expect(setTokens).toHaveBeenCalledTimes(1);
    expect(ensureLocalDatabaseBelongsTo).toHaveBeenCalledWith('user-1');
    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      userId: 'user-1',
      role: 'coach',
      isOnboarded: true,
    });
  });

  // DB§13's ordering guarantee: nothing observes `authenticated` while the
  // guard is still resolving.
  it('does not flip the store to authenticated until the local-database guard resolves', async () => {
    let resolveGuard: () => void = () => {
      throw new Error('resolveGuard called before assignment');
    };
    (ensureLocalDatabaseBelongsTo as jest.Mock).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveGuard = () => resolve({ outcome: 'same-user' });
      }),
    );

    const commitPromise = commitOpenedSession(makeSession());
    await Promise.resolve();
    await Promise.resolve();

    expect(useAuthStore.getState().status).toBe('loading');

    resolveGuard();
    await commitPromise;

    expect(useAuthStore.getState().status).toBe('authenticated');
  });

  it('propagates a failed guard without authenticating', async () => {
    (ensureLocalDatabaseBelongsTo as jest.Mock).mockRejectedValueOnce(
      new Error('could not wipe the local database for a different user: failed'),
    );

    await expect(commitOpenedSession(makeSession())).rejects.toThrow();

    expect(useAuthStore.getState().status).toBe('loading');
  });
});

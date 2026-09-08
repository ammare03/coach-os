import { bootstrap } from '../bootstrap.ts';
import { refreshTokenPair } from '../refresh-client.ts';
import { signalSignOutRequired } from '../sign-out-signal.ts';
import { useAuthStore } from '../store.ts';
import { clearTokens, getTokens } from '../token-store.ts';

// The involuntary listener now runs a wipe attempt before flipping the
// store (`local-database/03-wipe-on-logout.md`) — faked here the same way
// `useSignOut.test.ts` fakes it, since this file's own concern is the
// bootstrap sequencing, not the wipe itself (covered by `db/wipe.test.ts`).
jest.mock('../../../db/wipe.ts', () => ({
  wipeLocalDatabase: jest.fn(async () => ({ outcome: 'wiped' })),
}));
jest.mock('../../../lib/query/persister.ts', () => ({
  clearPersistedQueryCache: jest.fn(async () => undefined),
}));
jest.mock('../token-store.ts', () => ({
  getTokens: jest.fn(),
  setTokens: jest.fn(),
  clearTokens: jest.fn(),
}));
jest.mock('../refresh-client.ts', () => ({ refreshTokenPair: jest.fn() }));

function makeAccessToken(payload: unknown): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256' })}.${encode(payload)}.signature`;
}

beforeEach(() => {
  jest.clearAllMocks();
  useAuthStore.setState({ status: 'loading', userId: null, role: null, isOnboarded: false });
});

describe('bootstrap', () => {
  it('resolves unauthenticated without a refresh call when there are no stored tokens', async () => {
    (getTokens as jest.Mock).mockResolvedValue(null);

    await bootstrap();

    expect(refreshTokenPair).not.toHaveBeenCalled();
    expect(useAuthStore.getState()).toMatchObject({
      status: 'unauthenticated',
      userId: null,
      role: null,
    });
  });

  it('resolves authenticated with the decoded role when the session refreshes', async () => {
    (getTokens as jest.Mock).mockResolvedValue({
      accessToken: 'old',
      refreshToken: 'refresh-1',
      accessExpiresAt: '2026-08-28T00:00:00.000Z',
    });
    (refreshTokenPair as jest.Mock).mockResolvedValue({
      accessToken: makeAccessToken({ sub: 'user-1', role: 'coach' }),
      refreshToken: 'refresh-2',
      expiresAt: new Date('2026-08-28T01:00:00.000Z'),
      onboardingCompletedAt: new Date('2026-08-01T00:00:00.000Z'),
    });

    await bootstrap();

    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      userId: 'user-1',
      role: 'coach',
      isOnboarded: true,
    });
  });

  // The cold-start half of `onboarding-infrastructure/02`: a session that
  // was killed mid-onboarding must come back mid-onboarding, and rotation
  // is the only call made before the first screen renders.
  it('resolves a session with no onboarding timestamp as not onboarded', async () => {
    (getTokens as jest.Mock).mockResolvedValue({
      accessToken: 'old',
      refreshToken: 'refresh-1',
      accessExpiresAt: '2026-08-28T00:00:00.000Z',
    });
    (refreshTokenPair as jest.Mock).mockResolvedValue({
      accessToken: makeAccessToken({ sub: 'user-1', role: 'client' }),
      refreshToken: 'refresh-2',
      expiresAt: new Date('2026-08-28T01:00:00.000Z'),
      onboardingCompletedAt: null,
    });

    await bootstrap();

    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      userId: 'user-1',
      role: 'client',
      isOnboarded: false,
    });
  });

  it('resolves unauthenticated and clears tokens when the refresh fails', async () => {
    (getTokens as jest.Mock).mockResolvedValue({
      accessToken: 'old',
      refreshToken: 'refresh-1',
      accessExpiresAt: '2026-08-28T00:00:00.000Z',
    });
    (refreshTokenPair as jest.Mock).mockRejectedValue(new Error('refresh token expired'));

    await bootstrap();

    expect(clearTokens).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState()).toMatchObject({
      status: 'unauthenticated',
      userId: null,
      role: null,
    });
  });

  it('follows a sign-out signal from outside the bootstrap flow', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      userId: 'user-1',
      role: 'coach',
      isOnboarded: true,
    });

    signalSignOutRequired();
    // The listener now awaits a (faked) wipe attempt before flipping the
    // store — let those microtasks settle rather than asserting mid-flight.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(useAuthStore.getState()).toMatchObject({
      status: 'unauthenticated',
      userId: null,
      role: null,
    });
  });
});

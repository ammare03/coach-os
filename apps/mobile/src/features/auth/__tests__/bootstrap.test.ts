import { bootstrap } from '../bootstrap.ts';
import { refreshTokenPair } from '../refresh-client.ts';
import { signalSignOutRequired } from '../sign-out-signal.ts';
import { useAuthStore } from '../store.ts';
import { clearTokens, getTokens } from '../token-store.ts';

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
  useAuthStore.setState({ status: 'loading', userId: null, role: null });
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
    });

    await bootstrap();

    expect(useAuthStore.getState()).toMatchObject({
      status: 'authenticated',
      userId: 'user-1',
      role: 'coach',
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

  it('follows a sign-out signal from outside the bootstrap flow', () => {
    useAuthStore.setState({ status: 'authenticated', userId: 'user-1', role: 'coach' });

    signalSignOutRequired();

    expect(useAuthStore.getState()).toMatchObject({
      status: 'unauthenticated',
      userId: null,
      role: null,
    });
  });
});

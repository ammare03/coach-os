import type { Operation } from '@trpc/client';

import { refreshTokenPair } from '../refresh-client.ts';
import { refreshLink } from '../refresh-interceptor.ts';
import { onSignOutRequired } from '../sign-out-signal.ts';
import { clearTokens, getTokens, setTokens } from '../token-store.ts';

jest.mock('../refresh-client.ts', () => ({ refreshTokenPair: jest.fn() }));
jest.mock('../token-store.ts', () => ({
  getTokens: jest.fn(),
  setTokens: jest.fn(),
  clearTokens: jest.fn(),
}));
// A minimal stand-in — real shape doesn't matter here, only that this
// module's `getErrorCode(err)` reads the same field these tests set.
jest.mock('../../../lib/error-code.ts', () => ({
  getErrorCode: (err: { appCode?: string } | null) => err?.appCode ?? null,
}));

type FakeError = { appCode: string };
type FakeObserver = {
  next(value: unknown): void;
  error(err: unknown): void;
  complete(): void;
};
type FakeNext = (op: Operation) => { subscribe(observer: FakeObserver): { unsubscribe(): void } };

function makeOp(path: string, id: number): Operation {
  return { id, type: 'query', input: undefined, path, context: {}, signal: null };
}

/** Fails every op's first attempt with AUTH_REQUIRED, succeeds on retry. */
function failOnceThenSucceed(): { next: FakeNext } {
  const attempts = new Map<number, number>();
  const next: FakeNext = (op) => ({
    subscribe(observer) {
      const attempt = (attempts.get(op.id) ?? 0) + 1;
      attempts.set(op.id, attempt);
      let unsubscribed = false;
      queueMicrotask(() => {
        if (unsubscribed) return;
        if (attempt === 1) {
          observer.error({ appCode: 'AUTH_REQUIRED' } satisfies FakeError);
        } else {
          observer.next({ result: { data: 'ok' } });
          observer.complete();
        }
      });
      return {
        unsubscribe() {
          unsubscribed = true;
        },
      };
    },
  });
  return { next };
}

function subscribeAsPromise(next: FakeNext, op: Operation) {
  const link = refreshLink({} as never);
  return new Promise((resolve, reject) => {
    link({ next, op } as never).subscribe({
      next: resolve,
      error: reject,
      complete: () => {},
    });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (getTokens as jest.Mock).mockResolvedValue({
    accessToken: 'old-access',
    refreshToken: 'refresh-1',
    accessExpiresAt: '2026-08-28T00:00:00.000Z',
  });
  (refreshTokenPair as jest.Mock).mockResolvedValue({
    accessToken: 'new-access',
    refreshToken: 'refresh-2',
    // A real Date, matching superjson's wire round-trip (`refresh-client.ts`) —
    // not the string `@coachos/schemas`' Zod shape would suggest.
    expiresAt: new Date('2026-08-28T01:00:00.000Z'),
  });
});

describe('refreshLink', () => {
  it('fires exactly one refresh call for 5 concurrent AUTH_REQUIRED failures', async () => {
    const { next } = failOnceThenSucceed();

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => subscribeAsPromise(next, makeOp('workouts.list', i))),
    );

    expect(results).toHaveLength(5);
    expect(refreshTokenPair).toHaveBeenCalledTimes(1);
    expect(refreshTokenPair).toHaveBeenCalledWith('refresh-1');
  });

  it('replays with the new token stored by setTokens', async () => {
    const { next } = failOnceThenSucceed();

    await subscribeAsPromise(next, makeOp('me.get', 1));

    expect(setTokens).toHaveBeenCalledWith({
      accessToken: 'new-access',
      refreshToken: 'refresh-2',
      accessExpiresAt: '2026-08-28T01:00:00.000Z',
    });
  });

  it('passes through a non-AUTH_REQUIRED error without refreshing', async () => {
    const next: FakeNext = () => ({
      subscribe(observer) {
        queueMicrotask(() => observer.error({ appCode: 'VALIDATION_FAILED' }));
        return { unsubscribe() {} };
      },
    });

    await expect(subscribeAsPromise(next, makeOp('workouts.logSet', 1))).rejects.toEqual({
      appCode: 'VALIDATION_FAILED',
    });
    expect(refreshTokenPair).not.toHaveBeenCalled();
  });

  it('does not attempt a refresh for an excluded procedure (e.g. a wrong-password sign-in)', async () => {
    const next: FakeNext = () => ({
      subscribe(observer) {
        queueMicrotask(() => observer.error({ appCode: 'AUTH_REQUIRED' }));
        return { unsubscribe() {} };
      },
    });

    await expect(subscribeAsPromise(next, makeOp('auth.signIn', 1))).rejects.toEqual({
      appCode: 'AUTH_REQUIRED',
    });
    expect(refreshTokenPair).not.toHaveBeenCalled();
  });

  it('clears tokens and signals sign-out when refresh itself fails, without looping', async () => {
    (refreshTokenPair as jest.Mock).mockRejectedValue(new Error('refresh token reused'));
    const signOutListener = jest.fn();
    const unsubscribe = onSignOutRequired(signOutListener);

    const next: FakeNext = () => ({
      subscribe(observer) {
        queueMicrotask(() => observer.error({ appCode: 'AUTH_REQUIRED' }));
        return { unsubscribe() {} };
      },
    });

    await expect(subscribeAsPromise(next, makeOp('me.get', 1))).rejects.toEqual({
      appCode: 'AUTH_REQUIRED',
    });

    expect(clearTokens).toHaveBeenCalledTimes(1);
    expect(signOutListener).toHaveBeenCalledTimes(1);
    expect(refreshTokenPair).toHaveBeenCalledTimes(1); // no retry loop

    unsubscribe();
  });

  it('does not retry a second time if the replayed request also fails with AUTH_REQUIRED', async () => {
    const next: FakeNext = () => ({
      subscribe(observer) {
        queueMicrotask(() => observer.error({ appCode: 'AUTH_REQUIRED' }));
        return { unsubscribe() {} };
      },
    });

    await expect(subscribeAsPromise(next, makeOp('me.get', 1))).rejects.toEqual({
      appCode: 'AUTH_REQUIRED',
    });

    expect(refreshTokenPair).toHaveBeenCalledTimes(1);
  });
});

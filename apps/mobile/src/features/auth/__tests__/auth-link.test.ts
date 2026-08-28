import type { Operation } from '@trpc/client';
// The server's actual public allowlist (§18.3) — a value import, not a
// mock, so this test fails the moment either side drifts from the other
// (`auth-client/02` approach step 2).
import { PUBLIC_ALLOWLIST } from 'api/src/__tests__/authz-allowlist.ts';

import { authLink, buildRequestHeaders, EXCLUDED_PROCEDURES } from '../auth-link.ts';
import { tokenCache } from '../token-cache.ts';

function makeOp(path: string, context: Record<string, unknown> = {}): Operation {
  return { id: 1, type: 'query', input: undefined, path, context, signal: null };
}

function callAuthLink(op: Operation): Operation {
  let forwarded: Operation | undefined;
  const next = (nextOp: Operation) => {
    forwarded = nextOp;
  };
  const result = authLink({} as never)({ next, op } as never);
  expect(result).toBeUndefined(); // synchronous, no observable/promise returned by `next` here
  if (!forwarded) throw new Error('authLink did not call next()');
  return forwarded;
}

beforeEach(() => {
  tokenCache.clear();
});

describe('EXCLUDED_PROCEDURES', () => {
  it('matches the server public allowlist exactly', () => {
    const serverPaths = PUBLIC_ALLOWLIST.map((entry) => entry.path).sort();
    expect([...EXCLUDED_PROCEDURES].sort()).toEqual(serverPaths);
  });
});

describe('authLink', () => {
  it.each(EXCLUDED_PROCEDURES)('stamps needsAuth: false for excluded procedure %s', (path) => {
    const forwarded = callAuthLink(makeOp(path));
    expect(forwarded.context.needsAuth).toBe(false);
  });

  it.each(['workouts.list', 'me.get', 'auth.signOutAllDevices'])(
    'stamps needsAuth: true for authenticated procedure %s',
    (path) => {
      // signOutAllDevices is deliberately not excluded — it is protectedProcedure,
      // and a startsWith('auth.') match would wrongly strip its token.
      const forwarded = callAuthLink(makeOp(path));
      expect(forwarded.context.needsAuth).toBe(true);
    },
  );

  it('preserves existing context fields', () => {
    const forwarded = callAuthLink(makeOp('me.get', { existing: 'value' }));
    expect(forwarded.context).toMatchObject({ existing: 'value', needsAuth: true });
  });
});

describe('buildRequestHeaders', () => {
  it('attaches Authorization when a token is cached and the op needs it', () => {
    tokenCache.set('token-abc', '2026-08-28T12:00:00.000Z');

    const headers = buildRequestHeaders([makeOp('me.get', { needsAuth: true })]);

    expect(headers.Authorization).toBe('Bearer token-abc');
  });

  it('omits Authorization when no token is cached', () => {
    const headers = buildRequestHeaders([makeOp('me.get', { needsAuth: true })]);

    expect(headers.Authorization).toBeUndefined();
  });

  it('omits Authorization when every op in the batch is excluded', () => {
    tokenCache.set('token-abc', '2026-08-28T12:00:00.000Z');

    const headers = buildRequestHeaders([makeOp('auth.signIn', { needsAuth: false })]);

    expect(headers.Authorization).toBeUndefined();
  });

  it('attaches Authorization if any op in a mixed batch needs it', () => {
    tokenCache.set('token-abc', '2026-08-28T12:00:00.000Z');

    const headers = buildRequestHeaders([
      makeOp('auth.refresh', { needsAuth: false }),
      makeOp('workouts.list', { needsAuth: true }),
    ]);

    expect(headers.Authorization).toBe('Bearer token-abc');
  });

  it('always includes version headers, read from native application info', () => {
    const headers = buildRequestHeaders([makeOp('auth.signIn', { needsAuth: false })]);

    expect(headers['x-client-platform']).toBeTruthy();
    expect(typeof headers['x-client-version']).toBe('string');
  });

  it('carries no header identifying the user', () => {
    tokenCache.set('token-abc', '2026-08-28T12:00:00.000Z');

    const headers = buildRequestHeaders([makeOp('me.get', { needsAuth: true })]);

    expect(Object.keys(headers)).toEqual(
      expect.arrayContaining(['Authorization', 'x-client-version', 'x-client-platform']),
    );
    expect(Object.keys(headers)).toHaveLength(3);
  });
});

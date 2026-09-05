import type { UseQueryResult } from '@tanstack/react-query';
import { TRPCClientError } from '@trpc/client';

import { useResourceState, type ResourceQueryLike } from '../useResourceState.ts';

// A stand-in for whatever a real id-route fetches. Deliberately not a
// database row shape — the hook is generic and never reads a field.
interface Fetched {
  slug: string;
  displayName: string;
}

const FETCHED: Fetched = { slug: 'c1', displayName: 'A' };

/** The wire shape `apps/api/src/trpc/error-formatter.ts` produces. */
function appError(opts: {
  code: string;
  httpStatus: number;
  appCode: string;
  details?: unknown;
}): TRPCClientError<never> {
  return TRPCClientError.from({
    error: {
      code: -32001,
      message: 'nope',
      data: {
        code: opts.code,
        httpStatus: opts.httpStatus,
        appCode: opts.appCode,
        details: opts.details ?? {},
      },
    },
  });
}

/** A transport-level failure with no catalogued `appCode` at all. */
function bareTransportError(code: string, httpStatus: number): TRPCClientError<never> {
  return TRPCClientError.from({
    error: { code: -32004, message: 'nope', data: { code, httpStatus } },
  });
}

function query(over: Partial<ResourceQueryLike<Fetched>>): ResourceQueryLike<Fetched> {
  return { data: undefined, error: null, ...over };
}

describe('useResourceState', () => {
  describe('the four states CLAUDE.md §9.2 requires', () => {
    it('is loading while there is neither data nor an error', () => {
      expect(useResourceState(query({}))).toEqual({ state: 'loading' });
    });

    it('is success once data has arrived, with no refetch error', () => {
      expect(useResourceState(query({ data: FETCHED }))).toEqual({
        state: 'success',
        data: FETCHED,
        refetchError: null,
      });
    });

    it('is notFound for a NOT_FOUND-mapped app code', () => {
      const error = appError({ code: 'NOT_FOUND', httpStatus: 404, appCode: 'EXPORT_NOT_FOUND' });

      expect(useResourceState(query({ error }))).toEqual({
        state: 'notFound',
        code: 'EXPORT_NOT_FOUND',
        error,
      });
    });

    // NOT_YOUR_CLIENT is FORBIDDEN in APP_ERROR_TRPC_CODE and thrown that
    // way by ownsResource, which is what this asserts. ERRORS.md ER§2.1
    // says it should be NOT_FOUND — an open discrepancy owned by the
    // catalogue, not by this hook (see useResourceState.README.md §3).
    it('is forbidden for a FORBIDDEN-mapped app code', () => {
      const error = appError({ code: 'FORBIDDEN', httpStatus: 403, appCode: 'NOT_YOUR_CLIENT' });

      expect(useResourceState(query({ error }))).toEqual({
        state: 'forbidden',
        code: 'NOT_YOUR_CLIENT',
        error,
      });
    });
  });

  describe('the catalogue is the mapping, not a local copy', () => {
    // FEATURE_NOT_IN_TIER's transport code is FORBIDDEN even though its
    // name says nothing about permission — reading APP_ERROR_TRPC_CODE is
    // what gets this right without an entry per code here.
    it('maps FEATURE_NOT_IN_TIER to forbidden', () => {
      const error = appError({
        code: 'FORBIDDEN',
        httpStatus: 403,
        appCode: 'FEATURE_NOT_IN_TIER',
        details: { feature: 'groupLive', requiredTier: 'pro' },
      });

      expect(useResourceState(query({ error })).state).toBe('forbidden');
    });

    it('maps ROLE_REQUIRED to forbidden', () => {
      const error = appError({
        code: 'FORBIDDEN',
        httpStatus: 403,
        appCode: 'ROLE_REQUIRED',
        details: { requiredRole: 'coach' },
      });

      expect(useResourceState(query({ error })).state).toBe('forbidden');
    });

    // AUTH_REQUIRED is UNAUTHORIZED, not FORBIDDEN. It belongs to the auth
    // gate (refresh, then sign out), never to a screen's forbidden state.
    it('does not treat AUTH_REQUIRED as forbidden', () => {
      const error = appError({ code: 'UNAUTHORIZED', httpStatus: 401, appCode: 'AUTH_REQUIRED' });

      expect(useResourceState(query({ error })).state).toBe('error');
    });
  });

  describe('a generic error is never swallowed', () => {
    it('surfaces INTERNAL_ERROR as the error state with its code', () => {
      const error = appError({
        code: 'INTERNAL_SERVER_ERROR',
        httpStatus: 500,
        appCode: 'INTERNAL_ERROR',
      });

      expect(useResourceState(query({ error }))).toEqual({
        state: 'error',
        code: 'INTERNAL_ERROR',
        error,
      });
    });

    it('surfaces RATE_LIMITED as the error state rather than forbidden', () => {
      const error = appError({
        code: 'TOO_MANY_REQUESTS',
        httpStatus: 429,
        appCode: 'RATE_LIMITED',
        details: { retryAfterSeconds: 30 },
      });

      expect(useResourceState(query({ error }))).toEqual({
        state: 'error',
        code: 'RATE_LIMITED',
        error,
      });
    });

    it('surfaces a plain network failure with a null code', () => {
      const error = new Error('Network request failed');

      expect(useResourceState(query({ error }))).toEqual({ state: 'error', code: null, error });
    });

    it('never reports loading while an error is present', () => {
      const error = new Error('Network request failed');

      expect(useResourceState(query({ error })).state).not.toBe('loading');
    });
  });

  describe('an uncatalogued transport error still reaches the right state', () => {
    it('reads NOT_FOUND off the wire when there is no appCode', () => {
      const error = bareTransportError('NOT_FOUND', 404);

      expect(useResourceState(query({ error }))).toEqual({ state: 'notFound', code: null, error });
    });

    it('reads FORBIDDEN off the wire when there is no appCode', () => {
      const error = bareTransportError('FORBIDDEN', 403);

      expect(useResourceState(query({ error }))).toEqual({ state: 'forbidden', code: null, error });
    });
  });

  describe('precedence against a cached copy', () => {
    it('keeps rendering the cache when a background refetch fails generically', () => {
      const error = appError({
        code: 'INTERNAL_SERVER_ERROR',
        httpStatus: 500,
        appCode: 'INTERNAL_ERROR',
      });

      expect(useResourceState(query({ data: FETCHED, error }))).toEqual({
        state: 'success',
        data: FETCHED,
        refetchError: error,
      });
    });

    it('drops the cache the moment access is revoked', () => {
      const error = appError({ code: 'FORBIDDEN', httpStatus: 403, appCode: 'NOT_YOUR_CLIENT' });

      expect(useResourceState(query({ data: FETCHED, error })).state).toBe('forbidden');
    });

    it('drops the cache the moment the resource is gone', () => {
      const error = appError({ code: 'NOT_FOUND', httpStatus: 404, appCode: 'EXPORT_NOT_FOUND' });

      expect(useResourceState(query({ data: FETCHED, error })).state).toBe('notFound');
    });
  });

  describe('edge cases a real query produces', () => {
    // A query resolving to `null` is data, not absence. Treating it as
    // loading would hang the screen on a legitimately empty resource.
    it('treats null data as success', () => {
      const result = useResourceState<Fetched | null>({ data: null, error: null });

      expect(result).toEqual({ state: 'success', data: null, refetchError: null });
    });

    // TanStack initialises `error` to `null`; a hand-built fixture may
    // leave it `undefined`. Neither is a failure.
    it('treats an undefined error as no error', () => {
      expect(useResourceState({ data: FETCHED, error: undefined }).state).toBe('success');
    });
  });

  it('narrows to the query data type without a cast', () => {
    const result = useResourceState({ data: FETCHED, error: null });

    if (result.state !== 'success') {
      throw new Error('expected success');
    }
    // Compiles only if TData inferred as Fetched rather than Fetched | undefined.
    const name: string = result.data.displayName;
    expect(name).toBe('A');
  });

  it('accepts a real UseQueryResult without widening TData', () => {
    const observed = {
      data: FETCHED,
      error: null,
      status: 'success',
      isPending: false,
      isSuccess: true,
    } as unknown as UseQueryResult<Fetched, TRPCClientError<never>>;

    const result = useResourceState(observed);

    if (result.state !== 'success') {
      throw new Error('expected success');
    }
    const slug: string = result.data.slug;
    expect(slug).toBe('c1');
  });
});

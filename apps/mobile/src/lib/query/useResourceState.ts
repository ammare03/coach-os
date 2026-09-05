import { APP_ERROR_TRPC_CODE, type AppErrorCode, type TRPCErrorCodeName } from '@coachos/schemas';
import { TRPCClientError } from '@trpc/client';

import { getErrorCode } from '../error-code.ts';

/**
 * The four-way render decision every id-route makes, plus the one the four
 * cannot honestly absorb.
 *
 * `CLAUDE.md` §9.2 requires loading, not-found, and forbidden to be three
 * distinct states, and `packages/ui` ships one component per state for
 * exactly that reason. `error` is the fifth member: a `RATE_LIMITED`, an
 * `INTERNAL_ERROR`, or a dead socket is none of the four, and folding it
 * into any of them is the silent swallow `code-conventions` §8 forbids.
 *
 * Full rationale, precedence rules, and a worked example:
 * `./useResourceState.README.md`.
 */
export type ResourceState<TData> =
  | { state: 'loading' }
  | { state: 'notFound'; code: AppErrorCode | null; error: unknown }
  | { state: 'forbidden'; code: AppErrorCode | null; error: unknown }
  | { state: 'error'; code: AppErrorCode | null; error: unknown }
  /**
   * `refetchError` is non-null when a cached copy is being shown after a
   * background refetch failed — `UI-UX.md` §UX4's offline row ("cached
   * content plus a calm banner, never an error"). It is the reason a
   * flaky refetch does not blank a screen, and the reason that failure is
   * still visible to the caller rather than dropped.
   */
  | { state: 'success'; data: TData; refetchError: unknown };

/**
 * The structural slice of a TanStack Query result this reads — `data` and
 * `error`, nothing else. Deliberately not `UseQueryResult`: an infinite
 * query, a suspense query, and a hand-built fixture in a test all satisfy
 * this, and none of them has to satisfy the full observer shape.
 */
export interface ResourceQueryLike<TData> {
  data: TData | undefined;
  error: unknown;
}

/**
 * Reads the transport code off the wire when no `appCode` is present — a
 * procedure the server does not have, a gateway 403, an old build talking
 * to a newer API. `error-code.ts` owns the `appCode` path; this covers
 * only what that path cannot see.
 */
function transportCodeFromWire(error: unknown): TRPCErrorCodeName | null {
  if (!(error instanceof TRPCClientError)) {
    return null;
  }
  const data = error.data as { code?: unknown; httpStatus?: unknown } | null | undefined;
  if (data?.code === 'NOT_FOUND' || data?.httpStatus === 404) {
    return 'NOT_FOUND';
  }
  if (data?.code === 'FORBIDDEN' || data?.httpStatus === 403) {
    return 'FORBIDDEN';
  }
  return null;
}

interface Classification {
  kind: 'notFound' | 'forbidden' | 'error';
  code: AppErrorCode | null;
}

/**
 * `APP_ERROR_TRPC_CODE` is the mapping — it is not re-derived here. A code
 * added to the catalogue with `NOT_FOUND` or `FORBIDDEN` against it reaches
 * the right state on the day it is added, with no change to this file.
 */
function classify(error: unknown): Classification {
  const code = getErrorCode(error);
  const transport = code === null ? transportCodeFromWire(error) : APP_ERROR_TRPC_CODE[code];

  if (transport === 'NOT_FOUND') {
    return { kind: 'notFound', code };
  }
  if (transport === 'FORBIDDEN') {
    return { kind: 'forbidden', code };
  }
  return { kind: 'error', code };
}

/**
 * Maps a tRPC query's result to the render decision an id-route's feature
 * component switches on. The switch belongs in that component, never in
 * the `app/**` route file (`code-conventions` §1, `CLAUDE.md` §9.2).
 *
 * No React state and no hooks — `use` prefixed because it is called during
 * render alongside the query hook it wraps, and because every later phase
 * should find it where it reaches for a hook.
 */
export function useResourceState<TData>(query: ResourceQueryLike<TData>): ResourceState<TData> {
  const { data, error } = query;

  if (error !== null && error !== undefined) {
    const { kind, code } = classify(error);

    // Both win over a cached copy, and that is the point: a client who left
    // their coach, or a resource that was deleted, must stop rendering the
    // moment the server says so — not on the next cold start.
    if (kind === 'notFound') {
      return { state: 'notFound', code, error };
    }
    if (kind === 'forbidden') {
      return { state: 'forbidden', code, error };
    }
    // Everything else degrades to the cache when there is one. TanStack
    // sets `status: 'error'` on a failed *background* refetch while keeping
    // the data it already had, and blanking a working screen because the
    // gym has no signal is the wrong trade.
    if (data !== undefined) {
      return { state: 'success', data, refetchError: error };
    }
    return { state: 'error', code, error };
  }

  if (data !== undefined) {
    return { state: 'success', data, refetchError: null };
  }
  return { state: 'loading' };
}

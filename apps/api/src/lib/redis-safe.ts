import { redisAvailable } from './redis.ts';

/**
 * The fail-open wrapper `01-redis-connection-and-keyspace.md` step 6
 * declares once, for every Redis read and write in the codebase. `op`'s own
 * client already bounds it by `commandTimeout` (`redis.ts`); this only
 * catches the rejection and returns the caller's `fallback` instead of
 * letting it propagate.
 *
 * `fallback` is the caller's choice, and the choices are already decided
 * (step 6's table): `allow` for the rate limiter, a Postgres-query miss for
 * the session and entitlement caches, `re-sign` for the signed-URL cache,
 * `empty` for presence/typing. There is no caller whose correct fallback is
 * "fail the request" — DB§15's ephemerality rule leaves no legitimate case.
 */
export async function safeRedis<T>(op: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await op();
  } catch (err) {
    console.warn('[redis] operation failed, using fallback', {
      error: err instanceof Error ? err.message : String(err),
      redisAvailable,
    });
    return fallback;
  }
}

// Writes and clears `sess:{userId}:{deviceId}` (DB§15) — the only module
// that touches that key pattern. Reading it back is `../../trpc/context.ts`'s
// job already (`api-scaffold/02`), out of scope here (`03`'s Scope).
import { keys } from '../redis-keys.ts';
import { safeRedis } from '../redis-safe.ts';
import { redis } from '../redis.ts';

/**
 * Everything `../../trpc/context.ts`'s `ContextUser` is allowed to carry,
 * minus `email` (`03`'s Approach step 6 — "not email; a Redis instance is a
 * much easier thing to read than a Postgres one") and minus `id`, which the
 * cache key (`userId` below) already carries — storing it again in the
 * value would be a redundant copy of the same id, not a row shape, so this
 * isn't `identity.users` reappearing under a different name.
 */
export interface SessionCacheValue {
  role: 'coach' | 'client' | 'assistant';
  timezone: string;
  locale: string;
  coachProfileId: string | null;
  clientProfileId: string | null;
}

/**
 * Best-effort write with a 15-minute TTL, matching the access token's own
 * expiry (`03`'s Approach step 6: "so it expires with the access token
 * rather than outliving it — a cache entry that survives its token is a
 * window where a revoked session still resolves"). A write failure costs a
 * later query, not a sign-in — `safeRedis` swallows it.
 */
export async function writeSessionCache(
  userId: string,
  deviceId: string,
  value: SessionCacheValue,
): Promise<void> {
  const { key, ttlSeconds } = keys.session(userId, deviceId);
  await safeRedis(async () => {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }, undefined);
}

/**
 * Removes the session cache entry for one device, or every device of a
 * user when `deviceId` is omitted — the revocation primitive tasks 04, 05,
 * 06 and `../account-lifecycle/03` all call (`03`'s Produces). Deleting the
 * key is what forces `createContext` back to Postgres on the next request,
 * which is how a revoked or purged user stops being served from cache
 * before the TTL would otherwise expire it.
 */
export async function clearSessionCache(userId: string, deviceId?: string): Promise<void> {
  if (deviceId) {
    await safeRedis(async () => {
      await redis.del(keys.session(userId, deviceId).key);
    }, undefined);
    return;
  }

  await safeRedis(async () => {
    // `'*'` as the deviceId segment turns the same canonical key builder
    // into a SCAN MATCH glob — still the one place a `sess:` key is
    // assembled, just supplied a wildcard instead of a real device id.
    const pattern = keys.session(userId, '*').key;
    let cursor = '0';
    do {
      const [nextCursor, found] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      if (found.length > 0) {
        await redis.del(...found);
      }
    } while (cursor !== '0');
  }, undefined);
}

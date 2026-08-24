import { env } from '../env.ts';

/**
 * Every builder returns its key together with its TTL — DB§15 assigns a TTL
 * to every pattern, and a key written without one is a slow leak on a
 * 256MB free tier (`01-redis-connection-and-keyspace.md` step 4).
 */
export interface RedisKey {
  key: string;
  ttlSeconds: number;
}

const SECOND = 1;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/**
 * `REDIS_KEY_PREFIX` (`coachos:dev:`, `coachos:preview:`, `coachos:prod:`)
 * prepended here, once, rather than at each call site — Phase 1 runs every
 * environment on one free-tier Redis instance (CLAUDE.md §3.4.2), and
 * without this a developer's local run shares a rate-limit counter and a
 * session cache with production.
 */
function prefixed(suffix: string): string {
  return `${env.REDIS_KEY_PREFIX}${suffix}`;
}

/**
 * One builder per DB§15 pattern. This is the *only* place a Redis key is
 * assembled in the codebase — a key built by template literal at a call
 * site is a documentation bug in this file or in DB§15, and the fix is a
 * `DATABASE.md` edit in the same PR.
 *
 * No builder accepts a raw value (an email, a search term, a food name) —
 * only ids, route names, and hashes. `foodQuery`'s `hash` argument is the
 * caller's hash of the search term, never the term itself: a raw search
 * term in a key is a 🟠 nutrition value (DB§18) sitting in an unencrypted
 * store and appearing in every `SCAN` and every Upstash console screenshot.
 */
export const keys = {
  session(userId: string, deviceId: string): RedisKey {
    return { key: prefixed(`sess:${userId}:${deviceId}`), ttlSeconds: 15 * MINUTE };
  },

  entitlements(coachId: string): RedisKey {
    return { key: prefixed(`entitlements:${coachId}`), ttlSeconds: 5 * MINUTE };
  },

  // DB§15 lists this pattern's TTL as "window" — it varies by route
  // (`02-rate-limit-middleware.md`'s per-route config, `CLAUDE.md` §6.5).
  // `windowSeconds` is the caller's, not a number this file owns, so the
  // five limits stay declared in exactly one place: the route config `03`
  // builds, not a second copy here.
  rateLimit(route: string, userId: string, windowSeconds: number): RedisKey {
    return { key: prefixed(`rl:${route}:${userId}`), ttlSeconds: windowSeconds };
  },

  rateLimitAuth(ip: string): RedisKey {
    return { key: prefixed(`rl:auth:${ip}`), ttlSeconds: 15 * MINUTE };
  },

  presence(conversationId: string): RedisKey {
    return { key: prefixed(`presence:${conversationId}`), ttlSeconds: 60 * SECOND };
  },

  typing(conversationId: string, userId: string): RedisKey {
    return { key: prefixed(`typing:${conversationId}:${userId}`), ttlSeconds: 5 * SECOND };
  },

  dashboard(coachId: string): RedisKey {
    return { key: prefixed(`dash:${coachId}`), ttlSeconds: 60 * SECOND };
  },

  foodQuery(hash: string): RedisKey {
    return { key: prefixed(`food:q:${hash}`), ttlSeconds: 24 * HOUR };
  },

  signedUrl(assetId: string, userId: string): RedisKey {
    return { key: prefixed(`signedurl:${assetId}:${userId}`), ttlSeconds: 55 * MINUTE };
  },

  summaryLock(clientId: string, date: string): RedisKey {
    return { key: prefixed(`lock:summary:${clientId}:${date}`), ttlSeconds: 10 * SECOND };
  },
};

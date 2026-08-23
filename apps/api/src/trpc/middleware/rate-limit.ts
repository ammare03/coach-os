import { appError } from '../../lib/app-error.ts';
import { keys } from '../../lib/redis-keys.ts';
import { safeRedis } from '../../lib/redis-safe.ts';
import { redis } from '../../lib/redis.ts';
import { middleware } from '../init.ts';

// Placed alongside `is-authed.ts` / `has-role.ts` / `owns-resource.ts`
// rather than `02-rate-limit-middleware.md`'s literal `apps/api/src/middleware/`
// path — every other tRPC middleware in the codebase lives in
// `trpc/middleware/`, and a second top-level `middleware/` folder would
// split one concept across two locations for no reason.

/**
 * One atomic round trip: `INCR` the counter and, on the very first
 * increment in a window only, `EXPIRE` it — then read back the count and
 * the key's remaining TTL. A separate `GET`-then-`INCR`-then-`EXPIRE`
 * sequence doesn't under-count (`INCR` is already atomic), but it does race
 * on the *TTL*: two requests both creating the key could each believe
 * they're "first" and each reset the expiry, extending the window
 * indefinitely. Bundling the read in here too is what keeps this at
 * `01`'s step 7 budget — one command per request, not two.
 */
const INCR_WITH_TTL_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  return {current, tonumber(ARGV[1])}
end
return {current, redis.call('TTL', KEYS[1])}
`;

interface CounterResult {
  count: number;
  ttlSeconds: number;
}

function isCounterResult(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number'
  );
}

async function incrementWithTtl(key: string, windowSeconds: number): Promise<CounterResult> {
  const result = await redis.eval(INCR_WITH_TTL_LUA, 1, key, windowSeconds);
  if (!isCounterResult(result)) {
    throw new TypeError('rate limit script returned an unexpected shape');
  }
  const [count, ttlSeconds] = result;
  return { count, ttlSeconds };
}

export interface RateLimitConfig {
  /**
   * The `rl:{route}:{userId}` segment (`redis-keys.ts`'s `rateLimit`
   * builder) — a name for this limit *group*, not necessarily a single
   * tRPC path: CLAUDE.md §6.5 puts several procedures under one shared
   * limit (e.g. "everything else"). `03-per-route-config-and-429-handling.md`
   * decides what maps to what; this only enforces whichever config it's
   * given.
   */
  route: string;
  windowSeconds: number;
  max: number;
}

const RATE_LIMITED_MESSAGE = 'Too many requests. Try again shortly.';

// Every such request shares one bucket rather than trusting a
// client-supplied header (`x-forwarded-for`) that could be used to exhaust
// a stranger's quota, or to dodge the limit entirely by rotating fake
// values. In production this never triggers — Fly's edge always sets
// `fly-client-ip` — so this is effectively "local dev has one shared
// auth throttle", which is an acceptable degradation, not a security gap.
const UNTRUSTED_IP_BUCKET = 'untrusted';

/**
 * `rateLimit({ route, windowSeconds, max })` — a tRPC middleware factory.
 * Keys by the authenticated user when `ctx.user` is set; by the request's
 * *trusted* client IP otherwise, since `auth.*` procedures are
 * pre-authentication by definition (CLAUDE.md §6.5's `auth.*` row) and use
 * the dedicated `rl:auth:{ip}` pattern (`redis-keys.ts`) rather than one
 * keyed by `route` — the whole `auth.*` group shares that single throttle.
 *
 * Fails open on any Redis failure (`01`'s step 6 table: a counter must
 * never deny service) — `safeRedis`'s `null` fallback here means "Redis
 * didn't answer", and the request is let through rather than guessed at.
 */
export function rateLimit(config: RateLimitConfig) {
  return middleware(async ({ ctx, next }) => {
    const identity = ctx.user
      ? keys.rateLimit(config.route, ctx.user.id, config.windowSeconds)
      : keys.rateLimitAuth(ctx.request.trustedIp ?? UNTRUSTED_IP_BUCKET);

    const result = await safeRedis(() => incrementWithTtl(identity.key, identity.ttlSeconds), null);

    if (result !== null && result.count > config.max) {
      throw appError('RATE_LIMITED', RATE_LIMITED_MESSAGE, {
        retryAfterSeconds: result.ttlSeconds,
      });
    }

    return next();
  });
}

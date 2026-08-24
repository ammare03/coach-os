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
   * The `rl:{route}:{identity}` segment (`redis-keys.ts`'s `rateLimit`
   * builder) — a name for this limit *group*, not necessarily a single
   * tRPC path: CLAUDE.md §6.5 puts several procedures under one shared
   * limit (e.g. `comments.create`). **Omit it** to key by the current
   * procedure's own tRPC path instead — that's what the structural default
   * tier does (`rate-limit-config.ts`), so a new procedure nobody
   * configured still gets its *own* bucket rather than sharing one with
   * every other unconfigured procedure.
   */
  route?: string;
  windowSeconds: number;
  max: number;
}

const RATE_LIMITED_MESSAGE = 'Too many requests. Try again shortly.';

// Every such request shares one bucket, per route, rather than trusting a
// client-supplied header (`x-forwarded-for`) that could be used to exhaust
// a stranger's quota, or to dodge the limit entirely by rotating fake
// values. In production this never triggers — Fly's edge always sets
// `fly-client-ip` — so this is effectively "local dev shares one bucket per
// route", which is an acceptable degradation, not a security gap.
const UNTRUSTED_IP_BUCKET = 'untrusted';

function trustedClientIp(trustedIp: string | null): string {
  return trustedIp ?? UNTRUSTED_IP_BUCKET;
}

// Shared by both middlewares below: run the atomic counter against
// whichever key the caller resolved, fail open on a Redis miss, throw
// `RATE_LIMITED` on a real one.
async function enforce(identity: { key: string; ttlSeconds: number }, max: number): Promise<void> {
  const result = await safeRedis(() => incrementWithTtl(identity.key, identity.ttlSeconds), null);
  if (result !== null && result.count > max) {
    throw appError('RATE_LIMITED', RATE_LIMITED_MESSAGE, { retryAfterSeconds: result.ttlSeconds });
  }
}

/**
 * `rateLimit({ route?, windowSeconds, max })` — a tRPC middleware factory.
 * Keys by the authenticated user when `ctx.user` is set, by the request's
 * *trusted* client IP otherwise — always scoped by `route` (or the current
 * path, see `RateLimitConfig.route`), so two different unauthenticated
 * procedures never share a bucket just because they were both called by the
 * same IP. `health.ping` (public, unauthenticated) and `auth.signIn`
 * (`authRateLimit` below) must never contend for the same counter, which is
 * exactly what per-route scoping guarantees and a bare per-IP key would not.
 *
 * Fails open on any Redis failure (`01`'s step 6 table: a counter must
 * never deny service) — `safeRedis`'s `null` fallback here means "Redis
 * didn't answer", and the request is let through rather than guessed at.
 */
export function rateLimit(config: RateLimitConfig) {
  return middleware(async ({ ctx, next, path }) => {
    const route = config.route ?? path;
    const identityValue = ctx.user ? ctx.user.id : trustedClientIp(ctx.request.trustedIp);
    const identity = keys.rateLimit(route, identityValue, config.windowSeconds);

    await enforce(identity, config.max);
    return next();
  });
}

/**
 * The one exception to "always scoped by route": CLAUDE.md §6.5's `auth.*`
 * row is a single throttle **shared across the whole group** — `signIn`,
 * `signUp`, and `refresh` all draw from the same 10-per-15-minute bucket per
 * IP, using `redis-keys.ts`'s dedicated `rl:auth:{ip}` pattern (DB§15) whose
 * 15-minute TTL is fixed by that builder, not configurable here. Attach to
 * a procedure builder every `auth.*` procedure derives from
 * (`rate-limit-config.ts`'s `authProcedure`), never to one individually —
 * the shared bucket is the point, not an accident of reuse.
 */
export function authRateLimit(config: { max: number }) {
  return middleware(async ({ ctx, next }) => {
    const identity = keys.rateLimitAuth(trustedClientIp(ctx.request.trustedIp));

    await enforce(identity, config.max);
    return next();
  });
}

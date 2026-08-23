import { createDbClient, schema, type DbClient, type User } from '@coachos/db';
import { and, eq, isNull } from 'drizzle-orm';

import { env } from '../env.ts';
import { resolveRequestId } from '../lib/request-id.ts';

import { defaultAuthVerifier, type AuthVerifier } from './auth-verifier.ts';

// The closed field list from `02-request-context.md` step 1: identity, the
// profile id authorization keys on, and the two display-layer values
// (`timezone`, `locale`) — not the whole `users` row, which would invite
// resolvers to read stale data off a per-request-constructed object instead
// of querying. `Pick<User, ...>` rather than a hand-written shape, per
// `code-conventions` §3 — every field here still traces back to Drizzle's
// inference.
export type ContextUser = Pick<User, 'id' | 'email' | 'role' | 'timezone' | 'locale'> & {
  coachProfileId: string | null;
  clientProfileId: string | null;
  // Always `null` — a soft-deleted user resolves to a `null` user, never a
  // populated one with this field set (see `resolveUser` below).
  deletedAt: null;
};

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  receivedAt: Date;
}

// Five fields, closed list — adding a sixth needs a note in
// `02-request-context.md`. `user` is `null` or `ContextUser`, never
// `undefined`: that distinction is what lets `isAuthed` narrow it away at
// the type level.
export interface Context {
  user: ContextUser | null;
  db: DbClient;
  redis: RedisLike;
  requestId: string;
  request: RequestMeta;
}

export type AuthenticatedContext = Context & { user: ContextUser };

// Module scope — created once per process, not per request.
// `../authorization-middleware/03-owns-resource.md` and every resolver use
// this; nobody opens a connection of their own.
//
// DB§18.2 says "require minimum, verify-full in production", but
// `packages/db/src/migrate.ts`'s `sslModeFor` already established the real
// exception in practice: the local docker-compose Postgres (`development`)
// and Testcontainers' ephemeral one (`test`) have no TLS listener at all, so
// `require` fails the handshake outright. Mirrors that mapping exactly.
const db = createDbClient({
  connectionString: env.DATABASE_URL,
  sslMode: env.NODE_ENV === 'production' ? 'verify-full' : false,
});

// Placeholder until `../rate-limiting/01-redis-connection-and-keyspace.md`
// swaps in the real ioredis client (its Modify list names this file for
// that swap). Throwing instead of silently no-opping means a forgotten
// call site fails loudly rather than being mistaken for a cache miss.
export interface RedisLike {
  get(key: string): Promise<string | null>;
}
function createUnavailableRedisClient(): RedisLike {
  return {
    // Rejects rather than throwing synchronously — matches the `Promise`
    // return type, so a caller awaiting (or `.catch`-ing) it behaves the
    // same as it will once the real client lands.
    async get() {
      throw new Error(
        'Redis is not wired up yet — see phase-02-api-foundation/rate-limiting/01-redis-connection-and-keyspace.md',
      );
    },
  };
}
const redis = createUnavailableRedisClient();

async function resolveUser(claims: { userId: string }): Promise<ContextUser | null> {
  // `client_profiles.coach_id` is what `ownsResource` compares against, not
  // `users.id` — resolving it in the same query as the user avoids an extra
  // lookup on the single most-executed query in the product.
  const [row] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      role: schema.users.role,
      timezone: schema.users.timezone,
      locale: schema.users.locale,
      deletedAt: schema.users.deletedAt,
      coachProfileId: schema.coachProfiles.id,
      clientProfileId: schema.clientProfiles.id,
    })
    .from(schema.users)
    .leftJoin(
      schema.coachProfiles,
      and(eq(schema.coachProfiles.userId, schema.users.id), isNull(schema.coachProfiles.deletedAt)),
    )
    .leftJoin(
      schema.clientProfiles,
      and(
        eq(schema.clientProfiles.userId, schema.users.id),
        isNull(schema.clientProfiles.deletedAt),
      ),
    )
    .where(eq(schema.users.id, claims.userId))
    .limit(1);

  if (!row || row.deletedAt) {
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    role: row.role,
    timezone: row.timezone,
    locale: row.locale,
    coachProfileId: row.coachProfileId,
    clientProfileId: row.clientProfileId,
    deletedAt: null,
  };
}

function parseBearerToken(header: string | null): string | null {
  if (!header?.startsWith('Bearer ')) {
    return null;
  }
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

function readRequestMeta(req: Request): RequestMeta {
  // Fly's edge sets `fly-client-ip`; `x-forwarded-for`'s first entry is the
  // fallback for local/dev proxies. Neither is trusted for anything beyond
  // an `audit_log` metadata field (DB§5.5).
  const ip =
    req.headers.get('fly-client-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    null;
  return {
    ip,
    userAgent: req.headers.get('user-agent'),
    receivedAt: new Date(),
  };
}

// Never throws — an auth failure is a `null` user, not a 500. That is what
// lets a `publicProcedure` (e.g. `auth.refresh`) serve a request carrying a
// stale token. `../authorization-middleware/01-is-authed.md` is the only
// place that turns a `null` user into `UNAUTHORIZED`.
export function createContextFactory(verifier: AuthVerifier = defaultAuthVerifier) {
  return async function createContext(req: Request): Promise<Context> {
    // Established first, before anything that can fail, so an unexpected
    // error below is still loggable and correlatable.
    const requestId = resolveRequestId(req.headers.get('x-request-id'));
    const request = readRequestMeta(req);

    let user: ContextUser | null = null;
    const token = parseBearerToken(req.headers.get('authorization'));
    if (token) {
      const claims = await verifier(token);
      if (claims && claims.expiresAt > new Date()) {
        // The session cache (`sess:{userId}:{deviceId}`, DB§15, 15 min TTL)
        // is a read-through optimisation P03 populates. Redis is ephemeral
        // by definition — a miss, a malformed entry, or the unavailable
        // stub above must all fall through to Postgres silently, never
        // take the request down.
        try {
          await redis.get(`sess:${claims.userId}:${claims.deviceId}`);
        } catch {
          // fall through to Postgres
        }
        user = await resolveUser(claims);
      }
    }

    return { user, db, redis, requestId, request };
  };
}

export const createContext = createContextFactory();

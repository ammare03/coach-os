// The server-side connection pool — `postgres(...)` wrapped in `drizzle(...)`.
// Both apps/api and the BullMQ worker import `createDbClient`, each with
// their own pool (db-package-scaffold/01's "Configure the pool for the
// deployment shape").
//
// This file never reads `process.env` itself: the connection string is
// supplied by the caller, which for apps/api is always `env.DATABASE_URL`
// from `apps/api/src/env.ts` — the one place server env is read
// (`configuration` skill, CLAUDE.md §16.1).
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema/index.ts';

// DB§3 — resolution order for unqualified table names. Set on the
// connection (not per-session) so every query and every migration this
// pool runs sees the same schema resolution.
const SEARCH_PATH = 'identity, training, nutrition, coaching, platform, public';

export type DbClientOptions = {
  /** Postgres connection string, e.g. `env.DATABASE_URL`. */
  connectionString: string;
  /**
   * Max pool size. CLAUDE.md §3.4.3 and DB§20 both anticipate a single
   * modest VPS running Postgres, Redis, the API, and the ffmpeg worker
   * together — a large pool here starves everything else on that box.
   * Each consumer process (API, worker) sizes its own pool, so the default
   * stays conservative rather than assuming this is the only consumer.
   */
  maxConnections?: number;
  /** `require` locally, `verify-full` in production (DB§18.2). */
  sslMode?: 'require' | 'verify-full' | false;
};

export function createDbClient(options: DbClientOptions) {
  const { connectionString, maxConnections = 10, sslMode = 'require' } = options;

  const client = postgres(connectionString, {
    max: maxConnections,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: sslMode,
    connection: { search_path: SEARCH_PATH },
  });

  return drizzle(client, { schema });
}

export type DbClient = ReturnType<typeof createDbClient>;

const PING_TIMEOUT_MS = 250;

/**
 * Bounded-timeout connectivity probe for `apps/api`'s `/ready` endpoint
 * (`observability/04-health-and-readiness.md`) — mirrors
 * `apps/api/src/lib/redis.ts`'s `pingRedis`: a fast, cheap query with a
 * short timeout, so a hung connection degrades readiness rather than
 * hanging the readiness check itself. Never throws.
 */
export async function pingDb(db: DbClient): Promise<'ok' | 'degraded'> {
  try {
    await Promise.race([
      db.execute(sql`SELECT 1`),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('db ping timed out')), PING_TIMEOUT_MS);
      }),
    ]);
    return 'ok';
  } catch {
    return 'degraded';
  }
}

// The migration runner — `pnpm db:migrate [--env staging|production]`.
// Wraps drizzle-orm's own migration-file reader and applied-migrations
// bookkeeping (db-package-scaffold/03); the only thing it adds on top is:
//
//   1. Splitting a migration marked `-- drizzle:non-transactional`
//      (see migrations/meta/_marker-convention.md) out of the normal
//      transactional path — `CREATE INDEX CONCURRENTLY` and
//      `ALTER TYPE ... ADD VALUE` cannot run inside a `BEGIN`/`COMMIT`
//      (DB§12.3, DB§4).
//   2. The three-target `--env` resolution and the production guard
//      (migrate-env.ts).
//
// It never reimplements SQL parsing or invents a second tracking table —
// `readMigrationFiles` (drizzle-orm's own file reader) supplies the split
// statements and the file hash, and applied migrations are recorded in the
// exact `drizzle.__drizzle_migrations` shape drizzle-orm's built-in migrator
// uses, so `drizzle-kit`'s own tooling stays consistent with what this
// runner did.
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator';

import { createDbClient, type DbClient } from './client.ts';
import {
  assertProductionGuard,
  readEnvironmentFlag,
  resolveConnectionString,
  type MigrationEnvironment,
} from './migrate-env.ts';

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));
const MIGRATIONS_SCHEMA = 'drizzle';
const MIGRATIONS_TABLE = '__drizzle_migrations';

// The exact string migrations/meta/_marker-convention.md documents. Keep
// the two in sync — this constant IS the spelling that convention promises.
const NON_TRANSACTIONAL_MARKER = '-- drizzle:non-transactional';

function sslModeFor(target: MigrationEnvironment) {
  // Local docker-compose Postgres has no TLS listener (db-package-scaffold/01
  // established this). Staging/production are real network hosts and DB§18.2
  // is explicit: require at minimum, verify-full in production.
  if (target === 'local') return false as const;
  if (target === 'staging') return 'require' as const;
  return 'verify-full' as const;
}

/** Strips a leading marker line from the migration's first statement, if present. */
function splitMarker(statements: string[]): { nonTransactional: boolean; statements: string[] } {
  const [first, ...rest] = statements;
  if (first === undefined) return { nonTransactional: false, statements };

  const lines = first.split(/\r?\n/);
  const firstLine = lines.find((line) => line.trim().length > 0)?.trim();
  if (firstLine !== NON_TRANSACTIONAL_MARKER) {
    return { nonTransactional: false, statements };
  }

  const withoutMarker = lines
    .filter((line) => line.trim() !== NON_TRANSACTIONAL_MARKER)
    .join('\n')
    .trim();
  const cleaned = withoutMarker.length > 0 ? [withoutMarker, ...rest] : rest;
  return { nonTransactional: true, statements: cleaned };
}

async function ensureMigrationsTable(db: DbClient): Promise<void> {
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS ${sql.identifier(MIGRATIONS_SCHEMA)}`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(MIGRATIONS_TABLE)} (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);
}

async function lastAppliedCreatedAt(db: DbClient): Promise<number> {
  const rows = await db.execute<{ created_at: string | null }>(sql`
    SELECT created_at FROM ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(MIGRATIONS_TABLE)}
    ORDER BY created_at DESC LIMIT 1
  `);
  const latest = rows[0]?.created_at;
  return latest === null || latest === undefined ? -1 : Number(latest);
}

async function recordApplied(db: DbClient, hash: string, createdAt: number): Promise<void> {
  await db.execute(sql`
    INSERT INTO ${sql.identifier(MIGRATIONS_SCHEMA)}.${sql.identifier(MIGRATIONS_TABLE)} (hash, created_at)
    VALUES (${hash}, ${createdAt})
  `);
}

async function applyTransactional(
  db: DbClient,
  statements: string[],
  label: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [index, statement] of statements.entries()) {
      try {
        await tx.execute(sql.raw(statement));
      } catch (cause) {
        throw new Error(
          `Migration "${label}" failed at statement ${index + 1}/${statements.length} ` +
            `(transactional — the whole file was rolled back, nothing from it is applied):\n${statement}`,
          { cause },
        );
      }
    }
  });
}

async function applyNonTransactional(
  db: DbClient,
  statements: string[],
  label: string,
): Promise<void> {
  for (const [index, statement] of statements.entries()) {
    try {
      await db.execute(sql.raw(statement));
    } catch (cause) {
      throw new Error(
        `Migration "${label}" failed at statement ${index + 1}/${statements.length} ` +
          `(non-transactional — statement(s) 1-${index} above already committed and were ` +
          `NOT rolled back; DB§12.4 has no automatic down-migration, fix forward with a new migration):\n${statement}`,
        { cause },
      );
    }
  }
}

export async function runMigrations(argv: string[]): Promise<void> {
  const target = readEnvironmentFlag(argv);
  assertProductionGuard(target);

  const db = createDbClient({
    connectionString: resolveConnectionString(target),
    sslMode: sslModeFor(target),
  });

  try {
    await ensureMigrationsTable(db);
    const lastApplied = await lastAppliedCreatedAt(db);

    const journal: MigrationMeta[] = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
    const pending = journal
      .filter((entry) => entry.folderMillis > lastApplied)
      .sort((a, b) => a.folderMillis - b.folderMillis);

    if (pending.length === 0) {
      console.log(`[db:migrate --env ${target}] nothing to apply, already up to date.`);
      return;
    }

    for (const entry of pending) {
      const { nonTransactional, statements } = splitMarker(entry.sql);
      const label = new Date(entry.folderMillis).toISOString();

      console.log(
        `[db:migrate --env ${target}] applying migration @${label} ` +
          `(${nonTransactional ? 'non-transactional' : 'transactional'}, ${statements.length} statement(s))`,
      );

      if (nonTransactional) {
        await applyNonTransactional(db, statements, label);
      } else {
        await applyTransactional(db, statements, label);
      }

      await recordApplied(db, entry.hash, entry.folderMillis);
    }

    console.log(`[db:migrate --env ${target}] applied ${pending.length} migration(s).`);
  } finally {
    await db.$client.end();
  }
}

const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainModule) {
  runMigrations(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

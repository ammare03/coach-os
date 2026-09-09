// F4 (pre-phase-09 audit): DB§7 claims "Every FK is indexed. No exceptions,"
// enforced by "our migration lint rule" — no such rule exists anywhere in
// the repo. This is that guard: enumerate every FK against the live,
// migrated schema (real Postgres via Testcontainers, matching
// `recompute-daily-summary.test.ts`'s pattern — a hand-built minimal schema
// would drift from what `pnpm db:migrate` actually produces) and fail on
// any unindexed one not already named in `UNINDEXED_FOREIGN_KEYS`.
//
// "Covered" means an index exists whose leading column(s), in order, are
// the FK's own columns — a real column reference, not an expression. An
// index on (a, b) covers a plain FK on `a` but not one on `b`; a composite
// FK on (a, b) needs an index leading `a, b` in that order; an expression
// index (`coalesce(coach_id, sentinel)`) never covers a bare `coach_id`
// equality, because Postgres records an expression key as attnum 0 in
// `pg_index.indkey`, which can never equal a real column's attnum.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { sql } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { createDbClient, type DbClient } from '../client.ts';

import { UNINDEXED_FOREIGN_KEYS } from './fk-index-coverage.ts';

let container: StartedTestContainer;
let db: DbClient;

beforeAll(async () => {
  container = await new GenericContainer('postgres:16')
    .withEnvironment({
      POSTGRES_USER: 'coachos',
      POSTGRES_PASSWORD: 'coachos',
      POSTGRES_DB: 'coachos',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
    .start();

  const connectionString = `postgres://coachos:coachos@${container.getHost()}:${container.getMappedPort(5432)}/coachos`; // secret-scan-ignore — well-known local dev credential, same as docker-compose.yml/.env

  // Real CLI, real migrations — see recompute-daily-summary.test.ts's own
  // comment for why this is spawned rather than imported.
  const migrateScript = path.join(__dirname, '..', 'migrate.ts');
  execFileSync(process.execPath, ['--experimental-strip-types', migrateScript], {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'inherit',
  });

  db = createDbClient({ connectionString, sslMode: false });
}, 60_000);

afterAll(async () => {
  await db.$client.end();
  await container.stop();
}, 60_000);

type ForeignKeyRow = {
  conname: string;
  schemaName: string;
  tableName: string;
  fkAttnums: number[];
};

type IndexRow = {
  schemaName: string;
  tableName: string;
  indkeyText: string;
};

/** Every FK constraint in the live schema, with its ordered column attnums. */
async function listForeignKeys(): Promise<ForeignKeyRow[]> {
  const rows = await db.execute<{
    conname: string;
    schema_name: string;
    table_name: string;
    fk_attnums: number[];
  }>(sql`
    SELECT
      c.conname,
      n.nspname AS schema_name,
      t.relname AS table_name,
      c.conkey AS fk_attnums
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.contype = 'f'
    ORDER BY n.nspname, t.relname, c.conname
  `);
  return rows.map((r) => ({
    conname: r.conname,
    schemaName: r.schema_name,
    tableName: r.table_name,
    fkAttnums: r.fk_attnums,
  }));
}

/**
 * Every index in the live schema, keyed by table. `indkey::text` is cast to
 * a space-separated string of attnums — `int2vector` (its native type)
 * isn't a standard Postgres array and the driver won't parse it. An
 * expression key (not a plain column reference) prints as `0`, which can
 * never equal a real FK column's attnum — the mechanism that correctly
 * disqualifies an expression index from covering a bare-column FK.
 */
async function listIndexes(): Promise<IndexRow[]> {
  const rows = await db.execute<{
    schema_name: string;
    table_name: string;
    indkey_text: string;
  }>(sql`
    SELECT
      n.nspname AS schema_name,
      t.relname AS table_name,
      i.indkey::text AS indkey_text
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
  `);
  return rows.map((r) => ({
    schemaName: r.schema_name,
    tableName: r.table_name,
    indkeyText: r.indkey_text,
  }));
}

function isCovered(fk: ForeignKeyRow, indexes: readonly IndexRow[]): boolean {
  return indexes.some((idx) => {
    if (idx.schemaName !== fk.schemaName || idx.tableName !== fk.tableName) return false;
    const indkeys = idx.indkeyText.split(' ').filter(Boolean).map(Number);
    if (indkeys.length < fk.fkAttnums.length) return false;
    // Leading columns must match, in order. attnum 0 (an expression column)
    // never equals a real FK attnum, so expression indexes fail here.
    return fk.fkAttnums.every((attnum, i) => indkeys[i] === attnum);
  });
}

describe('every foreign key is either indexed or a documented exception', () => {
  it('has no unindexed FK outside UNINDEXED_FOREIGN_KEYS', async () => {
    const [fks, indexes] = await Promise.all([listForeignKeys(), listIndexes()]);
    const excused = new Set(UNINDEXED_FOREIGN_KEYS.map((e) => e.constraint));

    const uncovered = fks.filter((fk) => !isCovered(fk, indexes));
    const undocumented = uncovered.filter((fk) => !excused.has(fk.conname));

    expect(undocumented.map((fk) => fk.conname)).toEqual([]);
  });

  it('does not carry a stale exclusion for an FK that no longer exists', async () => {
    const fks = await listForeignKeys();
    const liveNames = new Set(fks.map((fk) => fk.conname));

    const stale = UNINDEXED_FOREIGN_KEYS.filter((e) => !liveNames.has(e.constraint));

    expect(stale.map((e) => e.constraint)).toEqual([]);
  });

  it('does not carry a stale exclusion for an FK that got indexed', async () => {
    const [fks, indexes] = await Promise.all([listForeignKeys(), listIndexes()]);
    const fkByName = new Map(fks.map((fk) => [fk.conname, fk]));

    const nowCovered = UNINDEXED_FOREIGN_KEYS.filter((e) => {
      const fk = fkByName.get(e.constraint);
      return fk !== undefined && isCovered(fk, indexes);
    });

    // The list can only shrink — if this fires, delete that entry.
    expect(nowCovered.map((e) => e.constraint)).toEqual([]);
  });

  // The live example DB§7's audit named directly: an expression index can
  // look like coverage at a glance but cannot support a bare-column
  // equality lookup. Pinned so a future covering-logic "simplification"
  // can't quietly start treating it as indexed.
  it('classifies training.exercises.coach_id as unindexed', async () => {
    const [fks, indexes] = await Promise.all([listForeignKeys(), listIndexes()]);
    const fk = fks.find((f) => f.conname === 'exercises_coach_id_coach_profiles_id_fk');
    expect(fk).toBeDefined();
    expect(isCovered(fk as ForeignKeyRow, indexes)).toBe(false);
  });
});

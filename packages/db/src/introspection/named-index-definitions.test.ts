// A1/A9 (UNFORGET): the four indexes migration 0033 adds are the hot paths
// behind the coach dashboard's needs-review counter, the client-detail
// Training tab, the logger's `(client_id, scheduled_date)` read, and
// `v_client_overview`'s `unreviewed_videos` subquery.
//
// What this test protects is NOT "is the plan fast" — an `EXPLAIN` assertion
// turns on ANALYZE sampling and is a coin flip on a freshly migrated,
// never-analyzed database. It is the failure mode that actually happens:
// a regenerated migration that silently loses a partial predicate, a column,
// or a `DESC` ordering. Drizzle has dropped a `.where()` before.
//
// The expected definitions below are hardcoded ON PURPOSE. The authoritative
// list lives in `DATABASE.md` DB§7, which is gitignored and absent on CI —
// reading it from a test would pass locally and fail the moment CI runs.
//
// The catalogue is decomposed (name, ordered columns, per-column sort
// direction, predicate) rather than string-matched against
// `pg_get_indexdef`, whose output carries schema-qualified enum casts and
// Postgres's own parenthesisation — both of which change with no change in
// meaning.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { sql } from 'drizzle-orm';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { createDbClient, type DbClient } from '../client.ts';

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

  // Real CLI, real migrations — matching `fk-index-coverage.test.ts`. A
  // hand-built schema would drift from what `pnpm db:migrate` produces,
  // which is the exact drift this test exists to catch.
  const migrateScript = path.join(__dirname, '..', 'migrate.ts');
  execFileSync(process.execPath, ['--experimental-strip-types', migrateScript], {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'inherit',
  });

  db = createDbClient({ connectionString, sslMode: false });
}, 120_000);

afterAll(async () => {
  await db.$client.end();
  await container.stop();
}, 60_000);

type ExpectedIndex = {
  name: string;
  schemaName: string;
  tableName: string;
  /** Ordered. `desc: true` means the catalogue must record DESC for that key. */
  columns: readonly { name: string; desc: boolean }[];
  /** Normalised (see `normalisePredicate`); `null` means a full, non-partial index. */
  predicate: string | null;
  unique: boolean;
};

const EXPECTED: readonly ExpectedIndex[] = [
  {
    name: 'sessions_client_date',
    schemaName: 'training',
    tableName: 'workout_sessions',
    columns: [
      { name: 'client_id', desc: false },
      { name: 'scheduled_date', desc: true },
    ],
    predicate: null,
    unique: false,
  },
  {
    name: 'sessions_coach_unreviewed',
    schemaName: 'training',
    tableName: 'workout_sessions',
    columns: [
      { name: 'coach_id', desc: false },
      { name: 'completed_at', desc: true },
    ],
    // Load-bearing: this predicate is the whole reason the needs-review
    // counter is cheap. Losing any conjunct silently makes the index
    // full-size and stops it matching the query it was built for.
    predicate: "status = 'completed' and reviewed_at is null and deleted_at is null",
    unique: false,
  },
  {
    name: 'sessions_coach_range',
    schemaName: 'training',
    tableName: 'workout_sessions',
    columns: [
      { name: 'coach_id', desc: false },
      { name: 'scheduled_date', desc: false },
    ],
    predicate: null,
    unique: false,
  },
  {
    name: 'media_assets_client_id_idx',
    schemaName: 'coaching',
    tableName: 'media_assets',
    columns: [{ name: 'client_id', desc: false }],
    predicate: null,
    unique: false,
  },
];

type IndexShape = {
  schemaName: string;
  tableName: string;
  columns: { name: string; desc: boolean }[];
  predicate: string | null;
  unique: boolean;
};

/**
 * Postgres renders a stored predicate with its own parenthesisation and with
 * schema-qualified casts on enum literals (`'completed'::training.session_status`).
 * Neither carries meaning, and both change when an unrelated type is renamed —
 * so strip both before comparing.
 */
function normalisePredicate(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/::[a-z0-9_."]+(\[\])?/g, '')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * One row per index key, with the sort direction decoded from
 * `pg_index.indoption`. Bit 0 of each element is DESC — the only reliable
 * catalogue source for an ordering, since `indkey` records columns alone.
 */
async function readIndex(name: string): Promise<IndexShape | null> {
  const rows = await db.execute<{
    schema_name: string;
    table_name: string;
    column_name: string;
    key_position: number;
    is_desc: boolean;
    predicate: string | null;
    is_unique: boolean;
  }>(sql`
    SELECT
      n.nspname                                        AS schema_name,
      t.relname                                        AS table_name,
      a.attname                                        AS column_name,
      k.ordinality                                     AS key_position,
      (i.indoption[k.ordinality - 1] & 1) = 1          AS is_desc,
      pg_get_expr(i.indpred, i.indrelid)               AS predicate,
      i.indisunique                                    AS is_unique
    FROM pg_index i
    JOIN pg_class ix ON ix.oid = i.indexrelid
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ordinality)
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
    WHERE ix.relname = ${name}
      AND k.ordinality <= i.indnkeyatts
    ORDER BY k.ordinality
  `);

  const first = rows[0];
  if (first === undefined) return null;

  return {
    schemaName: first.schema_name,
    tableName: first.table_name,
    columns: rows.map((r) => ({ name: r.column_name, desc: r.is_desc })),
    predicate: first.predicate === null ? null : normalisePredicate(first.predicate),
    unique: first.is_unique,
  };
}

describe("DB§7's named indexes exist with exactly the definition they were specified with", () => {
  it.each(EXPECTED.map((e) => [e.name, e] as const))('%s', async (_name, expected) => {
    const actual = await readIndex(expected.name);

    expect(actual).not.toBeNull();
    expect(actual).toEqual({
      schemaName: expected.schemaName,
      tableName: expected.tableName,
      columns: expected.columns.map((c) => ({ name: c.name, desc: c.desc })),
      predicate: expected.predicate,
      unique: expected.unique,
    });
  });

  // The one conjunct a regeneration is most likely to lose, asserted on its
  // own so the failure names itself rather than arriving as a diff of a
  // whole object.
  it('keeps every conjunct of the needs-review partial predicate', async () => {
    const actual = await readIndex('sessions_coach_unreviewed');

    expect(actual?.predicate).toContain("status = 'completed'");
    expect(actual?.predicate).toContain('reviewed_at is null');
    expect(actual?.predicate).toContain('deleted_at is null');
  });

  // An index that exists but sorts the wrong way still answers the query —
  // slowly, by sorting the whole result. Nothing else in the suite notices.
  it('records DESC on the sort key of both descending indexes', async () => {
    const [clientDate, coachUnreviewed] = await Promise.all([
      readIndex('sessions_client_date'),
      readIndex('sessions_coach_unreviewed'),
    ]);

    expect(clientDate?.columns.at(-1)).toEqual({ name: 'scheduled_date', desc: true });
    expect(coachUnreviewed?.columns.at(-1)).toEqual({ name: 'completed_at', desc: true });
  });
});

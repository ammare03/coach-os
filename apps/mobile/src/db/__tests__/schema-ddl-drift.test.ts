import { getTableColumns, is } from 'drizzle-orm';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';

import * as schema from '../schema/index.ts';

// The guard `local-training.ts` (and the other three schema files) point
// readers at when they say "keep this in lockstep with the Drizzle
// definitions above". Each schema file describes its tables twice — once as
// typed Drizzle columns (what the app queries against), once as a literal
// `CREATE TABLE IF NOT EXISTS` string (what `client.ts`'s bootstrap actually
// runs, per DB§13's "drop and re-fetch, never migrate" rule) — and nothing
// but a comment kept those two descriptions in sync. This file replaces the
// comment with an assertion: it reconstructs both descriptions independently
// and fails, naming the table and the column, the moment they disagree.
//
// Deliberately does NOT open `expo-sqlite` or touch `client.ts` — everything
// here is static introspection of the schema module.

type SqlAffinity = 'TEXT' | 'INTEGER' | 'REAL';

type ColumnFacts = {
  column: string;
  type: SqlAffinity;
  notNull: boolean;
};

// SQLite's storage classes, not Drizzle's column-builder discriminators —
// `SQLiteBoolean` is DB§13's "booleans-as-0/1", the same INTEGER storage
// class as a plain integer column, not a fourth SQL type.
const DRIZZLE_COLUMN_TYPE_TO_SQL_AFFINITY: Record<string, SqlAffinity> = {
  SQLiteText: 'TEXT',
  SQLiteInteger: 'INTEGER',
  SQLiteBoolean: 'INTEGER',
  SQLiteReal: 'REAL',
};

function toSqlAffinity(columnType: string): SqlAffinity {
  const affinity = DRIZZLE_COLUMN_TYPE_TO_SQL_AFFINITY[columnType];
  if (!affinity) {
    // Fail loudly rather than silently pass a column this test doesn't know
    // how to check — a new Drizzle column type here is exactly the kind of
    // thing that should force someone to look at this file, not skip past it.
    throw new Error(
      `schema-ddl-drift.test.ts doesn't know the SQL affinity of Drizzle column type "${columnType}" — add it to DRIZZLE_COLUMN_TYPE_TO_SQL_AFFINITY.`,
    );
  }
  return affinity;
}

/** Splits `text` on `separator` only at paren-depth 0 — good enough for a
 * column list where the only parens are a `REFERENCES table(col)` tail. */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === separator && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts;
}

/**
 * Parses one `CREATE TABLE IF NOT EXISTS <name> (...)` statement into its
 * table name and column facts. Returns `null` for anything else (this
 * file's `*_SCHEMA_SQL` arrays also contain `CREATE INDEX` statements).
 * A small, readable parser over SQL this file itself controls — not a
 * general-purpose one.
 */
function parseCreateTable(statement: string): { tableName: string; columns: ColumnFacts[] } | null {
  const match = /^CREATE TABLE IF NOT EXISTS\s+(\w+)\s*\(([\s\S]*)\)\s*$/i.exec(statement.trim());
  const tableName = match?.[1];
  const body = match?.[2];
  if (!tableName || body === undefined) return null;

  const columns: ColumnFacts[] = [];
  for (const rawEntry of splitTopLevel(body, ',')) {
    const entry = rawEntry.trim().replace(/\s+/g, ' ');
    if (!entry) continue;
    const [name, typeToken] = entry.split(' ');
    if (!name || !typeToken) continue;
    // No table-level constraints exist in this schema today (every FK and
    // every primary key is written inline on its column) — skip defensively
    // rather than mis-parse one if a future table adds one.
    if (/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)$/i.test(name)) continue;
    const type = typeToken.toUpperCase();
    if (type !== 'TEXT' && type !== 'INTEGER' && type !== 'REAL') continue;
    // A PRIMARY KEY column has no literal "NOT NULL" in this schema's DDL,
    // but SQLite (like the SQL standard) treats PRIMARY KEY as implying it —
    // and Drizzle's `.primaryKey()` sets `notNull: true` at runtime with no
    // separate `.notNull()` call, confirmed against every `id`/`key` column
    // here. Both must be read as NOT NULL or every primary key column in
    // this file would falsely report as drifted.
    const notNull = /NOT NULL/i.test(entry) || /PRIMARY KEY/i.test(entry);
    columns.push({ column: name, type, notNull });
  }
  return { tableName, columns };
}

function sortByColumn(columns: ColumnFacts[]): ColumnFacts[] {
  return [...columns].sort((a, b) => a.column.localeCompare(b.column));
}

// ---- Side A: every CREATE TABLE across the four *_SCHEMA_SQL exports ----
const ddlTables = new Map<string, ColumnFacts[]>();
for (const [exportName, value] of Object.entries(schema)) {
  if (!exportName.endsWith('_SCHEMA_SQL')) continue;
  if (!Array.isArray(value)) continue;
  for (const statement of value) {
    if (typeof statement !== 'string') continue;
    const parsed = parseCreateTable(statement);
    if (!parsed) continue; // e.g. outbox_ready's CREATE INDEX
    ddlTables.set(parsed.tableName, parsed.columns);
  }
}

// ---- Side B: every SQLiteTable exported from the schema barrel ----
const drizzleTables = new Map<string, ColumnFacts[]>();
for (const value of Object.values(schema)) {
  if (!is(value, SQLiteTable)) continue;
  const tableName = getTableConfig(value).name;
  const columns = Object.values(getTableColumns(value)).map((column): ColumnFacts => ({
    column: column.name,
    type: toSqlAffinity(column.columnType),
    notNull: column.notNull,
  }));
  drizzleTables.set(tableName, columns);
}

describe('Drizzle table definitions vs. hand-written bootstrap DDL', () => {
  it('describe exactly the same set of tables', () => {
    expect([...drizzleTables.keys()].sort()).toEqual([...ddlTables.keys()].sort());
  });

  const sharedTableNames = [...drizzleTables.keys()].filter((name) => ddlTables.has(name)).sort();

  it.each(sharedTableNames)('%s: columns, NOT NULL, and SQL type agree', (tableName) => {
    const drizzleColumns = drizzleTables.get(tableName);
    const ddlColumns = ddlTables.get(tableName);
    if (!drizzleColumns || !ddlColumns) {
      throw new Error(
        `missing side for "${tableName}" — should be unreachable given sharedTableNames`,
      );
    }
    // Sorted so the Jest diff on mismatch lines up column-for-column and
    // names the exact column (and which of name/type/notNull) that drifted.
    expect(sortByColumn(drizzleColumns)).toEqual(sortByColumn(ddlColumns));
  });
});

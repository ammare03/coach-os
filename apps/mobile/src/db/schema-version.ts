import { sql } from 'drizzle-orm';

import type { LocalDb } from './client.ts';
import { getLocalDb } from './client.ts';
import { wipeLocalDatabase } from './wipe.ts';

// `local-database/04` — DB§13's rule: schema version lives in `meta`; on
// mismatch, drop and re-fetch rather than migrate (`offline-sync` skill §8).
// There is deliberately no migration path here to tempt anyone — a version
// bump always means `resolveSchemaVersionMismatch()`'s wipe-and-recreate,
// never an ALTER TABLE sequence.

/**
 * Bump this whenever `local-database/02`'s table shapes change — column
 * added/removed/retyped, an index changed, a new table. This constant is
 * the ONE thing a future schema change must remember to update; everything
 * else in this file reacts to it automatically.
 */
export const EXPECTED_SCHEMA_VERSION = 1;

const SCHEMA_VERSION_META_KEY = 'schema_version';

export type OutboxGroupCount = {
  procedure: string;
  label: string;
  count: number;
};

export type SchemaVersionCheckResult =
  | { status: 'ok' }
  /**
   * `counts === null` means the outbox itself could not be read (state 4 —
   * the mismatch is severe enough that even counting failed). Never a
   * guessed number and never a silent zero.
   */
  | { status: 'confirm-required'; counts: OutboxGroupCount[] | null };

// Friendly labels for the confirmation dialog's counts list
// (`local-database/04`'s approved copy). Deliberately a small map with a
// fallback rather than a table lookup — the outbox's procedure names are a
// closed, small set and a label anyone forgets to add here still renders,
// just generically.
const PROCEDURE_LABELS: Readonly<Record<string, string>> = {
  'workouts.logSet': 'Logged sets',
  'nutrition.logMeal': 'Meals',
  'formcheck.upload': 'Form checks',
  'checkins.submit': 'Check-ins',
  'messaging.sendMessage': 'Messages',
  'habits.checkOff': 'Habit check-offs',
  'comments.create': 'Comments',
};
const FALLBACK_PROCEDURE_LABEL = 'Other entries';

export function labelForOutboxProcedure(procedure: string): string {
  return PROCEDURE_LABELS[procedure] ?? FALLBACK_PROCEDURE_LABEL;
}

/**
 * Reads `meta.schema_version` and compares it against
 * `EXPECTED_SCHEMA_VERSION`. This is the first thing in the app that calls
 * `getLocalDb()` — see `app/_layout.tsx`'s gating order — so nothing else
 * ever reads a stale-schema database.
 *
 * - Absent (first run) — writes the current version and resolves `'ok'`.
 * - Matches — resolves `'ok'` with no further work; this is one `SELECT`
 *   and must not cost the cold-start budget (`CLAUDE.md` §19).
 * - Mismatched, outbox empty — wipes and recreates silently, then resolves
 *   `'ok'`. Only re-fetchable cache is lost; there is nothing to confirm.
 * - Mismatched, outbox has unsynced rows — resolves `'confirm-required'`
 *   WITHOUT wiping anything. The caller (`useSchemaVersionGate`) must call
 *   `confirmSchemaVersionReset()` after the user explicitly confirms.
 */
export async function checkSchemaVersion(): Promise<SchemaVersionCheckResult> {
  const db = await getLocalDb();
  const stored = db.get<{ value: string | null }>(
    sql`SELECT value FROM meta WHERE key = ${SCHEMA_VERSION_META_KEY}`,
  );

  if (stored === undefined) {
    writeSchemaVersion(db);
    return { status: 'ok' };
  }

  if (Number(stored.value) === EXPECTED_SCHEMA_VERSION) {
    return { status: 'ok' };
  }

  const counts = readPendingOutboxCounts(db);

  if (counts === null) {
    return { status: 'confirm-required', counts: null };
  }
  if (counts.length === 0) {
    await performReset();
    return { status: 'ok' };
  }
  return { status: 'confirm-required', counts };
}

/**
 * Performs the drop-and-recreate the user just confirmed. Reuses
 * `wipeLocalDatabase({ force: true })` rather than a second delete path —
 * `local-database/03`'s outbox-pending block is exactly what a schema
 * mismatch must bypass, but only after this explicit confirmation, never
 * silently (`local-database/04`'s Risks section).
 */
export async function confirmSchemaVersionReset(): Promise<void> {
  await performReset();
}

async function performReset(): Promise<void> {
  const result = await wipeLocalDatabase({ force: true });
  if (result.outcome !== 'wiped') {
    throw new Error(`schema-version reset could not wipe the local database: ${result.outcome}`);
  }
  // `getLocalDb()` re-bootstraps the fresh, empty file (client.ts's
  // CREATE TABLE IF NOT EXISTS statements) — writing the version here,
  // never skipping it, is what stops the next launch from mismatching
  // again and looping straight back into this dialog.
  const db = await getLocalDb();
  writeSchemaVersion(db);
}

function writeSchemaVersion(db: LocalDb): void {
  db.run(
    sql`INSERT INTO meta (key, value) VALUES (${SCHEMA_VERSION_META_KEY}, ${String(EXPECTED_SCHEMA_VERSION)})
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
}

/** `null` — not `[]` — signals "could not read", so the caller never confuses "nothing pending" with "couldn't tell". */
function readPendingOutboxCounts(db: LocalDb): OutboxGroupCount[] | null {
  try {
    const rows = db.all<{ procedure: string; count: number }>(
      sql`SELECT procedure, COUNT(*) AS count FROM outbox WHERE status != 'done' GROUP BY procedure ORDER BY procedure`,
    );
    return rows.map((row) => ({
      procedure: row.procedure,
      label: labelForOutboxProcedure(row.procedure),
      count: row.count,
    }));
  } catch {
    return null;
  }
}

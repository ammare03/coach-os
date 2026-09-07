import { schema, type DbClient } from '@coachos/db';
import { and, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';

import { dispatchAlert } from '../../lib/alerts.ts';
import { logger } from '../../lib/logger.ts';

import { ownedByCoach } from './visibility.ts';

// The four `exercise-reconcile` passes (`exercise-library/06`). Each one is
// exported and independently callable — they share a schedule and nothing
// else, which is what lets `../../jobs/exercise-reconcile.ts` run them in
// four separate try/catch blocks and still report pass 1 when pass 4 blows
// up (that task's Approach step 5).
//
// Three of the four are read-only. The one exception is pass 2, and its
// write surface is deliberately narrow — see `refreshStaleDisplayNames`.
// Nothing here ever touches `set_logs`, `personal_records`, or a completed
// session, and nothing here ever swaps or merges an exercise: those are
// coaching decisions, and a string-similarity guess is not allowed to make
// one (that task's Risks).

// ---------------------------------------------------------------------------
// Pass 1 — archived exercises still prescribed in a live program
// ---------------------------------------------------------------------------

/** One (archived exercise, program day) pair a client will walk into. */
export interface ArchivedPrescription {
  exerciseId: string;
  exerciseName: string;
  programId: string;
  programName: string;
  weekNumber: number;
  dayNumber: number;
  dayName: string;
}

/**
 * Archived exercises still referenced by one of this coach's non-archived
 * programs. A client reaching one of these mid-session gets
 * `EXERCISE_UNAVAILABLE` (`ERRORS.md` ER§1.5), so the point of the pass is
 * to put it in front of the coach first.
 *
 * **Reports only.** Substituting an exercise is a coaching decision, and
 * an auto-swap driven by name similarity would silently rewrite a client's
 * programme. There is no write in this function and there must never be
 * one.
 *
 * "Live" is `programs.archived_at IS NULL`, not "has an active assignment":
 * a template the coach is still building from is exactly where they want
 * to find this before it reaches anybody.
 */
export async function findArchivedButPrescribed(
  db: DbClient,
  coachProfileId: string,
): Promise<ArchivedPrescription[]> {
  return (
    db
      .select({
        exerciseId: schema.exercises.id,
        exerciseName: schema.exercises.name,
        programId: schema.programs.id,
        programName: schema.programs.name,
        weekNumber: schema.programWeeks.weekNumber,
        dayNumber: schema.programDays.dayNumber,
        dayName: schema.programDays.name,
      })
      .from(schema.programExercises)
      .innerJoin(
        schema.programDays,
        eq(schema.programDays.id, schema.programExercises.programDayId),
      )
      .innerJoin(schema.programWeeks, eq(schema.programWeeks.id, schema.programDays.programWeekId))
      .innerJoin(schema.programs, eq(schema.programs.id, schema.programWeeks.programId))
      .innerJoin(schema.exercises, eq(schema.exercises.id, schema.programExercises.exerciseId))
      .where(
        and(
          eq(schema.programs.coachId, coachProfileId),
          isNull(schema.programs.archivedAt),
          isNotNull(schema.exercises.archivedAt),
        ),
      )
      // Stable ordering so a digest built from this reads the same twice and
      // a test can assert on it without sorting first.
      .orderBy(
        schema.exercises.name,
        schema.programs.name,
        schema.programWeeks.weekNumber,
        schema.programDays.dayNumber,
      )
  );
}

// ---------------------------------------------------------------------------
// Pass 2 — stale denormalised names
// ---------------------------------------------------------------------------

/**
 * The keys a snapshot entry might carry a copied exercise name under. Both
 * are refreshed if present; **neither is ever added**. `program_snapshot`'s
 * writer is `phase-09-workout-logger/session-runtime/09`, which does not
 * exist yet — the only snapshot this repo produces today
 * (`packages/db/src/seed/training-history.ts`) stores `exerciseId` and
 * target numbers and no name at all, so this pass writes nothing in
 * practice until P09 decides to denormalise one. Guessing a key and
 * inserting it would be this task inventing P09's contract.
 */
const SNAPSHOT_NAME_KEYS = ['name', 'exerciseName'] as const;

/** One session whose snapshot carried a name that had since changed. */
export interface RefreshedSnapshot {
  sessionId: string;
  /** How many snapshot entries had a stale name corrected. */
  entriesRefreshed: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Refreshes exercise names copied for display into a session's
 * `program_snapshot`.
 *
 * **A completed session is excluded, and that exclusion is the point of the
 * pass.** `program_snapshot` is the record of what was actually prescribed
 * at the time; rewriting it destroys the one artefact a coach and client
 * might later disagree about (`exercise-library/06` Risks). Skipped
 * sessions are excluded for the same reason — they are equally historical.
 * Only `scheduled` and `in_progress` sessions, which still describe work
 * ahead, are eligible, and `deleted_at IS NULL` keeps soft-deleted rows out.
 *
 * A rename needs no reconciliation anywhere else: `exercise_id` is stable
 * and every join picks the new name up for free, which is why this job is
 * small (that task's Approach step 6). There is no other server-side copy
 * of an exercise name in the schema — device caches re-read from the API,
 * and report artefacts do not exist yet.
 */
export async function refreshStaleDisplayNames(
  db: DbClient,
  coachProfileId: string,
): Promise<RefreshedSnapshot[]> {
  const sessions = await db
    .select({
      id: schema.workoutSessions.id,
      programSnapshot: schema.workoutSessions.programSnapshot,
    })
    .from(schema.workoutSessions)
    .where(
      and(
        eq(schema.workoutSessions.coachId, coachProfileId),
        ne(schema.workoutSessions.status, 'completed'),
        ne(schema.workoutSessions.status, 'skipped'),
        isNull(schema.workoutSessions.completedAt),
        isNull(schema.workoutSessions.deletedAt),
        isNotNull(schema.workoutSessions.programSnapshot),
      ),
    );

  if (sessions.length === 0) return [];

  const currentNames = new Map(
    (
      await db
        .select({ id: schema.exercises.id, name: schema.exercises.name })
        .from(schema.exercises)
    ).map((row) => [row.id, row.name] as const),
  );

  const refreshed: RefreshedSnapshot[] = [];

  for (const session of sessions) {
    const rewritten = rewriteSnapshotNames(session.programSnapshot, currentNames);
    if (rewritten === null) continue;

    await db
      .update(schema.workoutSessions)
      .set({ programSnapshot: rewritten.snapshot })
      .where(eq(schema.workoutSessions.id, session.id));

    refreshed.push({ sessionId: session.id, entriesRefreshed: rewritten.entriesRefreshed });
  }

  return refreshed;
}

/**
 * Returns `null` when nothing was stale — the caller uses that to avoid an
 * UPDATE (and the `updated_at` touch that comes with it) on a session that
 * did not change. Unknown keys are preserved verbatim: this rewrites the
 * name it was given and copies everything else through, so a richer P09
 * snapshot survives the pass intact.
 */
function rewriteSnapshotNames(
  snapshot: unknown,
  currentNames: ReadonlyMap<string, string>,
): { snapshot: Record<string, unknown>; entriesRefreshed: number } | null {
  if (!isRecord(snapshot)) return null;
  const entries = snapshot.exercises;
  if (!Array.isArray(entries)) return null;

  let entriesRefreshed = 0;
  const next = entries.map((entry: unknown) => {
    if (!isRecord(entry)) return entry;
    const exerciseId = entry.exerciseId;
    if (typeof exerciseId !== 'string') return entry;
    const currentName = currentNames.get(exerciseId);
    if (currentName === undefined) return entry;

    let changed = false;
    const updated: Record<string, unknown> = { ...entry };
    for (const key of SNAPSHOT_NAME_KEYS) {
      const copied = entry[key];
      if (typeof copied === 'string' && copied !== currentName) {
        updated[key] = currentName;
        changed = true;
      }
    }
    if (!changed) return entry;
    entriesRefreshed += 1;
    return updated;
  });

  if (entriesRefreshed === 0) return null;
  return { snapshot: { ...snapshot, exercises: next }, entriesRefreshed };
}

// ---------------------------------------------------------------------------
// Pass 3 — orphan and integrity check
// ---------------------------------------------------------------------------

/** A count that must be zero. Anything else is a broken constraint. */
export interface IntegrityFinding {
  table: 'set_logs' | 'personal_records';
  orphanCount: number;
}

/**
 * Asserts every `set_logs.exercise_id` and `personal_records.exercise_id`
 * resolves, and **alerts** (OB§4.1 P1, data integrity) if one does not.
 *
 * This should find nothing, ever — both columns are `REFERENCES
 * training.exercises(id)`, and exercises are archived rather than deleted.
 * It runs anyway because a finding here means a constraint was dropped or a
 * migration went wrong, and a canary nobody listens to is not a canary
 * (that task's Risks).
 *
 * **Deliberately global, unlike the other three passes.** An orphan belongs
 * to the system, not to a coach: scoping it through
 * `client_profiles.coach_id` would miss exactly the rows whose ownership
 * chain is itself broken, which is the state this exists to catch. It is
 * two indexed anti-joins, so paying for it once per coach-run is cheaper
 * than the bug it guards against; if that ever stops being true, move it to
 * `metrics-collector.ts`, which already reserves the OB§3.1 row for it.
 *
 * The alert carries counts only — never a row id, never a client
 * (`observability-ops` §4, `alerts.ts`'s own contract).
 */
export async function assertReferentialIntegrity(db: DbClient): Promise<IntegrityFinding[]> {
  const rows = await db.execute(sql`
    SELECT
      (
        SELECT COUNT(*)
        FROM ${schema.setLogs} sl
        LEFT JOIN ${schema.exercises} e ON e.id = sl.exercise_id
        WHERE e.id IS NULL
      )::text AS set_logs,
      (
        SELECT COUNT(*)
        FROM ${schema.personalRecords} pr
        LEFT JOIN ${schema.exercises} e ON e.id = pr.exercise_id
        WHERE e.id IS NULL
      )::text AS personal_records
  `);

  const row: unknown = rows[0];
  const counts = isRecord(row) ? row : {};
  const findings: IntegrityFinding[] = (
    [
      { table: 'set_logs', orphanCount: readCount(counts.set_logs) },
      { table: 'personal_records', orphanCount: readCount(counts.personal_records) },
    ] satisfies IntegrityFinding[]
  ).filter((finding) => finding.orphanCount > 0);

  if (findings.length > 0) {
    const summary = findings
      .map((finding) => `${finding.orphanCount} orphaned row(s) in training.${finding.table}`)
      .join('; ');
    await dispatchAlert({
      alertId: 'P1',
      summary: `exercise-reconcile pass 3: ${summary}. A foreign key to training.exercises is missing or was dropped.`,
    });
    logger.error('exercise_reconcile.integrity_violation', {
      count: findings.reduce((total, finding) => total + finding.orphanCount, 0),
    });
  }

  return findings;
}

/** `COUNT(*)::text` crosses the driver as a string; anything else is zero. */
function readCount(value: unknown): number {
  const parsed =
    typeof value === 'string' || typeof value === 'number' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

// ---------------------------------------------------------------------------
// Pass 4 — duplicate candidates
// ---------------------------------------------------------------------------

/** Two of one coach's own live exercises that look like the same movement. */
export interface DuplicateCandidate {
  /** Ordered by name so the pair reads the same on every run. */
  firstId: string;
  firstName: string;
  secondId: string;
  secondName: string;
  movementPattern: string;
  equipment: string;
  editDistance: number;
}

/**
 * The share of the longer normalised name that may differ before two names
 * stop being "the same movement, typed twice". At 0.15, "bulgarian split
 * squat"/"bulgarian split squats" pairs (distance 1 of 22) and "incline
 * press"/"decline press" does not (distance 2 of 13, threshold 1). Loose
 * enough to catch a plural or a stray hyphen, tight enough that two
 * genuinely different variations are not offered up as duplicates.
 */
const MAX_EDIT_DISTANCE_RATIO = 0.15;

/**
 * Near-identical exercises inside **one coach's own** library — same
 * movement pattern, same equipment, near-identical normalised name.
 *
 * **Reports only, never merges.** Merging would fuse two PR histories that
 * may legitimately belong apart (a coach might genuinely track two
 * variations), and it is not reversible (that task's Risks). The coach
 * decides; this pass only makes the pair visible, which is the thing they
 * cannot do for themselves.
 *
 * Global exercises are out of scope by construction — this compares a
 * coach's custom rows to each other, and the coach cannot edit or merge a
 * seed row anyway. Archived rows are excluded: an archived duplicate is
 * already resolved.
 *
 * Comparison happens in TypeScript rather than SQL. A coach's custom
 * library is tens of rows, the comparison is only within one
 * (movement pattern, equipment) bucket, and doing it here keeps the
 * threshold a tested product decision instead of a `pg_trgm` default
 * (`CLAUDE.md` §3.4.1 step 2 — no new dependency, no new extension).
 */
export async function findDuplicateCandidates(
  db: DbClient,
  coachProfileId: string,
): Promise<DuplicateCandidate[]> {
  const rows = await db
    .select({
      id: schema.exercises.id,
      name: schema.exercises.name,
      movementPattern: schema.exercises.movementPattern,
      equipment: schema.exercises.equipment,
    })
    .from(schema.exercises)
    .where(and(ownedByCoach(coachProfileId), isNull(schema.exercises.archivedAt)))
    .orderBy(schema.exercises.name);

  const buckets = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.movementPattern} ${row.equipment.trim().toLowerCase()}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  const candidates: DuplicateCandidate[] = [];
  for (const bucket of buckets.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const first = bucket[i];
        const second = bucket[j];
        // `noUncheckedIndexedAccess` — both indices are in range by the
        // loop bounds, but the compiler cannot see that.
        if (!first || !second) continue;

        const a = normaliseExerciseName(first.name);
        const b = normaliseExerciseName(second.name);
        const distance = editDistance(a, b);
        const threshold = Math.max(
          1,
          Math.floor(Math.max(a.length, b.length) * MAX_EDIT_DISTANCE_RATIO),
        );
        if (distance > threshold) continue;

        candidates.push({
          firstId: first.id,
          firstName: first.name,
          secondId: second.id,
          secondName: second.name,
          movementPattern: first.movementPattern,
          equipment: first.equipment,
          editDistance: distance,
        });
      }
    }
  }

  return candidates;
}

/**
 * Lower-cases, drops punctuation, and collapses whitespace, so
 * "Bulgarian Split-Squat" and "bulgarian  split squat" compare as equal
 * before the distance is even measured. Deliberately does **not**
 * singularise: "curl"/"curls" is one edit away and the distance check
 * already catches it, whereas a naive trailing-`s` strip mangles "press".
 */
export function normaliseExerciseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Levenshtein distance, two-row dynamic programming. Hand-written rather
 * than pulled from a package: it is twelve lines, `apps/api` has no string
 * -distance dependency, and adding one for this would fail `CLAUDE.md`
 * §3.4.1 step 2.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current: number[] = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      const insertion = (current[j - 1] ?? 0) + 1;
      const deletion = (previous[j] ?? 0) + 1;
      current[j] = Math.min(substitution, insertion, deletion);
    }
    previous = current;
  }

  return previous[b.length] ?? 0;
}

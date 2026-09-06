import { schema, type DbClient } from '@coachos/db';
import { and, eq, isNull, sql } from 'drizzle-orm';

import { logger } from '../lib/logger.ts';
import { captureServerException } from '../lib/sentry.ts';
import { enqueueExerciseReconcile } from '../queues/enqueue.ts';
import {
  assertReferentialIntegrity,
  findArchivedButPrescribed,
  findDuplicateCandidates,
  refreshStaleDisplayNames,
  type ArchivedPrescription,
  type DuplicateCandidate,
  type IntegrityFinding,
  type RefreshedSnapshot,
} from '../services/exercises/reconcile.ts';

/**
 * DB§15's weekly `exercise-reconcile` job (`exercise-library/06`). Weekly,
 * off-peak, **per coach** — a global run would make one coach's bad row a
 * failure for everybody, and per-coach keeps each run small enough that
 * nothing here needs pagination.
 *
 * The drift this cleans up is slow and quiet — stale names, an archived
 * exercise still prescribed, duplicates a coach cannot see — which is
 * exactly why it is a weekly job and not a fan-out write on the coach's
 * save path.
 *
 * Nothing in this file changes a client's logged data. The four passes
 * report, and only pass 2 writes at all.
 */

/** `platform.notifications.type` for the digest. §14.1's value set is text, not an enum. */
export const EXERCISE_RECONCILE_NOTIFICATION_TYPE = 'exercise_reconcile';

/** Which pass failed, for the caller and for the log line. */
export type ReconcilePass =
  'archived_in_use' | 'stale_display_names' | 'referential_integrity' | 'duplicate_candidates';

export interface ExerciseReconcileResult {
  coachId: string;
  isoWeek: string;
  /** Pass 1. Empty when the pass found nothing **or** when it failed — see `failedPasses`. */
  archivedInUse: ArchivedPrescription[];
  /** Pass 2. */
  refreshedSnapshots: RefreshedSnapshot[];
  /** Pass 3. Non-empty means an alert was raised. */
  integrityFindings: IntegrityFinding[];
  /** Pass 4. */
  duplicateCandidates: DuplicateCandidate[];
  /** False when there was nothing to say, or when this week's digest already existed. */
  digestSent: boolean;
  failedPasses: ReconcilePass[];
}

/**
 * The ISO-8601 week-numbering key, `2026-W36`, in **UTC**. It is a
 * scheduling bucket, not a user-facing date, so it deliberately does not
 * read a coach's timezone: two runs of the same weekly job must land in the
 * same bucket regardless of where the coach lives, and a timezone-shifted
 * key would let a coach near the date line get two digests in one week.
 *
 * Hand-rolled rather than `date-fns`'s `getISOWeek`: `apps/api` has no
 * date-fns dependency of its own (only `@coachos/utils` does, and this is a
 * server-only scheduling key, not a shared formula), and `CLAUDE.md` §3.4.1
 * step 2 says do not add one for ten lines. The Thursday rule below is the
 * whole of ISO 8601 §3.17 — the week belongs to the year containing its
 * Thursday, which is what makes 2025-12-29 land in `2026-W01`.
 */
export function isoWeekKey(instant: Date): string {
  const date = new Date(
    Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()),
  );
  const isoWeekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + 4 - isoWeekday);
  const year = date.getUTCFullYear();
  const firstOfYear = Date.UTC(year, 0, 1);
  const week = Math.ceil(((date.getTime() - firstOfYear) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/**
 * The weekly fan-out. One `reconcile` job per coach, each carrying the same
 * ISO week so every job id derived from it is stable for the whole week
 * (`../queues/enqueue.ts`'s `exercise-reconcile:{coachId}:{isoWeek}`).
 *
 * Never checks whether a coach is "already enqueued" — that is what the
 * derived job id is for, exactly as `sweep-deletion-requests.ts` relies on
 * `purge.{userId}`.
 */
export async function runExerciseReconcileSweep(
  db: DbClient,
  asOf: Date = new Date(),
): Promise<number> {
  const isoWeek = isoWeekKey(asOf);
  const coaches = await db
    .select({ id: schema.coachProfiles.id })
    .from(schema.coachProfiles)
    .where(isNull(schema.coachProfiles.deletedAt));

  for (const coach of coaches) {
    await enqueueExerciseReconcile({ coachId: coach.id, isoWeek });
  }

  logger.info('exercise_reconcile.sweep_completed', {
    queue: 'exercise-reconcile',
    count: coaches.length,
  });
  return coaches.length;
}

/**
 * Runs all four passes for one coach and, if there is anything to say,
 * writes one digest.
 *
 * **Each pass is wrapped on its own.** They share a schedule and nothing
 * else, so a pass that throws is logged, reported to Sentry, recorded in
 * `failedPasses`, and then the next pass runs anyway — a broken pass 4 must
 * never cost the coach pass 1's report (that task's Approach step 5).
 */
export async function runExerciseReconcile(
  db: DbClient,
  input: { coachId: string; isoWeek: string },
): Promise<ExerciseReconcileResult> {
  const { coachId, isoWeek } = input;
  const failedPasses: ReconcilePass[] = [];

  async function runPass<T>(pass: ReconcilePass, work: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await work();
    } catch (error) {
      failedPasses.push(pass);
      logger.error('exercise_reconcile.pass_failed', {
        queue: 'exercise-reconcile',
        errorCode: pass,
      });
      captureServerException(error, { procedure: `queue.exercise-reconcile.${pass}` });
      return fallback;
    }
  }

  const archivedInUse = await runPass(
    'archived_in_use',
    () => findArchivedButPrescribed(db, coachId),
    [] as ArchivedPrescription[],
  );
  const refreshedSnapshots = await runPass(
    'stale_display_names',
    () => refreshStaleDisplayNames(db, coachId),
    [] as RefreshedSnapshot[],
  );
  const integrityFindings = await runPass(
    'referential_integrity',
    () => assertReferentialIntegrity(db),
    [] as IntegrityFinding[],
  );
  const duplicateCandidates = await runPass(
    'duplicate_candidates',
    () => findDuplicateCandidates(db, coachId),
    [] as DuplicateCandidate[],
  );

  const digestSent = await sendDigestIfAnything(db, {
    coachId,
    isoWeek,
    archivedInUse,
    duplicateCandidates,
  });

  logger.info('exercise_reconcile.completed', {
    queue: 'exercise-reconcile',
    count: archivedInUse.length + duplicateCandidates.length,
  });

  return {
    coachId,
    isoWeek,
    archivedInUse,
    refreshedSnapshots,
    integrityFindings,
    duplicateCandidates,
    digestSent,
    failedPasses,
  };
}

interface DigestInput {
  coachId: string;
  isoWeek: string;
  archivedInUse: ArchivedPrescription[];
  duplicateCandidates: DuplicateCandidate[];
}

/**
 * Pass 3 is not in the digest by design: a referential-integrity failure is
 * an `SU§7`-class escalation for us, not a coach's problem, and it has
 * already alerted from inside the pass itself.
 *
 * Pass 2 is not in the digest either — a refreshed display name is the job
 * doing its work invisibly, and reporting it would be a weekly notification
 * that says "nothing happened, correctly."
 *
 * **Returns false rather than sending an empty digest.** A weekly report
 * nobody reads is worthless, and COPY.md §CO4.2 is explicit that a digest
 * must never read as nagging.
 */
async function sendDigestIfAnything(db: DbClient, input: DigestInput): Promise<boolean> {
  const { coachId, isoWeek, archivedInUse, duplicateCandidates } = input;
  if (archivedInUse.length === 0 && duplicateCandidates.length === 0) return false;

  const [coach] = await db
    .select({ userId: schema.coachProfiles.userId })
    .from(schema.coachProfiles)
    .where(eq(schema.coachProfiles.id, coachId));
  if (!coach) return false;

  // The second half of the idempotency contract. The BullMQ job id
  // (`exercise-reconcile:{coachId}:{isoWeek}`) only dedupes while the
  // earlier job is still pending or active; once it completes, BullMQ frees
  // the id and a re-enqueue for the same week runs the passes again. This
  // is what makes "two runs in one week produce one digest" true anyway.
  const [existing] = await db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, coach.userId),
        eq(schema.notifications.type, EXERCISE_RECONCILE_NOTIFICATION_TYPE),
        sql`${schema.notifications.data} ->> 'isoWeek' = ${isoWeek}`,
      ),
    )
    .limit(1);
  if (existing) return false;

  await db.insert(schema.notifications).values({
    userId: coach.userId,
    type: EXERCISE_RECONCILE_NOTIFICATION_TYPE,
    title: 'Exercise library check',
    body: buildDigestBody(archivedInUse, duplicateCandidates),
    data: buildDigestData(isoWeek, archivedInUse, duplicateCandidates),
  });

  return true;
}

/**
 * Counts only, never a name. The body is read on a lock screen, and
 * `COPY.md` §CO4.2's rule is that a notification says what happened without
 * shaming anyone for it — "still use" is a fact about the programs, not a
 * verdict on the coach. The names themselves live in `data`, for the screen
 * the coach opens.
 */
function buildDigestBody(
  archivedInUse: ArchivedPrescription[],
  duplicateCandidates: DuplicateCandidate[],
): string {
  const sentences: string[] = [];

  if (archivedInUse.length > 0) {
    const programCount = new Set(archivedInUse.map((row) => row.programId)).size;
    sentences.push(
      programCount === 1
        ? '1 program still uses an exercise you archived.'
        : `${programCount} programs still use an exercise you archived.`,
    );
  }

  if (duplicateCandidates.length > 0) {
    sentences.push(
      duplicateCandidates.length === 1
        ? '1 pair of exercises looks like a duplicate.'
        : `${duplicateCandidates.length} pairs of exercises look like duplicates.`,
    );
  }

  return sentences.join(' ');
}

/**
 * `data.route` is DB§5.5's application-layer contract — a jsonb column
 * cannot enforce a key's presence, so every write must carry it. Everything
 * else here is what the coach needs to act: the exact exercise, the exact
 * programs and days, and the exact pair. Nothing is resolved for them.
 */
function buildDigestData(
  isoWeek: string,
  archivedInUse: ArchivedPrescription[],
  duplicateCandidates: DuplicateCandidate[],
): Record<string, unknown> {
  const byExercise = new Map<
    string,
    { exerciseId: string; exerciseName: string; days: unknown[] }
  >();
  for (const row of archivedInUse) {
    const entry = byExercise.get(row.exerciseId) ?? {
      exerciseId: row.exerciseId,
      exerciseName: row.exerciseName,
      days: [],
    };
    entry.days.push({
      programId: row.programId,
      programName: row.programName,
      weekNumber: row.weekNumber,
      dayNumber: row.dayNumber,
      dayName: row.dayName,
    });
    byExercise.set(row.exerciseId, entry);
  }

  return {
    route: '/exercises',
    isoWeek,
    archivedInUse: [...byExercise.values()],
    duplicateCandidates: duplicateCandidates.map((pair) => ({
      firstId: pair.firstId,
      firstName: pair.firstName,
      secondId: pair.secondId,
      secondName: pair.secondName,
    })),
  };
}

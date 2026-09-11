// `local_workout_sessions`, `local_set_logs`, `local_exercises_cache` — DB§13.
// Device cache, not a mirror of `packages/db/src/schema/training.ts`: no soft
// delete, no coach_id denormalisation, no audit trail (../README.md).
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const localWorkoutSessions = sqliteTable('local_workout_sessions', {
  id: text('id').primaryKey(), // server uuid, or a local uuidv7 before sync confirms it
  clientLocalId: text('client_local_id').notNull().unique(),
  serverId: text('server_id'), // null until confirmed by server
  scheduledDate: text('scheduled_date').notNull(), // ISO date
  programDayId: text('program_day_id'),
  name: text('name'),
  status: text('status').notNull(),
  startedAt: integer('started_at'), // epoch ms
  completedAt: integer('completed_at'), // epoch ms
  payloadJson: text('payload_json').notNull(), // full denormalised session, for rendering
  // The `outbox.id` of the mutation that started this session — the
  // `depends_on` parent every set log, and the completion, must chain to
  // (DB§14.2, `lib/outbox/enqueue.ts` rule 2). On the row rather than in
  // memory because a client force-quits mid-workout: sets logged after the
  // restart still need it, and a chain broken at that seam sends sets for a
  // session the server has never heard of. Null for a session nothing has
  // started yet, and for a row an older build wrote.
  startOutboxId: text('start_outbox_id'),
  // The `outbox.id` of the mutation that COMPLETED this session, and of the
  // most recent notes update — `start_outbox_id`'s two siblings, on the row
  // for its reason. `session-summary/03`'s capture runs on the summary
  // screen, one navigation after `useCompleteSession` returned the id in
  // memory, so the id has to survive the hand-off; and a second save has to
  // chain behind the first, or two updates flush as siblings and the older
  // text can land last. Null for a session nothing has completed, for one a
  // build predating this column finished, and for a session whose notes have
  // never been saved.
  completeOutboxId: text('complete_outbox_id'),
  notesOutboxId: text('notes_outbox_id'),
  // `workout_sessions.perceived_exertion` / `.client_notes` (DB§5.2), held
  // here because the device is the author and the server may not have heard
  // yet. 1–10; the range is enforced by `updateSessionNotesInput`, not by
  // SQLite, which has no CHECK in this bootstrap DDL.
  perceivedExertion: integer('perceived_exertion'),
  clientNotes: text('client_notes'),
  syncState: text('sync_state', { enum: ['synced', 'pending', 'conflict'] })
    .notNull()
    .default('synced'),
  updatedAt: integer('updated_at').notNull(), // epoch ms
});

export const localSetLogs = sqliteTable('local_set_logs', {
  id: text('id').primaryKey(),
  clientLocalId: text('client_local_id').notNull().unique(),
  // References the PARENT SESSION'S client_local_id, never its server id — a
  // set logged offline may belong to a session with no server_id at all yet
  // (task 02 Approach step 3; DB§13; DB§14.2's depends_on ordering).
  sessionLocalId: text('session_local_id')
    .notNull()
    .references(() => localWorkoutSessions.clientLocalId),
  exerciseId: text('exercise_id').notNull(),
  setNumber: integer('set_number').notNull(),
  reps: integer('reps'),
  // REAL, not the string-numeric discipline `packages/db`'s Postgres
  // `numeric` columns use (`code-conventions` §3's "numeric trap") — SQLite
  // has no equivalent fixed-precision type. Deliberate, accepted precision
  // trade-off for this local cache only; the server row stays the
  // precision-authoritative copy (task 02 spec, DB§13).
  weightKg: real('weight_kg'),
  rpe: real('rpe'),
  isWarmup: integer('is_warmup', { mode: 'boolean' }).notNull().default(false),
  // Sibling of `is_warmup`, and named for `set_logs.is_failure` (DB§5.2) so
  // the two sides can't drift. Task 01 shipped the flag on the wire only,
  // which left a set taken to failure invisible once the session reloaded
  // from this mirror after a force-quit (`set-entry/04`).
  isFailure: integer('is_failure', { mode: 'boolean' }).notNull().default(false),
  notes: text('notes'),
  loggedAt: integer('logged_at').notNull(), // epoch ms, captured at action time
  syncState: text('sync_state', { enum: ['synced', 'pending', 'conflict'] })
    .notNull()
    .default('pending'),
});

// Read-only lookup cache, same role as `local_foods_cache` below but for the
// exercise library. Derived from `packages/db/src/schema/training.ts`'s
// `exercises` table, kept to only what the offline logger renders: no
// coachId (a custom exercise is looked up the same way as a global one on
// device), no searchVector (a few hundred cached rows don't need full-text),
// no archivedAt/timestamps — a cache, not a mirror (task 02 decision #3).
export const localExercisesCache = sqliteTable('local_exercises_cache', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  primaryMuscle: text('primary_muscle'),
  equipment: text('equipment'),
  movementPattern: text('movement_pattern'),
  isBodyweight: integer('is_bodyweight', { mode: 'boolean' }).notNull().default(false),
  defaultIncrementKg: real('default_increment_kg'), // plate-math default, §8.4
  cuesJson: text('cues_json'), // JSON array of coaching cue strings
  lastUsedAt: integer('last_used_at'), // epoch ms — cache ranking, mirrors local_foods_cache
});

// Bootstrap DDL for the tables above, hand-transcribed rather than generated
// (see `../client.ts`'s "table creation" decision comment for why). Keep
// this in lockstep with the Drizzle definitions above — they describe the
// same tables to two different consumers (typed queries vs. the raw
// `CREATE TABLE` the device actually runs). This is enforced, not just
// asked for: `../__tests__/schema-ddl-drift.test.ts` reconstructs both
// sides independently and fails, naming the table and column, the moment
// they disagree. If you break it, that file is where the guard lives.
export const LOCAL_TRAINING_SCHEMA_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS local_workout_sessions (
    id TEXT PRIMARY KEY,
    client_local_id TEXT NOT NULL UNIQUE,
    server_id TEXT,
    scheduled_date TEXT NOT NULL,
    program_day_id TEXT,
    name TEXT,
    status TEXT NOT NULL,
    started_at INTEGER,
    completed_at INTEGER,
    payload_json TEXT NOT NULL,
    start_outbox_id TEXT,
    complete_outbox_id TEXT,
    notes_outbox_id TEXT,
    perceived_exertion INTEGER,
    client_notes TEXT,
    sync_state TEXT NOT NULL DEFAULT 'synced',
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS local_set_logs (
    id TEXT PRIMARY KEY,
    client_local_id TEXT NOT NULL UNIQUE,
    session_local_id TEXT NOT NULL REFERENCES local_workout_sessions(client_local_id),
    exercise_id TEXT NOT NULL,
    set_number INTEGER NOT NULL,
    reps INTEGER,
    weight_kg REAL,
    rpe REAL,
    is_warmup INTEGER NOT NULL DEFAULT 0,
    is_failure INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    logged_at INTEGER NOT NULL,
    sync_state TEXT NOT NULL DEFAULT 'pending'
  )`,
  `CREATE TABLE IF NOT EXISTS local_exercises_cache (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    primary_muscle TEXT,
    equipment TEXT,
    movement_pattern TEXT,
    is_bodyweight INTEGER NOT NULL DEFAULT 0,
    default_increment_kg REAL,
    cues_json TEXT,
    last_used_at INTEGER
  )`,
];

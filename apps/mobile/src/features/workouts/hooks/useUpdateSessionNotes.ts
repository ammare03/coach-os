import { eq } from 'drizzle-orm';
import { useCallback, useEffect, useState } from 'react';

import { getLocalDb, type LocalDb } from '../../../db/client.ts';
import { localWorkoutSessions } from '../../../db/schema/local-training.ts';
import { enqueueMutation } from '../../../lib/outbox/enqueue.ts';
import { selectSkips, useSkippedExercisesStore } from '../store/skipped-exercises-store.ts';

import { composeSkipNotes } from './useSkipExercise.ts';

// `phase-09-workout-logger/session-summary/03` — the two subjective fields a
// client attaches to a finished session, and the first thing in this phase
// that carries session notes to the server.
//
// Six decisions, in the order they matter:
//
// (a) **The client's own words are never the whole column.** `client_notes`
//     already holds `session-modifications/03`'s skip lines by the time this
//     capture opens, and the task's Risks section names the bug exactly:
//     bind a text input to the column, save what it holds, and the first
//     character typed destroys the skip record. {@link composeSessionNotes}
//     is the only thing in the app that writes this column's value, it is
//     handed the record and the client's words as two arguments, and it can
//     only ever put the record first. `SessionNoteField` renders the record
//     outside the editable region for the same reason at the other end: the
//     failure is not avoided, it is unrepresentable.
//
// (b) **Skips are in the note; substitutions are not.** `useSwapExercise`
//     decision (a) deliberately routes a substitution to `set_logs.notes`,
//     on the first set logged against the substitute, so the coach reads it
//     beside the sets it explains. Repeating it here would have them read
//     one fact twice in two places, and would make the session note claim to
//     be a record it is not. The summary already states the swap count one
//     section above (`ModificationsSummary`).
//
// (c) **The local write is synchronous with the tap and independent of the
//     network** — `useCompleteSession` rule (a), and the outbox entry is
//     written BEFORE the local row for its rule (e)'s reason: if the second
//     write fails the server still learns what the client said.
//
// (d) **The update chains to the completion, and a second save chains to the
//     first.** The completion's `outbox.id` is read off
//     `local_workout_sessions.complete_outbox_id` rather than from
//     `completeSession`'s return value: this runs one navigation later, on a
//     screen that never saw that value. Where the row carries none — a
//     repeat completion queued nothing (`useCompleteSession` rule (f)), or an
//     older build finished the session — the update is queued UNCHAINED
//     rather than hung off an invented id, because `enqueueMutation` throws
//     on a `dependsOn` that names nothing and a stranded note is worse than
//     an unordered one.
//
//     The second half is less obvious and is the one that loses text:
//     children of one parent are siblings and flush CONCURRENTLY
//     (`lib/outbox/enqueue.ts` rule 4), so two saves both hung off the
//     completion can land in either order and the older note can win. Each
//     save therefore chains to the previous one.
//
// (e) **Both fields are sent on every save, null included.** The server
//     writes what it is handed (`api/src/features/workouts/update-notes.ts`
//     decision (c)), so a payload that omitted a field the client CLEARED
//     would leave the old value standing with nothing to correct it.
//
// (f) **Neither field is required, and nothing here gates the session.** A
//     client who saves nothing leaves with a fully valid, fully queued
//     completed session; this module is never called on that path.

/** The tRPC path the outbox replays. `apps/api/src/routers/workouts.ts`. */
export const UPDATE_NOTES_PROCEDURE = 'workouts.updateNotes';

/**
 * A blank line between the session's own record and the client's words.
 *
 * A coach reads this column as prose. One newline would run a skip line into
 * the sentence after it; the blank line is what makes the two halves read as
 * two things without either being labelled.
 */
const NOTE_SEPARATOR = '\n\n';

/**
 * The whole `client_notes` value: every skip this session recorded, then the
 * client's own words. `null` when there is nothing at all to say — never
 * `''`, which would be a note the client wrote that says nothing.
 *
 * Decision (a). **Idempotent**: composing an already-composed value repeats
 * the record rather than doubling it, which is what makes
 * {@link clientPortionOf}'s fallback branch safe to round-trip.
 */
export function composeSessionNotes(priorNotes: string, clientNote: string): string | null {
  const prior = priorNotes.trim();
  const own = clientNote.trim();

  if (prior.length === 0) return own.length === 0 ? null : own;
  if (own.length === 0) return prior;
  if (own.startsWith(prior)) return own;
  return `${prior}${NOTE_SEPARATOR}${own}`;
}

/**
 * The client's own half of a stored value, for re-opening the capture with
 * what they last typed still in the field.
 *
 * An exact prefix strip, not a parse: the prefix is the string this device
 * composed, and the skips it was composed from cannot change after the
 * session is finished. A stored value that does not start with the record —
 * one composed by a build that worded it differently — is returned whole, so
 * the client's words stay on screen; {@link composeSessionNotes}'s
 * idempotency is what stops that round trip repeating the record.
 */
export function clientPortionOf(stored: string | null, priorNotes: string): string {
  if (stored === null) return '';
  const prior = priorNotes.trim();
  if (prior.length === 0) return stored;
  return stored.startsWith(prior) ? stored.slice(prior.length).trimStart() : stored;
}

export interface SaveSessionNotesDeps {
  /** `local_workout_sessions.client_local_id` — the id the summary route carries. */
  sessionLocalId: string;
  /** 1–10, or `null` for a client who did not answer. Bounded by `updateSessionNotesInput`. */
  perceivedExertion: number | null;
  /** The client's own words, and only those. Never the composed column. */
  clientNote: string;
  /** The session's own record, from {@link composeSkipNotes}. `''` for a session with no skips. */
  priorNotes: string;
  /** Evaluated at the tap, never at mount. Injected so the instant is testable. */
  now?: () => Date;
  db?: LocalDb;
}

export interface SavedSessionNotes {
  /** The `outbox.id` of this save — the parent the next one chains to. */
  outboxId: string;
  /** This save's idempotency key. Fresh every time; a save is a new write, not a correction. */
  clientLocalId: string;
  /** Exactly what was written to `client_notes`, composed. */
  clientNotes: string | null;
}

/**
 * Writes both fields locally and queues the server's half.
 *
 * Exported separately from the hook so the rules above can be tested without
 * a renderer, the same shape `completeSession` is exported in.
 *
 * Throws when the device holds no such row — `ERRORS.md` ER§1.4's
 * `LOCAL_READ_FAILED`, which the capture renders inline rather than as a
 * screen state: the session is finished and saved either way, and only the
 * note is at stake.
 */
export async function saveSessionNotes(deps: SaveSessionNotesDeps): Promise<SavedSessionNotes> {
  const db = deps.db ?? (await getLocalDb());
  const [row] = await db
    .select()
    .from(localWorkoutSessions)
    .where(eq(localWorkoutSessions.clientLocalId, deps.sessionLocalId))
    .limit(1);

  if (!row) {
    throw new Error(`saveSessionNotes: no local_workout_sessions row for "${deps.sessionLocalId}"`);
  }

  const clientNotes = composeSessionNotes(deps.priorNotes, deps.clientNote);
  const savedAt = (deps.now ?? (() => new Date()))();

  // Decision (d): the most recent save first, the completion second, nothing
  // third. Decision (c): queued before the local row is touched.
  const parent = row.notesOutboxId ?? row.completeOutboxId;
  const { outboxId, clientLocalId } = await enqueueMutation({
    procedure: UPDATE_NOTES_PROCEDURE,
    // Decision (e). No `clientLocalId` here — `flush.ts` merges the outbox
    // row's own, which is the only authoritative copy of that value.
    payload: {
      sessionClientLocalId: row.clientLocalId,
      perceivedExertion: deps.perceivedExertion,
      clientNotes,
    },
    ...(parent === null ? {} : { dependsOn: parent }),
  });

  await db
    .update(localWorkoutSessions)
    .set({
      perceivedExertion: deps.perceivedExertion,
      clientNotes,
      notesOutboxId: outboxId,
      // The device authored this and the server has not confirmed it, so a
      // refresh must not overwrite it (`offline-sync` §5).
      syncState: 'pending',
      updatedAt: savedAt.getTime(),
    })
    .where(eq(localWorkoutSessions.clientLocalId, row.clientLocalId));

  return { outboxId, clientLocalId, clientNotes };
}

/** What this session already holds, for re-opening the capture with it. */
export interface StoredSessionNotes {
  perceivedExertion: number | null;
  /** The client's own half only — {@link clientPortionOf}. */
  clientNote: string;
}

export interface SessionNotesDraft {
  perceivedExertion: number | null;
  clientNote: string;
}

export interface UseUpdateSessionNotesResult {
  /**
   * Every skip of this session as the note's opening lines, `''` when there
   * are none. Shown by `SessionNoteField` and never editable — decision (a).
   */
  priorNotes: string;
  /** What is already stored, or `null` until the local read lands. */
  stored: StoredSessionNotes | null;
  save: (draft: SessionNotesDraft) => Promise<void>;
}

export function useUpdateSessionNotes(sessionLocalId: string): UseUpdateSessionNotesResult {
  // The skips this session took, already in the store: `SessionSummaryScreen`
  // opens and re-hydrates it on mount, including after a force-quit.
  const skips = useSkippedExercisesStore(selectSkips);
  const priorNotes = composeSkipNotes(skips.values());

  const [stored, setStored] = useState<StoredSessionNotes | null>(null);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const db = await getLocalDb();
        const [row] = await db
          .select({
            perceivedExertion: localWorkoutSessions.perceivedExertion,
            clientNotes: localWorkoutSessions.clientNotes,
          })
          .from(localWorkoutSessions)
          .where(eq(localWorkoutSessions.clientLocalId, sessionLocalId))
          .limit(1);
        // The screen may be gone by the time SQLite answers.
        if (!active || !row) return;
        setStored({
          perceivedExertion: row.perceivedExertion,
          clientNote: clientPortionOf(row.clientNotes, priorNotes),
        });
      } catch {
        // Nothing to restore is not an error the client can act on, and this
        // capture is optional: an empty field is a correct starting state,
        // and the save path reports its own failure loudly.
      }
    })();

    return () => {
      active = false;
    };
    // `priorNotes` is derived from a store this screen hydrates once on
    // mount; re-reading the row every time it settles would race the save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionLocalId]);

  const save = useCallback(
    async (draft: SessionNotesDraft) => {
      const saved = await saveSessionNotes({
        sessionLocalId,
        perceivedExertion: draft.perceivedExertion,
        clientNote: draft.clientNote,
        priorNotes,
      });
      setStored({
        perceivedExertion: draft.perceivedExertion,
        clientNote: clientPortionOf(saved.clientNotes, priorNotes),
      });
    },
    [priorNotes, sessionLocalId],
  );

  return { priorNotes, stored, save };
}

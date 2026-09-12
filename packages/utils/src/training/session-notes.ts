// The one vocabulary for the two facts a client's session records as free
// text rather than as columns: an exercise they skipped, and an exercise
// they swapped for an approved alternative.
//
// `DATABASE.md` DB§5.2 gives neither a table of its own — `session-
// modifications/02` and `/03` both decided against inventing one
// (`CLAUDE.md` §0's "never invent a column" applies to tables too), so a
// skip reaches the coach as a line in `workout_sessions.client_notes` and a
// substitution as a line in the first `set_logs.notes` of the substituted
// exercise. That decision is only safe while exactly one module knows the
// wording.
//
// Three decisions, in the order they matter:
//
// (a) **The composer and the parser live in the same file.** They were not
//     shared before this: the device wrote the lines
//     (`features/workouts/hooks/useSkipExercise.ts`,
//     `.../useSwapExercise.ts`) and the coach's session-review screen
//     (`phase-10-coach-review-surfaces/session-review/01`) had to read them
//     back. A writer and a reader of one format in two packages is the
//     `code-conventions` §1 case exactly — the second consumer is what
//     promotes it here, and a format whose parser sits beside its composer
//     cannot drift by one space.
//
// (b) **An unrecognised line is the client's own text, never dropped.**
//     Both parsers below return `null` rather than guessing, and the
//     whole-note parsers put every `null` line back into `freeText`
//     verbatim. The failure this rules out is a coach reading a session
//     where a sentence the client typed silently vanished because it
//     started with the wrong word.
//
//     The cost is the converse: a client who literally types "Skipped:
//     Squat — out of time" as prose produces a line indistinguishable from
//     a real skip. Accepted — free text has no escape hatch, and the
//     alternative (a marker character) would be visible to the client who
//     typed around it.
//
// (c) **The reason LABEL crosses this boundary, not the reason key.** The
//     four `SkipReason` values and their wording are the client app's
//     (`features/workouts/store/skipped-exercises-store.ts`'s
//     `SKIP_REASON_LABEL`, written to `COPY.md` §CO2/§CO3's no-judgement
//     rule). Only the already-resolved label is ever stored, so only the
//     label can be recovered — the server reports the client's own words
//     back to the coach and never re-derives a category from them.

/** One skipped exercise, as `workout_sessions.client_notes` carries it. */
export interface SkipNote {
  exerciseName: string;
  /**
   * The reason as the sentence spells it — lowercased by
   * {@link formatSkipNoteLine} and returned by {@link parseSkipNoteLine}
   * exactly as written. Decision (c): never a `SkipReason` key.
   */
  reasonLabel: string;
  /** The client's own words, or `null`. Never an empty string. */
  note: string | null;
}

/** One substituted exercise, as the first `set_logs.notes` of it carries it. */
export interface SubstitutionNote {
  /** The exercise the client was prescribed, before the swap. */
  originalName: string;
}

/** A whole `workout_sessions.client_notes` value, taken apart. */
export interface ParsedSessionNotes {
  /** In the order the lines appear, which is the order the skips were taken. */
  skips: SkipNote[];
  /** Everything that was not a skip line, joined back as written. `null` when there is none. */
  freeText: string | null;
}

/** A whole `set_logs.notes` value, taken apart. */
export interface ParsedSetNote {
  /** The name the substitution line carried, or `null` for an ordinary set. */
  substitutedFor: string | null;
  /** The client's own note with the substitution line removed. `null` when there is none. */
  freeText: string | null;
}

const SKIP_PREFIX = 'Skipped: ';
/** An em dash with a space either side. A reason label never contains one; an exercise name might. */
const REASON_SEPARATOR = ' — ';
const NOTE_OPEN = ' (';
const NOTE_CLOSE = ')';
const SUBSTITUTION_PREFIX = 'Substituted for ';
const SENTENCE_END = '.';
const LINE_SEPARATOR = '\n';

/** What one skip says in `workout_sessions.client_notes`. */
export function formatSkipNoteLine(skip: SkipNote): string {
  const said = skip.note === null ? '' : `${NOTE_OPEN}${skip.note}${NOTE_CLOSE}`;
  return `${SKIP_PREFIX}${skip.exerciseName}${REASON_SEPARATOR}${skip.reasonLabel.toLowerCase()}${said}`;
}

/**
 * Every skip as the `client_notes` text, one per line, in the order given.
 *
 * Returns `''` for a session with no skips, so a caller can concatenate
 * unconditionally.
 */
export function composeSkipNoteLines(skips: Iterable<SkipNote>): string {
  return [...skips].map(formatSkipNoteLine).join(LINE_SEPARATOR);
}

/**
 * One line back into a {@link SkipNote}, or `null` for anything that is not
 * one — decision (b).
 *
 * The separator is found with `lastIndexOf`, not `indexOf`: an exercise name
 * may itself contain an em dash ("Split Squat — Rear Foot Elevated") and a
 * reason label never does, so the LAST occurrence is always the real one.
 */
export function parseSkipNoteLine(line: string): SkipNote | null {
  if (!line.startsWith(SKIP_PREFIX)) return null;

  const rest = line.slice(SKIP_PREFIX.length);
  const separatorAt = rest.lastIndexOf(REASON_SEPARATOR);
  if (separatorAt <= 0) return null;

  const exerciseName = rest.slice(0, separatorAt);
  const { reasonLabel, note } = splitTrailingNote(
    rest.slice(separatorAt + REASON_SEPARATOR.length),
  );
  if (reasonLabel.length === 0) return null;

  return { exerciseName, reasonLabel, note };
}

/**
 * Splits `reason (what they said)` into its two halves.
 *
 * The opening bracket is found with `indexOf` — the mirror of the em dash
 * rule above, and for the mirror reason: a reason label contains no
 * parenthesis, the client's note may contain several, so the FIRST
 * occurrence is always the real one.
 */
function splitTrailingNote(remainder: string): { reasonLabel: string; note: string | null } {
  const opensAt = remainder.indexOf(NOTE_OPEN);
  if (opensAt < 0 || !remainder.endsWith(NOTE_CLOSE)) {
    return { reasonLabel: remainder, note: null };
  }

  const note = remainder.slice(opensAt + NOTE_OPEN.length, -NOTE_CLOSE.length);
  return {
    reasonLabel: remainder.slice(0, opensAt),
    // `SkipNote.note` is never `''` — a blank note is the absence of one.
    note: note.length === 0 ? null : note,
  };
}

/** What one substitution says in `set_logs.notes`. */
export function formatSubstitutionNoteLine(substitution: SubstitutionNote): string {
  return `${SUBSTITUTION_PREFIX}${substitution.originalName}${SENTENCE_END}`;
}

/** One line back into a {@link SubstitutionNote}, or `null` for anything that is not one. */
export function parseSubstitutionNoteLine(line: string): SubstitutionNote | null {
  if (!line.startsWith(SUBSTITUTION_PREFIX) || !line.endsWith(SENTENCE_END)) return null;

  const originalName = line.slice(SUBSTITUTION_PREFIX.length, -SENTENCE_END.length);
  return originalName.length === 0 ? null : { originalName };
}

function splitLines(raw: string | null | undefined): string[] {
  if (raw === null || raw === undefined || raw.trim().length === 0) return [];
  return raw.split(LINE_SEPARATOR);
}

/** Interior blank lines survive; leading and trailing whitespace does not. */
function joinFreeText(lines: string[]): string | null {
  const joined = lines.join(LINE_SEPARATOR).trim();
  return joined.length === 0 ? null : joined;
}

/**
 * `workout_sessions.client_notes` as the coach's session-review screen needs
 * it: the skips it has to render as explicit rows, and the words the client
 * actually wrote.
 */
export function parseSessionClientNotes(raw: string | null | undefined): ParsedSessionNotes {
  const skips: SkipNote[] = [];
  const remainder: string[] = [];

  for (const line of splitLines(raw)) {
    const skip = parseSkipNoteLine(line);
    if (skip === null) remainder.push(line);
    else skips.push(skip);
  }

  return { skips, freeText: joinFreeText(remainder) };
}

/**
 * `set_logs.notes` split into the fact about the exercise and the note about
 * the set.
 *
 * **Only the first substitution line is lifted out.** `substitutionNote`
 * writes exactly one, on the first set of a substituted exercise; a second
 * one in the same note was typed by the client and stays their text —
 * decision (b) again.
 */
export function parseSetNote(raw: string | null | undefined): ParsedSetNote {
  let substitutedFor: string | null = null;
  const remainder: string[] = [];

  for (const line of splitLines(raw)) {
    if (substitutedFor === null) {
      const substitution = parseSubstitutionNoteLine(line);
      if (substitution !== null) {
        substitutedFor = substitution.originalName;
        continue;
      }
    }
    remainder.push(line);
  }

  return { substitutedFor, freeText: joinFreeText(remainder) };
}

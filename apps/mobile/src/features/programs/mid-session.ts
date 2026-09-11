// `session-runtime/09` step 5 — what the coach is told when they save a
// change to a day a client is currently inside.
//
// **This is the half that is easy to skip and matters most.** The client's
// side of the program-snapshot rule is visible to the client; the coach's
// side is invisible to everyone, including us. A coach who believes they
// just fixed a client's working weight, and did not, will make a worse
// decision than one who knows — and nothing else in the product would ever
// tell them.
//
// Pure, and outside the component, for the reason `./supersets.ts` and
// `./drag-reorder.ts` are: a sentence assembled inside a render is a
// sentence you can only test by rendering, and this one has four shapes.
//
// `COPY.md` compliance, all four checked by the sibling test:
//   - it states a fact and then what happens next; it never apologises,
//     never says the save failed, and never asks the coach to do anything
//   - numerals for numbers ("2 others"), sentence case, no exclamation mark
//   - no pronoun that guesses a gender — "their next session", never "her"
//   - the coach register: dense, a peer, no cheerleading

/** The second sentence. The one a coach acts on, so it is never omitted. */
export const MID_SESSION_WHEN = 'Your changes will apply from their next session.';

/** What a name with no leading token is called, so the line always names someone. */
const FALLBACK_NAME = 'Your client';

/**
 * The leading token of `users.name`.
 *
 * First names throughout the coach's surfaces — the client switcher chips,
 * the assign sheet — so the warning names people the way the screen around
 * it already does. Promoted here from `components/AssignProgramSheet.tsx`
 * on its second consumer (`code-conventions` §1).
 */
export function firstNameOf(name: string): string {
  const [first] = name.trim().split(/\s+/);
  return first === undefined || first === '' ? FALLBACK_NAME : first;
}

/**
 * The warning, or `null` when nobody is inside this day.
 *
 * `null` rather than an empty string: the overwhelmingly common case is
 * nobody, and the editor renders nothing at all for it. This is a warning,
 * not a status line — a permanent "0 clients are training" would train a
 * coach to stop reading the row that matters.
 *
 * Past two names it counts instead of listing. Three full names is a line
 * that wraps to four at coach density and stops being scannable, and the
 * coach's decision does not change between three and eight: what they need
 * is that it is more than the one they were thinking about.
 */
export function midSessionWarning(names: string[]): string | null {
  if (names.length === 0) return null;

  const [first, second] = names.map(firstNameOf);
  const who =
    names.length === 1
      ? `${String(first)} is`
      : names.length === 2
        ? `${String(first)} and ${String(second)} are`
        : `${String(first)} and ${String(names.length - 1)} others are`;

  return `${who} training this session right now. ${MID_SESSION_WHEN}`;
}

// The two sentences the client's inline note renders, kept out of the
// component so they are assertable without a render and extractable for
// localisation in one place (`product-copy` §6).
//
// **This copy is not ours to write.** `ERRORS.md` ER§1.5 already carries
// it, filed there as *not an error* — no transport code, no retry, no
// recovery action. It is rendered verbatim, and changing a word here
// changes the catalogue, not just a screen.
//
// It passes `COPY.md` §CO1: it states a fact and attributes the change to
// the coach, who is the qualified party. It does not diagnose, prescribe,
// promise, or ask the client to do anything — a client mid-set has nothing
// to do about it, and saying otherwise would make an interruption out of
// an advisory.

/** The fact. `ERRORS.md` ER§1.5, verbatim. */
export const PROGRAM_CHANGED_FACT = 'Your coach updated this workout.';

/** When it applies. Same row, same sentence order. */
export const PROGRAM_CHANGED_WHEN = 'The changes start from your next session.';

/**
 * Both sentences as one string — what a screen reader hears, and what a
 * test asserts on.
 *
 * One announcement rather than two: the fact alone ("your coach updated
 * this workout") reads as something the client has to act on, and the
 * sentence that defuses it is the second one.
 */
export function speakProgramChanged(): string {
  return `${PROGRAM_CHANGED_FACT} ${PROGRAM_CHANGED_WHEN}`;
}

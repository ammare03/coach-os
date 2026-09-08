// When a stuck entry was queued, in the words the review sheet uses
// (frame C). `COPY.md` §CO6's date rule: relative within a week, absolute
// beyond.
//
// The DEVICE's calendar and locale are correct here, and this is the one
// surface where that is true rather than a bug: the rows describe work this
// person did on this phone, being read by that same person on that same
// phone. `code-conventions` §6's "never the device timezone" governs a
// coach in Mumbai reading a client in Toronto — a different situation with
// a different answer.
//
// No `date-fns`: it is not a dependency of `apps/mobile`, and adding one
// for four lines of calendar arithmetic would not survive `CLAUDE.md`
// §3.4.1 (`MedicalDisclaimerScreen` made the same call).

const MS_PER_DAY = 86_400_000;

/** Midnight local, so the difference below counts calendar days and not 24-hour blocks. */
function startOfLocalDay(at: Date): number {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
}

function formatLocalTime(at: Date): string {
  // Lowercased because `COPY.md` §CO6 is sentence case throughout; in a
  // 24-hour locale there is nothing to lowercase and this is a no-op.
  return at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).toLowerCase();
}

/**
 * `"Today, 6:42 pm"` · `"Yesterday, 6:42 pm"` · `"Tuesday, 6:42 pm"` ·
 * `"12 Aug, 6:42 pm"`.
 *
 * `nowMs` is a parameter rather than a `Date.now()` call so the boundaries
 * are testable — the day boundary is `CLAUDE.md` §25.5's named pitfall, and
 * an untestable one is how it stays broken.
 */
export function formatQueuedAt(atMs: number, nowMs: number): string {
  const at = new Date(atMs);
  const time = formatLocalTime(at);
  const daysAgo = Math.round((startOfLocalDay(new Date(nowMs)) - startOfLocalDay(at)) / MS_PER_DAY);

  // A negative difference means the device clock moved backwards, not that
  // the entry is in the future — say "Today" rather than a date nobody can
  // make sense of.
  if (daysAgo <= 0) return `Today, ${time}`;
  if (daysAgo === 1) return `Yesterday, ${time}`;
  if (daysAgo < 7) return `${at.toLocaleDateString(undefined, { weekday: 'long' })}, ${time}`;
  return `${at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`;
}

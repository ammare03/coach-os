import { useCallback, useEffect, useRef, useState } from 'react';

import { getLocalDb, type LocalDb } from '../../../db/client.ts';
import { clampPageIndex } from '../lib/exercise-pages.ts';
import { readLoggerPosition, writeLoggerPosition } from '../lib/logger-position.ts';

// Which exercise the client is on, restored on mount and persisted on every
// change — `session-runtime/03`'s second acceptance criterion, and the half
// of it `session-runtime/06`'s kill-recovery depends on.
//
// **The write is issued in the same tick as the change. There is no
// debounce, no batching window, and no coalescing timer — and adding one is
// the specific regression task 06's audit exists to catch.** A client whose
// phone is killed between the page turn and a timer firing would come back
// to the wrong exercise, which is exactly the data loss §8.4 forbids.
//
// Writes are chained rather than fired in parallel, and each link reads the
// LATEST index rather than the one it was queued with: two fast page turns
// therefore produce two writes whose final state is the second turn, never
// the first. An out-of-order completion cannot resurrect a stale position.
//
// A failed write is swallowed into a console warning rather than a screen.
// Losing a position is not worth interrupting a set, and the next page turn
// writes again anyway — whereas an error surfaced mid-workout is a modal
// between a client and their next rep.

export interface UseExercisePositionResult {
  /** Always inside `[0, pageCount)`, so it is safe to hand straight to the pager. */
  index: number;
  /** Persists immediately. Clamps, so a caller cannot store an index off the end. */
  setIndex: (next: number) => void;
}

// There is deliberately no `isRestored` flag. The restore resolves to `0`
// for every session that has never been paged, which is also what the pager
// shows while the read is in flight — so a caller gating on it would gate
// on a distinction with no rendering behind it, and pay a second state
// update (and a second render) to learn nothing.

export function useExercisePosition(
  sessionLocalId: string,
  pageCount: number,
): UseExercisePositionResult {
  const [index, setIndexState] = useState(0);

  // The handle, resolved once. `getLocalDb()` memoises its own promise, so
  // this is a reference rather than a second connection — holding it means
  // a page turn does not have to await the open before it can write.
  const database = useRef<LocalDb | null>(null);
  const latest = useRef(0);
  const chain = useRef<Promise<void>>(Promise.resolve());
  // Whether the client has moved since mount. The restore below is async —
  // it has to open the handle and read a row — and a client who swipes
  // before it lands has ALREADY chosen a position. Without this, the
  // resolving restore would overwrite `latest.current` with the row it read
  // before the turn, and the write queued behind it would then persist that
  // stale index: the client swipes to exercise 3, the restore lands, and
  // the device is left claiming they are on exercise 1.
  const hasMoved = useRef(false);

  useEffect(() => {
    let alive = true;

    void (async () => {
      try {
        const db = await getLocalDb();
        if (!alive) return;
        database.current = db;

        const stored = await readLoggerPosition(db, sessionLocalId);
        // A turn that landed while the read was in flight outranks the row
        // the read returned: the client is looking at the page they chose,
        // and the restore is now describing the past.
        if (!alive || hasMoved.current) return;

        // Clamped against the CURRENT page count: a coach may have removed
        // an exercise since this position was written, and restoring past
        // the end would render a blank page.
        const restored = clampPageIndex(stored ?? 0, pageCount);
        latest.current = restored;
        // Skipped when it changes nothing — which is the common case, since
        // a session opened for the first time restores to the 0 the pager
        // is already showing. A no-op set is still a render.
        if (restored !== 0) setIndexState(restored);
      } catch {
        // A mirror that will not answer is not a reason to refuse to open
        // the session — the client still has a workout in front of them.
        // They start at the first exercise, which is where a session with
        // no stored position starts anyway.
      }
    })();

    return () => {
      alive = false;
    };
    // `pageCount` is deliberately NOT a dependency: it is read once to
    // clamp the restored value, and re-running this on a page-count change
    // would throw away the client's position mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionLocalId]);

  const setIndex = useCallback(
    (next: number) => {
      const clamped = clampPageIndex(next, pageCount);
      hasMoved.current = true;
      latest.current = clamped;
      setIndexState(clamped);

      // The catch is part of the chain rather than a branch off it, so the
      // link the NEXT page turn builds on is always settled-fulfilled. A
      // branch would leave `chain.current` rejected until its handler ran,
      // and a turn landing inside that window would chain onto a rejected
      // promise — skipping its own write, which is the one failure mode
      // this whole file exists to avoid.
      chain.current = chain.current
        .then(async () => {
          const db = database.current ?? (await getLocalDb());
          database.current = db;
          // `latest.current`, not `clamped` — the newest value always wins.
          await writeLoggerPosition(db, sessionLocalId, latest.current);
        })
        .catch((error: unknown) => {
          console.warn('Could not persist the logger position', error);
        });
    },
    [pageCount, sessionLocalId],
  );

  return { index: clampPageIndex(index, pageCount), setIndex };
}

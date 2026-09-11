import { useCallback, useEffect, useState } from 'react';

import { readSessionSummary, type SessionSummaryRead } from '../lib/session-summary.ts';

// `phase-09-workout-logger/session-summary/01` — the screen's read, and the
// only three answers it can give.
//
// Three decisions:
//
// (a) **No TanStack Query, deliberately.** There is no server call here at
//     all: `lib/session-summary.ts` reads local SQLite and the device's own
//     stores. Wrapping a local read in the server-state library would give
//     it a `staleTime`, a refetch-on-focus, and a retry policy, none of
//     which mean anything for a row that only this device can change —
//     `code-conventions` §5 puts server data in Query and nothing else
//     there. The same shape `useLoggerSession` uses, for the same reason.
//
// (b) **A missing row is a state, not an error.** A deep link to a session
//     this device never had, and one cleared by a schema-version drop, both
//     land here; neither is a fault the client can retry their way out of,
//     and rendering `LOCAL_READ_FAILED` over it would blame a mirror that
//     is working correctly.
//
// (c) **The read is re-runnable.** {@link UseSessionSummaryResult.retry} is
//     what the error state's one action calls. It re-reads rather than
//     re-mounting, so a transient SQLite failure costs a tap and not the
//     screen.

export type SessionSummaryState =
  | { kind: 'loading' }
  /** The device holds no such session — decision (b). */
  | { kind: 'missing' }
  /** `ERRORS.md` ER§1.4's `LOCAL_READ_FAILED`. */
  | { kind: 'error'; error: unknown }
  | { kind: 'summary'; summary: SessionSummaryRead };

export interface UseSessionSummaryResult {
  state: SessionSummaryState;
  retry: () => void;
}

export function useSessionSummary(sessionLocalId: string): UseSessionSummaryResult {
  const [state, setState] = useState<SessionSummaryState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const summary = await readSessionSummary(sessionLocalId);
        // The screen may be gone by the time SQLite answers — a state write
        // after that is a React warning and a leak.
        if (!active) return;
        setState(summary === null ? { kind: 'missing' } : { kind: 'summary', summary });
      } catch (error: unknown) {
        if (!active) return;
        setState({ kind: 'error', error });
      }
    })();

    return () => {
      active = false;
    };
  }, [sessionLocalId, attempt]);

  const retry = useCallback(() => {
    setState({ kind: 'loading' });
    setAttempt((previous) => previous + 1);
  }, []);

  return { state, retry };
}

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  readFailedOutboxEntries,
  retryFailedOutboxEntries,
  type FailedOutboxSummary,
} from '../../lib/outbox/failed-entries.ts';

// Wires the outbox's permanently-failed rows to `SyncFailureBanner` and
// `SyncFailureSheet`.
//
// `useState` + `useEffect`, not TanStack Query: this is device-local SQLite,
// not server state, and `code-conventions` §5 puts only the latter in the
// query cache. Same shape as `useSchemaVersionGate`, the other P08 surface
// reading the local database.
//
// It does not poll. Nothing can add a permanently-failed row except a
// flush, so a screen refreshes on foreground and after its own flush — a
// timer here would wake the device to re-read a table that almost never
// changes.

const EMPTY: FailedOutboxSummary = { totalCount: 0, groups: [] };

export type SyncFailures = {
  summary: FailedOutboxSummary;
  isRetrying: boolean;
  /** Re-reads the outbox. Call on screen focus and after a flush. */
  refresh: () => Promise<void>;
  /** Re-queues everything stuck and flushes it, then re-reads. */
  retry: () => Promise<void>;
};

export function useSyncFailures(): SyncFailures {
  const [summary, setSummary] = useState<FailedOutboxSummary>(EMPTY);
  const [isRetrying, setIsRetrying] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const next = await readFailedOutboxEntries();
    if (mounted.current) setSummary(next);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const retry = useCallback(async () => {
    setIsRetrying(true);
    try {
      await retryFailedOutboxEntries();
      await refresh();
    } finally {
      // Always, including on a throw: a spinner left running makes the one
      // recovery the client has look permanently unavailable. The rejection
      // still propagates to Sentry's handler rather than being swallowed
      // (`code-conventions` §8).
      if (mounted.current) setIsRetrying(false);
    }
  }, [refresh]);

  return { summary, isRetrying, refresh, retry };
}

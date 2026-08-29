// `account-lifecycle/11` — request, poll, and download, in one hook so
// `YourDataScreen.tsx` stays composition-only (`code-conventions` §1: "a
// tRPC mutation... inside a route file is a review blocker" — this hook is
// what a screen delegates to instead).
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from 'api/src/routers/index.ts';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';

import { api } from '../../../lib/trpc.ts';

export type ExportItem = inferRouterOutputs<AppRouter>['me']['exportHistory']['items'][number];
export type ExportStatus = inferRouterOutputs<AppRouter>['me']['exportStatus'];

const TERMINAL_STATUSES = new Set<ExportItem['status']>(['ready', 'failed', 'expired']);

function isActive(status: ExportItem['status']): boolean {
  return status === 'queued' || status === 'building';
}

/**
 * `account-lifecycle/11`'s exact data contract: history on mount
 * (`staleTime` 30s, set once at the query-client level per feature — this
 * hook only supplies the key/shape), status polled every 5s **only** while
 * `queued`/`building`, and polling stops on a terminal state or on
 * unmount — `refetchInterval`'s own return value is what makes the second
 * half automatic; React Query tears down the interval when the component
 * (and this hook with it) unmounts.
 */
export function useExport() {
  const utils = api.useUtils();
  const history = api.me.exportHistory.useQuery({});

  // The export currently in flight. A just-fired request is tracked
  // locally so the UI reflects it before `history` has had a chance to
  // refetch (Interactions: "Optimistic → building state") — server truth
  // (the most recent active row in `history`) takes over the moment it's
  // available, which is also what resolves the "kill the app mid-build,
  // reopen" verification step without any extra code path.
  const [localActiveId, setLocalActiveId] = useState<string | null>(null);
  const historyActiveId = history.data?.items.find((item) => isActive(item.status))?.id ?? null;
  const activeId = historyActiveId ?? localActiveId;

  const status = api.me.exportStatus.useQuery(
    { exportId: activeId ?? '' },
    {
      enabled: activeId !== null,
      refetchInterval: (query) => {
        const current = query.state.data?.status;
        return current !== undefined && isActive(current) ? 5000 : false;
      },
    },
  );

  // Fires once, on the transition into a terminal state (`status.data`'s
  // reference only changes on a refetch, and `refetchInterval` above stops
  // refetching once terminal) — refreshes `history` so the just-finished
  // export's row appears without a manual pull-to-refresh. Deliberately no
  // `setLocalActiveId(null)` here: `historyActiveId` takes priority the
  // moment the invalidated history resolves, and a stale terminal
  // `localActiveId` in the meantime still reports the right (non-`active`)
  // status, so nothing reads it as still in flight.
  useEffect(() => {
    if (status.data && TERMINAL_STATUSES.has(status.data.status)) {
      void utils.me.exportHistory.invalidate();
    }
  }, [status.data, utils]);

  const requestExport = api.me.requestExport.useMutation({
    onSuccess: (result) => {
      setLocalActiveId(result.exportId);
    },
    onError: (error) => {
      // `EXPORT_ALREADY_RUNNING` names the export that's already in
      // flight (ERRORS.md ER§1.9a: "points at the in-flight request's own
      // status") — tracking it locally turns what would otherwise be a
      // dead-end error into the same live status view a fresh request
      // would have produced.
      if (error.data?.appCode === 'EXPORT_ALREADY_RUNNING') {
        const details = error.data.details as { exportId?: string } | undefined;
        if (details?.exportId) setLocalActiveId(details.exportId);
      }
    },
    onSettled: () => {
      void utils.me.exportHistory.invalidate();
    },
  });

  /**
   * Never an in-app `<a download>` or blob save (this task's own Risks
   * section) — the signed URL goes to the system browser, which is what
   * actually handles a multi-hundred-megabyte file safely.
   */
  async function download(exportId: string): Promise<void> {
    const result = await utils.me.exportDownloadUrl.fetch({ exportId });
    if (result.downloadUrl) {
      await WebBrowser.openBrowserAsync(result.downloadUrl);
    }
  }

  return {
    history,
    activeId,
    status: activeId !== null ? status : undefined,
    requestExport,
    download,
  };
}

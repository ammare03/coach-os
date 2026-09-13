import { useUndoToast, useToast } from '@coachos/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { asUuid, trackEvent } from '../../../lib/analytics/index.ts';
import { api } from '../../../lib/trpc.ts';
import { clientDetailKeys, type ClientOverview } from '../api.ts';

import { COACH_DASHBOARD_QUERY_KEY, type CoachDashboard } from './useCoachDashboard.ts';

// `relationship-controls/01`'s four coach-side actions, and the one place
// any of them touches the cache.
//
// **Two cache entries, not three.** `coach.clients.overview` is read twice
// — once whole by the Overview tab and once narrowed by `useClientIdentity`
// for the facet bar's header — but through ONE `['clients', id, 'overview']`
// entry with a `select` (`api.ts`). So patching the overview is what moves
// the header chip; there is no separate identity entry to keep in step. The
// second entry is `['coach', 'dashboard']`, which carries this client's row.
//
// **Not the phase-08 outbox, deliberately.** These are coach-app actions on
// a connected screen, not a client's work logged in a gym basement
// (`api-conventions` §4 — `setClientStatusInput` carries no
// `clientLocalId`). Replay safety comes from the transition being
// idempotent instead: asking for the status a row already has is a no-op
// success, so a retry, a double tap, and an undo racing its own commit all
// settle on the same row.

export interface ClientStatusControls {
  /** Optimistic, with a five-second undo. Nothing is sent until the window closes. */
  pause: () => void;
  /** The same — and inside an open pause window it is the UNDO, not a second mutation. */
  resume: () => void;
  /** Immediate, behind the typed word. */
  archive: () => void;
  /** Immediate, behind the typed word. `detachClient`, never a status change. */
  release: () => void;
  /** An open undo window or an in-flight write — what makes the other rows inert. */
  isPending: boolean;
}

export interface UseClientStatusOptions {
  /** Named in the two announcements that report an irreversible act (`accessibility` §2). */
  firstName: string;
  /** Where a released client's screen goes. The hook never touches the router. */
  onReleased: () => void;
}

/** Both entries a status write touches, named once so neither can be forgotten. */
interface StatusCacheSnapshot {
  overview: ClientOverview | undefined;
  dashboard: CoachDashboard | undefined;
}

type StatusTarget = 'active' | 'paused' | 'archived';

/**
 * A pause or resume that has been applied locally and not yet sent.
 *
 * `cancelled` is what makes Resume-inside-the-window free. `ToastProvider`
 * resolves `dismissToast` as `'dismissed'`, and `useUndoToast` commits on
 * anything that is not `'action'` — so dismissing a pending toast would
 * send the very mutation the coach just took back. The commit closure reads
 * this flag instead, and the dismissal then only removes the toast.
 */
interface PendingWindow {
  toastId: string;
  target: StatusTarget;
  cancelled: boolean;
  /** Puts both cache entries back. The same closure `Undo` runs. */
  undo: () => void;
}

export function useClientStatus(
  clientId: string,
  { firstName, onReleased }: UseClientStatusOptions,
): ClientStatusControls {
  const utils = api.useUtils();
  const queryClient = useQueryClient();
  const showUndoToast = useUndoToast();
  const { dismissToast } = useToast();

  const pendingRef = useRef<PendingWindow | null>(null);
  // Mirrors the ref for rendering. The ref is what the toast's own
  // callbacks read — they outlive the render that created them — and this
  // is what the rows read.
  const [hasPendingWindow, setHasPendingWindow] = useState(false);

  const overviewKey = clientDetailKeys.tab(clientId, 'overview');

  function snapshot(): StatusCacheSnapshot {
    return {
      overview: queryClient.getQueryData<ClientOverview>(overviewKey),
      dashboard: queryClient.getQueryData<CoachDashboard>(COACH_DASHBOARD_QUERY_KEY),
    };
  }

  /** In-flight requests would otherwise land on top of the patch. */
  async function cancelInFlight(): Promise<void> {
    await Promise.all([
      queryClient.cancelQueries({ queryKey: overviewKey }),
      queryClient.cancelQueries({ queryKey: COACH_DASHBOARD_QUERY_KEY }),
    ]);
  }

  function writeStatus(status: ClientOverview['status']): void {
    const current = snapshot();
    if (current.overview !== undefined) {
      queryClient.setQueryData(overviewKey, { ...current.overview, status });
    }
    if (current.dashboard !== undefined) {
      queryClient.setQueryData(COACH_DASHBOARD_QUERY_KEY, {
        ...current.dashboard,
        clients: current.dashboard.clients.map((client) =>
          client.clientId === clientId ? { ...client, status } : client,
        ),
      });
    }
  }

  /** A released client is no longer this coach's, so the row goes rather than changes. */
  function removeRow(): void {
    const current = snapshot();
    if (current.dashboard === undefined) return;
    queryClient.setQueryData(COACH_DASHBOARD_QUERY_KEY, {
      ...current.dashboard,
      clients: current.dashboard.clients.filter((client) => client.clientId !== clientId),
    });
  }

  function restore(previous: StatusCacheSnapshot | undefined): void {
    if (previous === undefined) return;
    if (previous.overview !== undefined) queryClient.setQueryData(overviewKey, previous.overview);
    if (previous.dashboard !== undefined) {
      queryClient.setQueryData(COACH_DASHBOARD_QUERY_KEY, previous.dashboard);
    }
  }

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: overviewKey });
    void queryClient.invalidateQueries({ queryKey: COACH_DASHBOARD_QUERY_KEY });
  }

  function clearPending(): void {
    pendingRef.current = null;
    setHasPendingWindow(false);
  }

  const setStatus = useMutation({
    mutationFn: (status: StatusTarget) =>
      utils.client.coach.clients.setStatus.mutate({ clientId, status }),
    onSettled: () => {
      invalidate();
    },
  });

  const release = useMutation({
    mutationFn: () => utils.client.coach.clients.release.mutate({ clientId }),
    onSettled: () => {
      invalidate();
    },
  });

  /**
   * The deferred pair. Applied locally now, sent when the window closes —
   * `useUndoToast`'s documented default, and the right one here: an
   * immediate write would need a compensating mutation on undo, and a
   * compensating mutation that fails leaves the coach looking at a client
   * they just un-paused who is still paused.
   */
  function deferred(target: StatusTarget, message: string, announcement: string): void {
    const previous = snapshot();
    void cancelInFlight();
    writeStatus(target);
    // An optimistic update with no announcement is invisible to a screen
    // reader — `accessibility` §2's named failure.
    AccessibilityInfo.announceForAccessibility(announcement);

    // The record the toast's own callbacks close over. **Captured
    // directly, never re-read from `pendingRef`** — `undo()` clears that
    // ref, so a commit closure that consulted it would find `null`, read
    // "not cancelled", and send the mutation the coach just took back.
    // The ref exists for `resume()` to FIND the open window; this object
    // is what the window's own callbacks reason about.
    const record: PendingWindow = {
      toastId: '',
      target,
      cancelled: false,
      undo: () => {
        restore(previous);
        clearPending();
        AccessibilityInfo.announceForAccessibility(UNDONE_ANNOUNCEMENT[target]);
      },
    };

    record.toastId = showUndoToast({
      message,
      onUndo: record.undo,
      onCommit: () => {
        // Cancelled by a Resume tapped inside the window — see
        // `PendingWindow`. Nothing was ever sent, so nothing is undone.
        if (record.cancelled) return;
        clearPending();
        setStatus.mutate(target);
        // On the commit, never on the tap: an undone pause never happened,
        // and an event fired at tap time would count it (`ANALYTICS.md`
        // AN§3.5). Resume has no event — it is derivable from the pair.
        if (target === 'paused') {
          trackEvent('client_paused', { client_id: asUuid(clientId) });
        }
      },
    });

    pendingRef.current = record;
    setHasPendingWindow(true);
  }

  function pause(): void {
    deferred('paused', 'Coaching paused', 'Coaching paused. Undo is available for five seconds.');
  }

  function resume(): void {
    const pending = pendingRef.current;
    // **The sharp edge.** Inside an open pause window the server still
    // believes this client is active, so "resume" has nothing to resume —
    // it is the undo, expressed as the row below it. Cancel the commit and
    // dismiss the toast rather than sending a second mutation that would
    // race the first.
    if (pending !== null && pending.target === 'paused') {
      pending.cancelled = true;
      // The same restore `Undo` would have run — because tapping Resume
      // here IS the undo, expressed as the row rather than as the toast.
      pending.undo();
      // Resolves as `'dismissed'`, which `useUndoToast` treats as a commit;
      // `cancelled` is what the commit closure checks, so this only takes
      // the toast off the screen.
      dismissToast(pending.toastId);
      return;
    }
    deferred('active', 'Coaching resumed', 'Coaching resumed.');
  }

  /**
   * The two typed-confirmation actions. Immediate rather than deferred:
   * both are already deliberate — a coach typed the word — and neither is
   * reversible in a way a five-second toast could honestly offer
   * (`ui-conventions` §5's two named exceptions).
   */
  function archive(): void {
    const previous = snapshot();
    void cancelInFlight();
    writeStatus('archived');
    setStatus.mutate('archived', {
      onSuccess: () => {
        AccessibilityInfo.announceForAccessibility(`${firstName} is archived. Their seat is free.`);
        trackEvent('client_archived', { client_id: asUuid(clientId) });
      },
      onError: () => {
        restore(previous);
      },
    });
  }

  function handleRelease(): void {
    const previous = snapshot();
    void cancelInFlight();
    removeRow();
    release.mutate(undefined, {
      onSuccess: () => {
        AccessibilityInfo.announceForAccessibility(
          `${firstName} is released. They have been emailed.`,
        );
        trackEvent('client_released', { client_id: asUuid(clientId) });
        onReleased();
      },
      onError: () => {
        restore(previous);
      },
    });
  }

  return {
    pause,
    resume,
    archive,
    release: handleRelease,
    isPending: hasPendingWindow || setStatus.isPending || release.isPending,
  };
}

/** What a screen reader hears when the window is taken back. */
const UNDONE_ANNOUNCEMENT: Record<StatusTarget, string> = {
  paused: 'Pause undone.',
  active: 'Resume undone.',
  // Unreachable — archive is never deferred. Kept so the record stays
  // exhaustive rather than partial.
  archived: 'Archive undone.',
};

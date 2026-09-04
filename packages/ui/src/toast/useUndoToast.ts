import { useCallback } from 'react';

import { useToast } from './ToastProvider.tsx';

/**
 * `CLAUDE.md` §7.5's window. Five seconds is long enough to notice a
 * mistake and short enough that a screen's state is never ambiguous for
 * long. It is not a tuning knob — a feature that wants a different number
 * is asking for a different pattern.
 */
export const UNDO_WINDOW_MS = 5000;

export interface UndoToastOptions {
  /** What happened, past tense, no exclamation mark: "Set deleted" (`COPY.md` CO§4.3). */
  message: string;
  /** Reverses the optimistic change. Runs immediately when Undo is tapped. */
  onUndo: () => void;
  /**
   * The deferred server mutation. Runs once, when the window closes with
   * the action untaken — see the timing note below for why nothing is sent
   * before that.
   */
  onCommit?: () => void;
  /** Defaults to `UNDO_WINDOW_MS`. */
  durationMs?: number;
  /** Defaults to `"Undo"`. Sentence case. */
  undoLabel?: string;
}

/** Returns the toast's id, so a screen leaving early can settle it with `dismissToast`. */
export type ShowUndoToast = (options: UndoToastOptions) => string;

/**
 * The undo pattern, and the reason this product has almost no confirmation
 * dialogs.
 *
 * `CLAUDE.md` §7.5 / `ui-conventions` §5: **a destructive action performs
 * immediately and offers a 5-second undo — it does not ask first.** A
 * confirm dialog interrupts the flow and gets dismissed reflexively without
 * being read, so it buys the appearance of safety and none of it. An undo
 * toast is the opposite trade: the action feels instant, and the recovery
 * window is real.
 *
 * ---
 *
 * ### The two exceptions — never reach for this hook for either
 *
 * | Action | What it uses instead |
 * |---|---|
 * | **Account deletion** | A typed confirmation (`ConfirmModal`), built by `phase-03-identity-and-auth/account-lifecycle/03` |
 * | **Client archival** | A typed confirmation (`ConfirmModal`), built in P10 |
 *
 * Both are named exceptions in §7.5 and both are irreversible in a way a
 * five-second window cannot honestly cover — deletion starts a 7-day purge
 * (§21.4) and archival holds a seat for 30 days (§15.5). A toast would
 * promise a take-back that does not exist. `ConfirmModal`'s own header
 * carries the same rule from the other direction: it ships with exactly
 * these two consumers and a third is a design review, not an import.
 *
 * ---
 *
 * ### Server-mutation timing — the mutation is DEFERRED, and this is the default
 *
 * The optimistic change applies in the caller's UI immediately; **nothing
 * is sent to the server until the window closes.** `onUndo` therefore only
 * has to put the local state back — there is no delete to reverse, because
 * no delete was ever sent. The alternative (fire immediately, re-create on
 * undo) needs a second, compensating mutation, and a compensating mutation
 * that fails leaves the user staring at a row they just brought back and
 * that is not there.
 *
 * A feature that genuinely needs immediate server commitment — a moderation
 * action, anything another party observes in real time — does not use this
 * hook's `onCommit`; it writes first and documents why at the call site.
 *
 * ```ts
 * const showUndoToast = useUndoToast();
 *
 * function handleDeleteSet(setId: string) {
 *   removeSetFromDraft(setId);            // optimistic, local, instant
 *   showUndoToast({
 *     message: 'Set deleted',
 *     onUndo: () => restoreSetInDraft(setId),
 *     onCommit: () => deleteSet.mutate({ setId }),
 *   });
 * }
 * ```
 */
export function useUndoToast(): ShowUndoToast {
  const { showToast } = useToast();

  return useCallback(
    ({ message, onUndo, onCommit, durationMs = UNDO_WINDOW_MS, undoLabel = 'Undo' }) =>
      showToast({
        message,
        durationMs,
        showCountdown: true,
        action: { label: undoLabel, onPress: onUndo },
        // Fires once, with the reason. Dismissing the toast early is the
        // user saying they are done looking, not that they want it back —
        // so it commits, exactly as the elapsed window does.
        onResolve: (resolution) => {
          if (resolution !== 'action') onCommit?.();
        },
      }),
    [showToast],
  );
}

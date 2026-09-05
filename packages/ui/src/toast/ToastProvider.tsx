import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { StyleSheet, View } from 'react-native';

import { duration, spacing } from '../theme/tokens.ts';

import { Toast, type ToastAction } from './Toast.tsx';

/**
 * Why a toast went away. The undo pattern turns on this distinction:
 * `'action'` means the user took it back, the other two mean the window
 * closed and the action stands (`useUndoToast`).
 */
export type ToastResolution = 'timeout' | 'action' | 'dismissed';

export interface ShowToastOptions {
  /** What happened, as a fact — "Set deleted" (`COPY.md` CO§4.3). */
  message: string;
  action?: ToastAction | undefined;
  /** Defaults to `TOAST_DEFAULT_DURATION_MS`. The undo window is 5s (`CLAUDE.md` §7.5). */
  durationMs?: number | undefined;
  /** Show the remaining whole seconds. On for the undo pattern, off for a plain toast. */
  showCountdown?: boolean | undefined;
  /**
   * Fired exactly once, with the reason. `'action'` fires *before* the
   * action's own `onPress`, so a consumer can treat this as the single
   * place a toast's outcome is decided.
   */
  onResolve?: ((resolution: ToastResolution) => void) | undefined;
}

export interface ToastContextValue {
  /** Queues a toast and returns its id. */
  showToast: (options: ShowToastOptions) => string;
  /** Resolves a toast early as `'dismissed'`. A no-op if it has already resolved. */
  dismissToast: (id: string) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

/** A plain informational toast. The undo window is longer and lives in `useUndoToast`. */
export const TOAST_DEFAULT_DURATION_MS = 4000;

/**
 * How many toasts are on screen at once. Past this they queue, and a queued
 * toast is not mounted, so its window has not started — which is the whole
 * reason for a cap rather than an ever-growing stack: a fourth undo offer
 * hidden behind three others would expire before it was ever readable.
 */
export const MAX_VISIBLE_TOASTS = 3;

/**
 * The action bar's position (`DESIGN.md` §9): `bottom: 102px`, clear of the
 * 64px dock at `bottom: 26px`. A screen without a dock passes its own
 * offset.
 */
export const TOAST_BOTTOM_OFFSET = 102;

// `toastId` rather than `id`: an object type with an `id` field is what
// `local/no-hand-written-row-type` flags as a database row, and this is a
// transient view record that never touches the DB.
interface ToastRecord {
  toastId: string;
  options: ShowToastOptions;
  phase: 'live' | 'leaving';
}

let nextToastId = 0;

export interface ToastProviderProps {
  children: ReactNode;
  /** Distance from the bottom of the screen. Defaults to `TOAST_BOTTOM_OFFSET`. */
  bottomOffset?: number;
}

/**
 * Mounted once, at the app root (`phase-05-app-shell/providers-and-gates/01`).
 * Owns the queue; `Toast` owns each entry's window and animation.
 *
 * **Toasts stack, they do not replace each other.** Deleting three sets in
 * three seconds has to leave three genuinely independent undo windows —
 * serialising them would push the third offer past the point the user still
 * remembers making it. Three at a time, newest nearest the thumb, the rest
 * queued.
 *
 * `UI-UX.md` §UX6.5 rule 29: a focus mode (the logger, the annotator) shows
 * no toast at all. That is the calling screen's decision, not this
 * component's — it cannot see where it is.
 */
export function ToastProvider({
  children,
  bottomOffset = TOAST_BOTTOM_OFFSET,
}: ToastProviderProps) {
  const [queue, setQueue] = useState<ToastRecord[]>([]);
  // Resolution runs a consumer's callback, so it must not live in a
  // `setState` updater (React may call one twice). These two refs are what
  // let `resolve` read a toast's options and enforce fire-once outside the
  // reducer.
  const optionsById = useRef(new Map<string, ShowToastOptions>());
  const resolvedIds = useRef(new Set<string>());
  const exitTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const timers = exitTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const remove = useCallback((id: string) => {
    optionsById.current.delete(id);
    resolvedIds.current.delete(id);
    exitTimers.current.delete(id);
    setQueue((current) => current.filter((record) => record.toastId !== id));
  }, []);

  /** Returns whether this call was the one that resolved the toast. */
  const resolve = useCallback(
    (id: string, resolution: ToastResolution): boolean => {
      // Fire-once. A double tap on Undo must not run the consumer's
      // rollback twice, and a tap landing as the window closes must not
      // both revert and commit.
      if (resolvedIds.current.has(id)) return false;
      const options = optionsById.current.get(id);
      if (!options) return false;
      resolvedIds.current.add(id);

      options.onResolve?.(resolution);
      setQueue((current) =>
        current.map((record) => (record.toastId === id ? { ...record, phase: 'leaving' } : record)),
      );
      exitTimers.current.set(
        id,
        setTimeout(() => remove(id), duration.state),
      );
      return true;
    },
    [remove],
  );

  const showToast = useCallback((options: ShowToastOptions) => {
    nextToastId += 1;
    const id = `toast-${nextToastId}`;
    optionsById.current.set(id, options);
    setQueue((current) => [...current, { toastId: id, options, phase: 'live' }]);
    return id;
  }, []);

  const dismissToast = useCallback((id: string) => resolve(id, 'dismissed'), [resolve]);

  // Stable, and it has to be: `Toast` holds it as an effect dependency, so
  // a fresh closure per render would restart every open window each time a
  // new toast appeared.
  const handleTimeout = useCallback(
    (id: string) => {
      resolve(id, 'timeout');
    },
    [resolve],
  );

  // Both functions are stable, so the value is too — a screen that calls
  // `useToast()` never re-renders because a toast appeared somewhere else.
  const contextValue = useMemo<ToastContextValue>(
    () => ({ showToast, dismissToast }),
    [showToast, dismissToast],
  );

  const visible = queue.slice(0, MAX_VISIBLE_TOASTS);

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      {/* Oldest at the top, newest nearest the dock and the thumb. */}
      <View style={[styles.host, { bottom: bottomOffset }]} pointerEvents="box-none">
        {visible.map((record) => (
          <Toast
            key={record.toastId}
            toastId={record.toastId}
            message={record.options.message}
            action={
              record.options.action
                ? {
                    label: record.options.action.label,
                    // Guarded on `resolve`'s own fire-once, so a second tap
                    // landing during the exit animation runs nothing.
                    onPress: () => {
                      if (resolve(record.toastId, 'action')) record.options.action?.onPress();
                    },
                  }
                : undefined
            }
            durationMs={record.options.durationMs ?? TOAST_DEFAULT_DURATION_MS}
            showCountdown={record.options.showCountdown}
            isLeaving={record.phase === 'leaving'}
            onTimeout={handleTimeout}
            testID="toast"
          />
        ))}
      </View>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) {
    throw new Error('useToast() must be called within a <ToastProvider>.');
  }
  return value;
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    // The dock's own inset (`DESIGN.md` §9).
    left: spacing(14),
    right: spacing(14),
    gap: spacing(8),
  },
});

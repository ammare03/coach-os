import { ToastProvider } from '@coachos/ui';
import type { ReactNode } from 'react';

import { useToastBottomOffset } from './toast-bottom-offset.ts';

export interface RouteAwareToastProviderProps {
  children: ReactNode;
}

/**
 * `ToastProvider`, positioned against the chrome the current route actually
 * draws (UNFORGET S46).
 *
 * **One provider, not one per route group.** A second provider mounted inside
 * the dockless groups was the other candidate and is worse in two ways. A
 * pushed screen does not unmount the tab navigator beneath it, so both would be
 * mounted at once and which one a `useToast()` call reached would depend on
 * where the caller sat in the tree. Worse, a toast's undo window lives in the
 * provider that showed it: navigating mid-window would unmount that provider,
 * cancelling both the offer and its `onResolve`, and leaving an optimistic
 * delete neither committed nor rolled back. `useUndoToast` is load-bearing
 * enough that a placement fix must not put it at risk.
 *
 * **This component exists so the root layout does not have to re-render.** It
 * subscribes to the route, which every navigation changes; the root layout does
 * not. `children` arrives as an element the root layout built, so its identity
 * is stable across this component's re-renders and React skips the whole
 * subtree — including `<Stack>`, whose options object is recreated on every
 * render of the file that owns it.
 */
export function RouteAwareToastProvider({ children }: RouteAwareToastProviderProps) {
  const bottomOffset = useToastBottomOffset();

  return <ToastProvider bottomOffset={bottomOffset}>{children}</ToastProvider>;
}

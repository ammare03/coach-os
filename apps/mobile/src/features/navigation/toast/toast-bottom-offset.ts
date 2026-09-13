import { spacing } from '@coachos/ui/theme';
import { useSegments } from 'expo-router';
import { initialWindowMetrics } from 'react-native-safe-area-context';

import { clientTabBarInset } from '../client/client-dock-geometry.ts';
import { coachTabBarInset } from '../coach/coach-dock-metrics.ts';

// UNFORGET S46. `ToastProvider`'s own default, `TOAST_BOTTOM_OFFSET = 102`, is
// `DESIGN.md` §9's ACTION BAR position, and §9 states that position only as
// "above the dock" — 26 + 64 + 12, the dock's bottom plus its height plus the
// content gap. §9 has no Toast row, so the toast borrowed a number whose whole
// meaning is a dock.
//
// The dock is drawn by the `(tabs)` navigator and by nothing else — structural,
// not a per-screen option (`(coach)/_layout.tsx`). Nine of the app's eleven
// layouts have no dock, so on most of the product 102 was 76px of clearance
// over nothing, which reads as an action bar: a surface that stays. A toast is
// the opposite of that.
//
// This module is the route-aware half of the fix and it lives HERE rather than
// in `packages/ui` deliberately: `packages/ui` has no router dependency and
// must not gain one. `ToastProvider` already takes a `bottomOffset` and already
// documents "a screen without a dock passes its own offset" — the seam existed,
// nothing computed the value.

/** The dock's own navigator segment. Its presence is the whole test. */
const TABS_SEGMENT = '(tabs)';

const COACH_GROUP = '(coach)';

/**
 * §9's `bottom: 26px`, transcribed a third time on purpose.
 *
 * The two dock modules each hold their own copy because §9 states the dock as
 * ranges and the two apps sit at its ends. A dockless route has neither dock,
 * so importing either one's constant would make, say, a client's settings
 * toast follow the *coach* dock's geometry — a coupling with no meaning that
 * would survive until someone moved one dock and not the other. What the toast
 * actually inherits is §9's floor: the app's lowest floating chrome begins 26
 * from the screen edge, and which chrome it happens to be does not change that.
 */
export const DOCKLESS_TOAST_BOTTOM = spacing(26);

/**
 * Where the toast host's lower edge belongs, given the route and the live
 * bottom inset.
 *
 * Docked routes resolve to the dock's own content inset, which is the same
 * function every scrollable tab screen already uses to keep its last row
 * tappable — so the toast and the dock can no longer disagree about where the
 * dock is. At a zero inset that is exactly the shipped 102; on a device that
 * lifts the client dock it follows, instead of closing §9's 12px gap to 4.
 */
export function resolveToastBottomOffset(
  segments: readonly string[],
  safeAreaBottom: number,
): number {
  if (!segments.includes(TABS_SEGMENT)) {
    return Math.max(DOCKLESS_TOAST_BOTTOM, safeAreaBottom);
  }

  return segments[0] === COACH_GROUP
    ? coachTabBarInset(safeAreaBottom)
    : clientTabBarInset(safeAreaBottom);
}

/**
 * `resolveToastBottomOffset` against the live route.
 *
 * `initialWindowMetrics` rather than `SafeAreaInsetsContext`, which is what
 * every screen in this app reads: there is no `SafeAreaProvider` in the
 * production tree at all — each navigator's own `SafeAreaProviderCompat`
 * supplies one, and the toast host is mounted ABOVE every navigator. The
 * context is therefore always null at this position, so reading it would be
 * dead code that looks live and would silently pin the offset to a zero inset.
 * `initialWindowMetrics` is read from the native module at import and needs no
 * provider, which is the case it exists for. It is `null` under Jest.
 */
export function useToastBottomOffset(): number {
  // `useSegments()` returns a union of tuples generated from the route tree;
  // widening it is how `(auth)/_layout.tsx` reads segments it wants to compare
  // rather than destructure.
  const segments: readonly string[] = useSegments();
  return resolveToastBottomOffset(segments, initialWindowMetrics?.insets.bottom ?? 0);
}

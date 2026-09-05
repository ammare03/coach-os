import { spacing, tapTarget } from '@coachos/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Every number here is `DESIGN.md` §9's Dock row, transcribed, and cross-read
// against the live markup in `CoachOS-Coach.dc.html` (the dock is the
// `tabsVisible` block). They live in one module rather than inside
// `CoachTabBar` because the dock FLOATS: it is out of the layout flow, so
// every scrollable coach screen has to know how tall the strip it hides is
// (`router-skeleton/03`, "Content scrolls beneath the bar, not up to it").
//
// Coach-scoped on purpose. `router-skeleton/04` builds the client dock from
// the same §9 row with four items; whether the two collapse into one shared
// primitive is a decision for after both exist, not a guess made while they
// are being written in parallel.
//
// `spacing()` rather than a bare literal wherever the value is genuinely a
// gap, a padding, or an offset — it throws on anything off §1.4's scale, so
// each call is a proof the design value survived the port. Geometry that is
// not spacing (an icon's box, a stroke width, the badge's diameter) stays a
// plain named constant; §1.4's scale does not govern those and forcing them
// through it would only be theatre.

/** §9 — `height: 64px`. */
export const COACH_DOCK_HEIGHT = spacing(64);

/** §9 — `left/right: 14–16px`. The prototype's own value is 14. */
export const COACH_DOCK_SIDE_INSET = spacing(14);

/** §9 — `bottom: 26px`, before the safe-area reconciliation below. */
export const COACH_DOCK_BOTTOM_GAP = spacing(26);

/** The prototype's `padding: 0 5px` on the dock itself. */
export const COACH_DOCK_PADDING_X = spacing(5);

/** §9 — item `52px`. Identical to `tapTarget.MID_SET`, which is why it reads from there. */
export const COACH_DOCK_ITEM_HEIGHT = tapTarget.MID_SET;

/** The prototype's `gap: 3px` between an item's icon and its label. */
export const COACH_DOCK_ITEM_GAP = spacing(3);

/** §9 — `icon 20–21px`. The prototype draws 20. */
export const COACH_DOCK_ICON_SIZE = 20;

/** The prototype's `stroke-width: 1.9` — lighter than Lucide's own 2 default. */
export const COACH_DOCK_ICON_STROKE_WIDTH = 1.9;

/** §9 — badge `17px` circle. Off §1.4's spacing scale, and it is a diameter, not a gap. */
export const COACH_DOCK_BADGE_SIZE = 17;

/** §9 — the badge's `1.5px` ring. */
export const COACH_DOCK_BADGE_BORDER_WIDTH = 1.5;

/** The prototype's badge offsets inside its item (`top: 2px` rounded up to §1.4's floor of 3, `right: 12px`). */
export const COACH_DOCK_BADGE_TOP = spacing(3);
export const COACH_DOCK_BADGE_RIGHT = spacing(12);

/** Breathing room between the last row of content and the dock's lower edge. */
export const COACH_DOCK_CONTENT_GAP = spacing(12);

// §9's `bottom: 26px` is measured from the physical screen edge and already
// contains the home-indicator band — the prototype draws the indicator at
// `bottom: 9px`, underneath the dock, deliberately. Subtracting the
// indicator's own height from the reported safe-area inset is what makes
// `Math.max` below a no-op on iOS (34 - 8 = 26, exactly §9's number) while
// still lifting the dock clear of an Android three-button navigation bar,
// where the inset is materially larger and 26px would put the dock under it.
const HOME_INDICATOR_ALLOWANCE = spacing(8);

/** Distance from the bottom of the screen to the dock's lower edge. */
export function resolveCoachDockBottom(safeAreaBottom: number): number {
  return Math.max(COACH_DOCK_BOTTOM_GAP, safeAreaBottom - HOME_INDICATOR_ALLOWANCE);
}

/**
 * The bottom content inset every scrollable coach tab screen owes the dock.
 * Without it the last row of a list sits under the glass and cannot be
 * tapped — the standard bug a floating tab bar introduces (`UI-UX.md` §UX1.2,
 * `router-skeleton/03`).
 */
export function coachTabBarInset(safeAreaBottom: number): number {
  return resolveCoachDockBottom(safeAreaBottom) + COACH_DOCK_HEIGHT + COACH_DOCK_CONTENT_GAP;
}

/** `coachTabBarInset` against the live safe area. The form a screen actually consumes. */
export function useCoachTabBarInset(): number {
  const insets = useSafeAreaInsets();
  return coachTabBarInset(insets.bottom);
}

import { radius, spacing, tapTarget } from '@coachos/ui/theme';
import { useContext } from 'react';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import type { DockItemGeometry } from '../dock/dock-item-geometry.ts';

/**
 * `DESIGN.md` §9's Dock row, read in its CLIENT column, plus the four
 * values `CoachOS-Client.dc.html` (the floating dock, lines 680–689) sets
 * differently from `CoachOS-Coach.dc.html` (line 659–664). Those four
 * divergences are deliberate and are the whole of `CLAUDE.md` §1.1's
 * two-context distinction expressed as geometry — a wider gutter, more
 * air inside the bar, a larger glyph, and a hair more tracking under the
 * label, because this bar is read at arm's length, one-handed, mid-set:
 *
 * |            | client | coach |
 * |------------|--------|-------|
 * | side inset | 16     | 14    |
 * | padding    | 6      | 5     |
 * | icon       | 21     | 20    |
 * | tracking   | .01em  | 0     |
 *
 * §9 gives the dock a range (`left/right: 14–16px`) rather than one number
 * precisely because the two contexts sit at its two ends. Do not "unify"
 * these with the coach dock's.
 */
export const CLIENT_DOCK = {
  /** §9 `left/right: 14–16px` — the client end of the range. */
  sideInset: spacing(16),
  /** §9 `bottom: 26px`. Floating, never flush — see `clientDockBottom`. */
  bottomInset: spacing(26),
  /** §9 `height: 64px`. A FLOOR, not a fixed height (`accessibility` §3). */
  height: spacing(64),
  /** Client `padding: 0 6px` (coach 5px). Also the item's vertical inset: (64 − 52) / 2 = 6. */
  padding: spacing(6),
  /**
   * §9 `Item 52px`. `tapTarget.MID_SET`, not a literal — §1.3 is explicit
   * that nav items are 52 rather than the 44 floor "because they are used
   * mid-set with sweaty hands", which is the same sentence that sizes the
   * logger's steppers.
   */
  itemHeight: tapTarget.MID_SET,
  /** Prototype `gap: 3px` between glyph and label. */
  itemGap: spacing(3),
  /** §9 `icon 20–21px` — the client end (coach uses 20). */
  iconSize: 21,
  /** Prototype `stroke-width: 1.9`, against Lucide's own default of 2. */
  iconStrokeWidth: 1.9,
  /** §9 `radius 32` / `radius 26` — both are height / 2, which is what §1.4 actually specifies. */
  radius: radius.full,
  /**
   * Prototype `style-active="transform:scale(.94)"`. Inside §5's
   * `scale(.92–.98)` press range, and deliberately deeper than the product
   * default of .97: a gym-floor tap needs to be felt, not inferred.
   */
  pressScale: 0.94,
  /** Breathing room between a screen's last row and the bar floating over it. */
  contentGap: spacing(12),
} as const;

/** Today · Nutrition · Progress · Coach (`UI-UX.md` §UX1.2). */
export const CLIENT_TAB_COUNT = 4;

/**
 * Vertical: reaches the bar's full 64px height from the 52px item, so the
 * whole visual dock is live rather than only the pill inside it. Horizontal:
 * exactly half the bar's own padding, so adjacent items tile the full width
 * with no dead seam between them and none of them overlap.
 *
 * Every edge stays INSIDE the dock's own bounds on purpose — `Pressable`'s
 * `hitSlop` does not survive a clipping parent, and `GlassSurface`'s
 * fallback paths render with `overflow: 'hidden'`. Slop that reached past
 * the bar would silently do nothing on Android and on iOS below 26.
 */
export const CLIENT_DOCK_ITEM_HIT_SLOP = {
  top: (CLIENT_DOCK.height - CLIENT_DOCK.itemHeight) / 2,
  bottom: (CLIENT_DOCK.height - CLIENT_DOCK.itemHeight) / 2,
  left: CLIENT_DOCK.padding / 2,
  right: CLIENT_DOCK.padding / 2,
} as const;

/** The client dock's `letter-spacing: .01em`, at `micro`'s 11px. The coach dock sets none. */
export const CLIENT_DOCK_LABEL_TRACKING = 0.11;

/**
 * `accessibility` §3 accepts a tab bar's labels being lost at 200% text
 * ("icons carry it, and every tab has a label for screen readers"). Capping
 * is strictly better than losing them: at 1.6 the label grows 11 → 17.6px
 * and the item's content still measures 21 + 3 + 24 = 48px inside its 52px
 * box, so nothing clips and the bar never has to grow. The screen reader
 * reads `accessibilityLabel`, which no font scale truncates.
 */
export const CLIENT_DOCK_LABEL_MAX_FONT_SCALE = 1.6;

/**
 * The client half of the two records `DockItem` is parameterised by. The
 * coach half is `COACH_DOCK_ITEM` in `coach/coach-dock-metrics.ts`.
 *
 * Four of these values are the divergence this file's header table names,
 * and they are the reason there are two records rather than one shared
 * default — see `dock/dock-item-geometry.ts` and the test beside it. Do not
 * "unify" them with the coach dock's.
 */
export const CLIENT_DOCK_ITEM = {
  itemHeight: CLIENT_DOCK.itemHeight,
  itemGap: CLIENT_DOCK.itemGap,
  iconSize: CLIENT_DOCK.iconSize,
  iconStrokeWidth: CLIENT_DOCK.iconStrokeWidth,
  pressScale: CLIENT_DOCK.pressScale,
  labelTracking: CLIENT_DOCK_LABEL_TRACKING,
  labelMaxFontScale: CLIENT_DOCK_LABEL_MAX_FONT_SCALE,
  hitSlop: CLIENT_DOCK_ITEM_HIT_SLOP,
} as const satisfies DockItemGeometry;

/**
 * Where the bar's bottom edge actually sits. §9's 26px is measured from the
 * screen edge, which is right on a device with no bottom inset and would put
 * the bar under the home indicator on one that has 34px of it. Taking the
 * larger of the two keeps §9's number wherever §9's assumption holds and
 * clears the indicator where it does not.
 */
export function clientDockBottom(safeAreaBottom: number): number {
  return Math.max(CLIENT_DOCK.bottomInset, safeAreaBottom);
}

/**
 * The bottom content inset every scrollable client tab screen owes the
 * floating dock. Content scrolls BENEATH the bar rather than stopping at it
 * (`UI-UX.md` §UX1.2), so without this the last row of a list sits under the
 * bar and cannot be tapped — the standard bug this material introduces.
 *
 * Exposed as one function so the number is derived once rather than typed
 * into four screens, and so it stays correct when the geometry above moves.
 */
export function clientTabBarInset(safeAreaBottom: number): number {
  return clientDockBottom(safeAreaBottom) + CLIENT_DOCK.height + CLIENT_DOCK.contentGap;
}

/**
 * `useSafeAreaInsets()` throws without a provider above it, and the root
 * layout has none yet (`providers-and-gates/01` owns that file). Reading the
 * context directly degrades to zero instead of crashing a screen rendered
 * bare in a test, and picks up the real inset the moment a provider exists —
 * inside the tab navigator one always does, since react-navigation's
 * `SafeAreaProviderCompat` supplies it.
 */
export function useClientTabBarInset(): number {
  const insets = useContext(SafeAreaInsetsContext);
  return clientTabBarInset(insets?.bottom ?? 0);
}

/**
 * The measured, tappable area of one dock item at a given screen width —
 * the number `04-client-tabs.md`'s "tap targets exceed the 48×48 minimum
 * with margin" acceptance criterion is actually about. A function rather
 * than a constant because the width depends on the device, and the
 * narrowest device is the one that has to clear the floor.
 */
export function clientDockItemHitArea(
  screenWidth: number,
  tabCount: number = CLIENT_TAB_COUNT,
): { width: number; height: number } {
  const rowWidth = screenWidth - CLIENT_DOCK.sideInset * 2 - CLIENT_DOCK.padding * 2;
  const itemWidth = rowWidth / tabCount;

  return {
    width: itemWidth + CLIENT_DOCK_ITEM_HIT_SLOP.left + CLIENT_DOCK_ITEM_HIT_SLOP.right,
    height:
      CLIENT_DOCK.itemHeight + CLIENT_DOCK_ITEM_HIT_SLOP.top + CLIENT_DOCK_ITEM_HIT_SLOP.bottom,
  };
}

import type { Insets } from 'react-native';

/**
 * The values one dock item is drawn from — the parameterised half of the
 * seam `DockItem` closes (UNFORGET S11).
 *
 * **There is deliberately no default and no shared record.** `DESIGN.md` §9
 * states the dock as RANGES (`left/right: 14–16px`, `icon 20–21px`) because
 * the coach and the client sit at the two ends of each: the coach bar is
 * read on a couch and carries five items, the client bar is read at arm's
 * length, one-handed, mid-set, and carries four. That divergence is
 * `CLAUDE.md` §1.1's two-context distinction expressed as geometry, and
 * `ui-conventions` §1 is explicit about the shape of the answer — "when a
 * component is shared, the density difference is a prop, never a forked
 * component."
 *
 * So: one item component, two records. `coach/coach-dock-metrics.ts` owns
 * `COACH_DOCK_ITEM`, `client/client-dock-geometry.ts` owns
 * `CLIENT_DOCK_ITEM`, each beside the rest of its own dock's numbers, and
 * `dock/__tests__/dock-item-geometry.test.ts` fails if the two are ever
 * collapsed toward each other.
 */
export interface DockItemGeometry {
  /**
   * §9's `Item 52px` — `tapTarget.MID_SET`. Applied as a FLOOR, never a
   * fixed height (`accessibility` §3): a fixed box clips the label at a
   * large OS text size instead of reporting a taller measurement.
   */
  readonly itemHeight: number;
  /** The gap between an item's glyph and its label. */
  readonly itemGap: number;
  /** §9's `icon 20–21px`. The two docks take opposite ends. */
  readonly iconSize: number;
  /** Lucide's own default is 2; both prototypes draw 1.9. */
  readonly iconStrokeWidth: number;
  /** Inside `DESIGN.md` §5's sanctioned `scale(.92–.98)` press range. */
  readonly pressScale: number;
  /**
   * `letter-spacing` under the label, in points at `micro`'s 11px. `0`
   * where the surface sets none — and `0` has to be said rather than
   * omitted, so that a dock which wants no tracking is making a choice
   * instead of inheriting one.
   */
  readonly labelTracking: number;
  /**
   * The cap on OS text scaling for the LABEL only (`accessibility` §3's
   * "cap that one size's scale factor; do not disable scaling"). Each dock
   * carries the arithmetic for its own number; the screen reader reads
   * `accessibilityLabel`, which no font scale truncates.
   */
  readonly labelMaxFontScale: number;
  /**
   * Symmetric tap overflow. Omitted by a dock whose items already tile
   * their row edge to edge, where slop would overlap a neighbour rather
   * than add reach.
   *
   * ⚠️ Every edge must stay INSIDE the dock's own bounds: `hitSlop` does
   * not survive a clipping parent, and `GlassSurface`'s fallback paths
   * render with `overflow: 'hidden'`.
   */
  readonly hitSlop?: Insets | undefined;
}

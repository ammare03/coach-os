import { CLIENT_DOCK_ITEM } from '../../client/client-dock-geometry.ts';
import { COACH_DOCK_ITEM } from '../../coach/coach-dock-metrics.ts';
import type { DockItemGeometry } from '../dock-item-geometry.ts';

// Read through the interface `DockItem` consumes rather than off the `as
// const` literal types, so that an optional a record OMITS is addressable
// here — which is the whole point of the hit-slop assertion below.
const COACH: DockItemGeometry = COACH_DOCK_ITEM;
const CLIENT: DockItemGeometry = CLIENT_DOCK_ITEM;

/**
 * `DockItem` is one component; the two docks are two geometry records, and
 * they must stay two.
 *
 * `DESIGN.md` §9 gives the dock RANGES (`left/right: 14–16px`,
 * `icon 20–21px`) precisely because the coach and the client sit at their
 * two ends — `CLAUDE.md` §1.1's information-density-versus-gym-floor
 * distinction, expressed as geometry. The extraction that produced
 * `DockItem` (UNFORGET S11) was approved on the explicit condition that the
 * records are NOT collapsed, so the condition is asserted here rather than
 * left to a comment.
 *
 * `client/__tests__/client-dock-geometry.test.ts` already guards the client
 * record's own values ("takes the client end of every range the coach dock
 * takes the other end of"). This file guards the pair, which is the thing
 * parameterising the item newly made possible to get wrong.
 */
describe('the coach and client dock item geometries', () => {
  it('are two records, not one shared object', () => {
    expect(COACH_DOCK_ITEM).not.toBe(CLIENT_DOCK_ITEM);
    expect(COACH_DOCK_ITEM).not.toEqual(CLIENT_DOCK_ITEM);
  });

  it('sit at the two ends of §9 icon range', () => {
    expect(COACH_DOCK_ITEM.iconSize).toBe(20);
    expect(CLIENT_DOCK_ITEM.iconSize).toBe(21);
    expect(CLIENT_DOCK_ITEM.iconSize).toBeGreaterThan(COACH_DOCK_ITEM.iconSize);
  });

  it('track the client label and leave the coach label untracked', () => {
    // The client dock's `letter-spacing: .01em` at micro's 11px. The coach
    // dock sets none, and a shared default would quietly give it some.
    expect(COACH_DOCK_ITEM.labelTracking).toBe(0);
    expect(CLIENT_DOCK_ITEM.labelTracking).toBeGreaterThan(0);
  });

  it('cap the two labels at different text scales', () => {
    // Five items in 64px versus four: the client bar has the room to let
    // its label grow further before the item stops fitting (`accessibility`
    // §3, and each dock file carries the arithmetic).
    expect(COACH_DOCK_ITEM.labelMaxFontScale).toBe(1.4);
    expect(CLIENT_DOCK_ITEM.labelMaxFontScale).toBe(1.6);
  });

  it('slop only the dock whose items do not already tile their row', () => {
    // The coach items are `flex: 1` inside the bar's own padding and meet
    // edge to edge; the client items are slopped out to the bar's full 64px
    // height and half its padding. Slop on the coach dock would overlap
    // neighbours rather than add reach.
    expect(COACH.hitSlop).toBeUndefined();
    expect(CLIENT.hitSlop).toEqual({ top: 6, bottom: 6, left: 3, right: 3 });
  });

  it('agree only where §9 gives one number rather than a range', () => {
    // The item box and the glyph-to-label gap are single values in §9, and
    // the press scale is the same prototype `scale(.94)` in both. Agreement
    // here is the design, not drift — it is asserted so that a later change
    // to one has to be a deliberate divergence.
    expect(COACH_DOCK_ITEM.itemHeight).toBe(CLIENT_DOCK_ITEM.itemHeight);
    expect(COACH_DOCK_ITEM.itemGap).toBe(CLIENT_DOCK_ITEM.itemGap);
    expect(COACH_DOCK_ITEM.pressScale).toBe(CLIENT_DOCK_ITEM.pressScale);
    expect(COACH_DOCK_ITEM.iconStrokeWidth).toBe(CLIENT_DOCK_ITEM.iconStrokeWidth);
  });
});

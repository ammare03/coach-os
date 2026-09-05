import {
  COACH_DOCK_BOTTOM_GAP,
  COACH_DOCK_CONTENT_GAP,
  COACH_DOCK_HEIGHT,
  coachTabBarInset,
  resolveCoachDockBottom,
} from '../coach-dock-metrics.ts';

describe('resolveCoachDockBottom', () => {
  it('sits at DESIGN.md §9 26px on a device with no bottom inset', () => {
    expect(resolveCoachDockBottom(0)).toBe(COACH_DOCK_BOTTOM_GAP);
  });

  it("lands on §9's 26px exactly for an iPhone home indicator", () => {
    // 34pt is the iOS bottom safe-area inset; §9's 26px already contains the
    // indicator band, which is what the 8px allowance subtracts.
    expect(resolveCoachDockBottom(34)).toBe(26);
  });

  it('lifts clear of a larger system bar rather than sitting under it', () => {
    // An Android three-button navigation bar. 26px would put the dock behind
    // it, so the safe area wins.
    expect(resolveCoachDockBottom(48)).toBe(40);
  });
});

describe('coachTabBarInset', () => {
  it("reserves the dock's own height plus its offset and a content gap", () => {
    expect(coachTabBarInset(34)).toBe(26 + COACH_DOCK_HEIGHT + COACH_DOCK_CONTENT_GAP);
  });

  it('always leaves more room than the dock physically occupies', () => {
    for (const safeAreaBottom of [0, 16, 24, 34, 48]) {
      expect(coachTabBarInset(safeAreaBottom)).toBeGreaterThan(
        resolveCoachDockBottom(safeAreaBottom) + COACH_DOCK_HEIGHT,
      );
    }
  });
});

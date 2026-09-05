import {
  CLIENT_DOCK,
  CLIENT_DOCK_ITEM_HIT_SLOP,
  CLIENT_TAB_COUNT,
  clientDockBottom,
  clientDockItemHitArea,
  clientTabBarInset,
} from '../client-dock-geometry.ts';

// `04-client-tabs.md`'s acceptance criteria are numbers, so they are asserted
// as numbers. Nothing here eyeballs a layout — every value below is either
// `DESIGN.md` §9's literal or arithmetic over it.
describe('the client dock geometry', () => {
  it('matches DESIGN.md §9 and CoachOS-Client.dc.html value for value', () => {
    expect(CLIENT_DOCK.sideInset).toBe(16);
    expect(CLIENT_DOCK.bottomInset).toBe(26);
    expect(CLIENT_DOCK.height).toBe(64);
    expect(CLIENT_DOCK.padding).toBe(6);
    expect(CLIENT_DOCK.itemHeight).toBe(52);
    expect(CLIENT_DOCK.itemGap).toBe(3);
    expect(CLIENT_DOCK.iconSize).toBe(21);
    expect(CLIENT_DOCK.pressScale).toBe(0.94);
  });

  it('takes the client end of every range the coach dock takes the other end of', () => {
    // §9's `left/right: 14–16px` and `icon 20–21px` are ranges because the
    // two apps sit at their two ends (`CLAUDE.md` §1.1). A regression here
    // is the exact failure `04-client-tabs.md`'s Risks section names:
    // shrinking this bar into a copy of the coach one.
    expect(CLIENT_DOCK.sideInset).toBeGreaterThan(14);
    expect(CLIENT_DOCK.padding).toBeGreaterThan(5);
    expect(CLIENT_DOCK.iconSize).toBeGreaterThan(20);
  });

  it('sizes nav items to the mid-set floor, not the ordinary one', () => {
    // §1.3: 44 everywhere, 52 for anything used with sweaty hands.
    expect(CLIENT_DOCK.itemHeight).toBe(52);
    expect(CLIENT_DOCK.itemHeight).toBeGreaterThan(44);
  });

  it('centres the 52px item inside the 64px bar', () => {
    expect(CLIENT_DOCK_ITEM_HIT_SLOP.top).toBe(6);
    expect(CLIENT_DOCK_ITEM_HIT_SLOP.bottom).toBe(6);
    expect(CLIENT_DOCK_ITEM_HIT_SLOP.top * 2 + CLIENT_DOCK.itemHeight).toBe(CLIENT_DOCK.height);
  });

  it('tiles the horizontal slop so adjacent items neither overlap nor leave a seam', () => {
    // Half the bar's own padding on each side: item i's right edge meets
    // item i+1's left edge exactly, and the outermost edges stop 3px short
    // of the bar rather than spilling past its clipping bounds.
    expect(CLIENT_DOCK_ITEM_HIT_SLOP.left).toBe(3);
    expect(CLIENT_DOCK_ITEM_HIT_SLOP.right).toBe(3);
    expect(CLIENT_DOCK_ITEM_HIT_SLOP.left + CLIENT_DOCK_ITEM_HIT_SLOP.right).toBe(
      CLIENT_DOCK.padding,
    );
  });
});

describe('clientDockItemHitArea', () => {
  // The device matrix that matters: the narrowest Android still shipping, the
  // modal iPhone, and the largest phone. The narrowest is the one that has to
  // clear the floor, so it is asserted first.
  const DEVICES = [
    { name: 'a 320pt small Android', width: 320 },
    { name: 'a 390pt iPhone', width: 390 },
    { name: 'a 430pt iPhone Pro Max', width: 430 },
  ] as const;

  it.each(DEVICES)('exceeds 48 x 48 with real margin on $name', ({ width }) => {
    const area = clientDockItemHitArea(width);

    expect(area.width).toBeGreaterThan(48);
    expect(area.height).toBeGreaterThan(48);
    // "With margin", quantified: at least a third again on both axes, so a
    // chalked, moving thumb has somewhere to land (`04-client-tabs.md`:
    // 48x48 is the floor here, not the ceiling).
    expect(area.width).toBeGreaterThanOrEqual(48 * 1.33);
    expect(area.height).toBeGreaterThanOrEqual(48 * 1.33);
  });

  it('computes the exact area, not an approximate one', () => {
    // 320 − 16 − 16 (side insets) − 6 − 6 (bar padding) = 276 across four
    // items = 69 each, + 3 + 3 of horizontal slop = 75.
    expect(clientDockItemHitArea(320)).toEqual({ width: 75, height: 64 });
    // 390 − 44 = 346 / 4 = 86.5, + 6 = 92.5.
    expect(clientDockItemHitArea(390)).toEqual({ width: 92.5, height: 64 });
  });

  it('gives a four-item client dock wider targets than a five-item coach one', () => {
    // Not a coach-dock assertion — a statement that the item count is what
    // drives width, and that this bar benefits from having one fewer.
    expect(clientDockItemHitArea(390, CLIENT_TAB_COUNT).width).toBeGreaterThan(
      clientDockItemHitArea(390, 5).width,
    );
  });
});

describe('clientDockBottom', () => {
  it('keeps DESIGN.md §9 26px where there is no home indicator', () => {
    expect(clientDockBottom(0)).toBe(26);
  });

  it('clears a home indicator rather than sitting under it', () => {
    expect(clientDockBottom(34)).toBe(34);
  });
});

describe('clientTabBarInset', () => {
  it('reserves the whole floating footprint, not just the bar height', () => {
    // 26 (float) + 64 (bar) + 12 (gap) — without every term the last row of
    // a list sits under the bar and cannot be tapped (`UI-UX.md` §UX1.2).
    expect(clientTabBarInset(0)).toBe(102);
  });

  it('grows with the safe area', () => {
    expect(clientTabBarInset(34)).toBe(110);
    expect(clientTabBarInset(34)).toBeGreaterThan(clientTabBarInset(0));
  });

  it('always clears the bar itself', () => {
    for (const safeAreaBottom of [0, 12, 21, 34, 48]) {
      expect(clientTabBarInset(safeAreaBottom)).toBeGreaterThan(
        clientDockBottom(safeAreaBottom) + CLIENT_DOCK.height,
      );
    }
  });
});

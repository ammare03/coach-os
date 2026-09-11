import {
  COMMIT_FRACTION,
  EDGE_RESISTANCE,
  FLING_VELOCITY,
  pageOffset,
  resistEdges,
  resolvePageIndex,
} from '../pager-gesture.ts';

// The pager's whole gesture arithmetic, as pure functions. They carry
// `'worklet'` so the pan handler can call them on the UI thread; they are
// ordinary functions here, which is what makes the rules testable without
// synthesising touches (`programs/drag-reorder.ts`, same arrangement).

/** One page plus its gap — the distance the track travels per page. */
const STRIDE = 341;

describe('pageOffset', () => {
  it('puts page 0 at rest and every later page a stride further left', () => {
    // `toBeCloseTo`, not `toBe`: `-0 * stride` is `-0`, which `Object.is`
    // separates from `0` and a transform does not.
    expect(pageOffset(0, STRIDE)).toBeCloseTo(0);
    expect(pageOffset(1, STRIDE)).toBe(-STRIDE);
    expect(pageOffset(3, STRIDE)).toBe(-3 * STRIDE);
  });
});

describe('resistEdges', () => {
  it('passes an in-range offset through untouched', () => {
    expect(resistEdges(-STRIDE, 6, STRIDE)).toBe(-STRIDE);
  });

  it('keeps a fraction of the travel past the first page', () => {
    expect(resistEdges(90, 6, STRIDE)).toBeCloseTo(90 / EDGE_RESISTANCE);
  });

  it('keeps a fraction of the travel past the last page', () => {
    const last = -(6 - 1) * STRIDE;

    expect(resistEdges(last - 90, 6, STRIDE)).toBeCloseTo(last - 90 / EDGE_RESISTANCE);
  });

  it('resists in both directions when there is only one page', () => {
    expect(resistEdges(60, 1, STRIDE)).toBeCloseTo(60 / EDGE_RESISTANCE);
    expect(resistEdges(-60, 1, STRIDE)).toBeCloseTo(-60 / EDGE_RESISTANCE);
  });
});

describe('resolvePageIndex', () => {
  const base = { index: 2, translationX: 0, velocityX: 0, stride: STRIDE, count: 6 };

  it('stays put when neither the travel nor the velocity commits', () => {
    expect(resolvePageIndex({ ...base, translationX: -40 })).toBe(2);
    expect(resolvePageIndex({ ...base, translationX: 40 })).toBe(2);
  });

  it('advances once the drag passes a quarter of a page', () => {
    expect(resolvePageIndex({ ...base, translationX: -(STRIDE * COMMIT_FRACTION) - 1 })).toBe(3);
  });

  it('goes back once the drag passes a quarter of a page the other way', () => {
    expect(resolvePageIndex({ ...base, translationX: STRIDE * COMMIT_FRACTION + 1 })).toBe(1);
  });

  it('lets a fling win over a drag too short to commit', () => {
    // A flick is the gym-floor gesture: short travel, high velocity.
    expect(resolvePageIndex({ ...base, translationX: -12, velocityX: -FLING_VELOCITY - 1 })).toBe(
      3,
    );
    expect(resolvePageIndex({ ...base, translationX: 12, velocityX: FLING_VELOCITY + 1 })).toBe(1);
  });

  it('lets the fling direction override a longer drag the other way', () => {
    // Drag left past the commit line, then flick back right before letting
    // go: the client changed their mind, and the last thing they did wins.
    expect(
      resolvePageIndex({ ...base, translationX: -STRIDE, velocityX: FLING_VELOCITY + 200 }),
    ).toBe(1);
  });

  it('never leaves the range at either edge', () => {
    expect(resolvePageIndex({ ...base, index: 0, translationX: STRIDE })).toBe(0);
    expect(resolvePageIndex({ ...base, index: 5, translationX: -STRIDE })).toBe(5);
  });

  it('stays at 0 when there is nothing to page', () => {
    expect(resolvePageIndex({ ...base, index: 0, count: 1, translationX: -STRIDE })).toBe(0);
    expect(resolvePageIndex({ ...base, index: 0, count: 0, translationX: -STRIDE })).toBe(0);
  });

  it('does not move a whole session on one very long drag', () => {
    // One gesture is one page, always. A pager that jumped four exercises
    // because a sleeve caught the screen is unrecoverable mid-set.
    expect(resolvePageIndex({ ...base, translationX: -STRIDE * 4 })).toBe(3);
  });
});

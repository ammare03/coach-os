// The pager's gesture arithmetic, as pure functions.
//
// Every one carries the `'worklet'` directive: they run on the UI thread,
// inside the pan handler, once per frame. They are ordinary functions
// everywhere else, which is what makes the rules unit-testable without
// synthesising touches — the same arrangement, and the same reason, as
// `programs/drag-reorder.ts`. A plain import called from a worklet would be
// hopped back to JS and undo the whole point.
//
// Nothing here reads a `SharedValue`, a theme, or a component: give it the
// numbers, get the answer.

/** The gap between two pages, in points. The track lays pages out with it; the stride adds it. */
export const PAGE_GAP = 11;

/**
 * How much of the NEXT page shows at rest — the swipe affordance.
 *
 * Leading-aligned, so the peek is on the right only: the current page sits
 * flush at x=0 and the previous one is fully off-screen behind it. It
 * disappears on the last page, which is how the end of the session
 * announces itself without a greyed-out arrow to look at. There is
 * deliberately no matching left peek — the rail above already shows what is
 * behind the client, and centring the pages to get one would cost the page
 * the width it needs for a set-entry surface.
 */
export const PAGE_PEEK = 12;

/** How far a drag must travel, as a fraction of one page, before release commits it. */
export const COMMIT_FRACTION = 0.25;

/** Points per second past which a flick commits regardless of how far it travelled. */
export const FLING_VELOCITY = 500;

/** Past the first or last page a drag keeps this fraction of the finger's travel. */
export const EDGE_RESISTANCE = 3;

/** The page's own width, given the space the track has and the peek it must leave. */
export function pageWidth(containerWidth: number): number {
  'worklet';
  return Math.max(containerWidth - PAGE_GAP - PAGE_PEEK, 0);
}

/** How far the track moves per page: the page itself plus the gap after it. */
export function pageStride(containerWidth: number): number {
  'worklet';
  return pageWidth(containerWidth) + PAGE_GAP;
}

/** Where the track sits at rest with `index` showing. */
export function pageOffset(index: number, stride: number): number {
  'worklet';
  return -index * stride;
}

/**
 * The track offset actually rendered, given the raw one the finger asks for.
 *
 * Past either end the drag keeps a third of its travel and springs back on
 * release. A hard wall reads as a dropped gesture; rubber-banding reads as
 * "there is nothing here", which is true.
 */
export function resistEdges(offset: number, count: number, stride: number): number {
  'worklet';
  const min = -Math.max(count - 1, 0) * stride;
  if (offset > 0) return offset / EDGE_RESISTANCE;
  if (offset < min) return min + (offset - min) / EDGE_RESISTANCE;
  return offset;
}

export interface ResolvePageIndexArgs {
  /** Where the pager was when the gesture began. */
  index: number;
  translationX: number;
  velocityX: number;
  stride: number;
  count: number;
}

/**
 * The page a released gesture lands on.
 *
 * **One gesture is one page, always** — never `round(translation / stride)`.
 * A sleeve catching the screen must not carry a client four exercises down
 * a session they cannot then find their way back through.
 *
 * Velocity is read before travel, so a client who drags left past the
 * commit line and then flicks back right before letting go gets what they
 * did last, not what they did first.
 */
export function resolvePageIndex({
  index,
  translationX,
  velocityX,
  stride,
  count,
}: ResolvePageIndexArgs): number {
  'worklet';
  const last = Math.max(count - 1, 0);
  const clamp = (next: number) => Math.min(Math.max(next, 0), last);

  if (velocityX <= -FLING_VELOCITY) return clamp(index + 1);
  if (velocityX >= FLING_VELOCITY) return clamp(index - 1);

  const commit = stride * COMMIT_FRACTION;
  if (translationX <= -commit) return clamp(index + 1);
  if (translationX >= commit) return clamp(index - 1);

  return clamp(index);
}

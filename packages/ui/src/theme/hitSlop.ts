/**
 * The symmetric `hitSlop` that centres a visible control of `size` inside a
 * tap target of at least `floor` (`tapTarget.MIN` or `tapTarget.MID_SET`,
 * `ui-conventions` §5 / `DESIGN.md` §13) — reached with `hitSlop`, never by
 * growing the visible box past the size its design specifies.
 *
 * Clamped to `0`: a control already at or past the floor (`IconButton`'s
 * `md`/`lg`) needs no extra tappable margin, and the unclamped formula would
 * go negative there.
 */
export function centeredHitSlop(size: number, floor: number): number {
  return Math.max(0, Math.ceil((floor - size) / 2));
}

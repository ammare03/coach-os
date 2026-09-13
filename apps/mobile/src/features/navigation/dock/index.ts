// The shared half of `DESIGN.md` §9's Dock — the item's composition and the
// selection pill's material, and nothing else. The geometry each dock draws
// with stays in that dock's own folder (UNFORGET S11).
export { DockItem, type DockItemProps } from './DockItem.tsx';
export type { DockItemGeometry } from './dock-item-geometry.ts';
export { DockSelectionPill, type DockSelectionPillProps } from './DockSelectionPill.tsx';

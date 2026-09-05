import { ClipboardList, Ellipsis, House, Inbox, Users, type LucideIcon } from 'lucide-react-native';

/**
 * The five coach tabs, in the order `DESIGN.md` §9 and
 * `CoachOS-Coach.dc.html`'s own `tabs` array put them — Home · Clients ·
 * Programs · Inbox · More.
 *
 * `CoachTabBar` renders from THIS array and looks each route up by name,
 * rather than rendering `state.routes` in whatever order expo-router
 * resolved them from the file system (which is alphabetical:
 * clients, index, inbox, more, programs). Order is a design decision and
 * belongs here, not in a directory listing.
 *
 * Icons are Lucide (`CLAUDE.md` §3.1 — SF Symbols are iOS-only and
 * forbidden). Each is the Lucide member whose silhouette matches the
 * prototype's hand-written SVG path; the mapping is recorded per entry so a
 * later reviewer can check it against the prototype rather than trusting it.
 */
export type CoachTabRouteName = 'index' | 'clients' | 'programs' | 'inbox' | 'more';

export interface CoachTabDescriptor {
  /** The expo-router route name inside `(coach)/(tabs)/`. */
  readonly name: CoachTabRouteName;
  /** §9's label. An icon never travels alone in navigation (`DESIGN.md` §13). */
  readonly label: string;
  readonly Icon: LucideIcon;
}

export const COACH_TABS: readonly CoachTabDescriptor[] = [
  // Prototype `M4 11l8-6 8 6v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z` — a roof over
  // a body, no door. Lucide's `House` is the same silhouette (it adds the
  // door, which the prototype's own 20px rendering barely resolves anyway).
  { name: 'index', label: 'Home', Icon: House },
  // Prototype `M3 20a5 5 0 0 1 10 0 · M8 4a4 4 0 1 1 0 8 … · M16 13a4 4 0 0 1 5 7`
  // — one whole person plus a second, partial one behind. That composition is
  // exactly Lucide's `Users`.
  { name: 'clients', label: 'Clients', Icon: Users },
  // Prototype `M5 4h14v16H5z · M9 9h6 · M9 13h6` — an upright sheet with two
  // ruled lines. Lucide's `ClipboardList` is the closest member and the right
  // one semantically: a program is a written plan. `NotebookText` matches the
  // bare rectangle marginally better but adds a spine and a third line.
  { name: 'programs', label: 'Programs', Icon: ClipboardList },
  // Prototype `M4 5h16v14H4z · M4 11h5l1 2h4l1-2h5` — a tray with the notch
  // cut across its middle. Lucide's `Inbox` is the same drawing.
  { name: 'inbox', label: 'Inbox', Icon: Inbox },
  // Prototype `M6 12h.01 M12 12h.01 M18 12h.01` with a round cap — three
  // dots. Lucide's `Ellipsis` draws the same three dots as r=1 circles.
  { name: 'more', label: 'More', Icon: Ellipsis },
];

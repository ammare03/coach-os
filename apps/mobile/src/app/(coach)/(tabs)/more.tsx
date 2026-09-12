import { MoreHub } from '../../../features/navigation/coach/MoreHub.tsx';

// Composition only (`code-conventions` §1). The P05 placeholder is gone:
// `MoreHub` owns the row map, the density and the dock inset, and every
// later phase that adds a hub row edits that one array — never this file
// (`settings-shell/02`).
export default function CoachMoreScreen() {
  return <MoreHub />;
}

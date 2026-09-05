import { CoachTabPlaceholder } from '../../../features/navigation/coach/CoachTabPlaceholder.tsx';

// Composition only (`CLAUDE.md` §9.2). A genuine placeholder — the phase
// named below designs and builds this screen, and anything added here first
// would have to be deleted then (`router-skeleton/03`, Risks).
export default function CoachHomeScreen() {
  return (
    <CoachTabPlaceholder
      route="(coach)/(tabs)/index"
      ownedBy="phase-10-coach-review-surfaces/coach-dashboard/"
    />
  );
}

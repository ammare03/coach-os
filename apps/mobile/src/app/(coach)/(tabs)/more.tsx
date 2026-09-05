import { CoachTabPlaceholder } from '../../../features/navigation/coach/CoachTabPlaceholder.tsx';

// Composition only (`CLAUDE.md` §9.2). A genuine placeholder — the phase
// named below designs and builds this screen, and anything added here first
// would have to be deleted then (`router-skeleton/03`, Risks).
export default function CoachMoreScreen() {
  return (
    <CoachTabPlaceholder
      route="(coach)/(tabs)/more"
      ownedBy="phase-25-white-label-and-teams/ and each setting's own phase"
    />
  );
}

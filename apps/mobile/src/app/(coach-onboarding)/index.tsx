import { CoachOnboardingFlow } from '../../features/onboarding/screens/CoachOnboardingFlow.tsx';

// The coach onboarding flow's only route (`phase-06-onboarding/
// coach-onboarding/01`). Composition only — the step sequence, its
// persisted position, and every field live in the feature slice
// (`code-conventions` §1).
//
// The route GROUP is a deliberate, documented extension to `CLAUDE.md`
// §9.1's tree, which predates P06 and lists no onboarding flow at all;
// `AuthGate`'s own header and `onboarding-infrastructure/02` record the
// same decision, and `__tests__/route-tree.test.tsx` carries it as an
// expected entry rather than a drift.
export default function CoachOnboardingScreen() {
  return <CoachOnboardingFlow />;
}

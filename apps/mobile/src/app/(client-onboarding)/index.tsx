import { ClientOnboardingFlow } from '../../features/onboarding/screens/ClientOnboardingFlow.tsx';

// Composition, and nothing else (`CLAUDE.md` §9.2). The whole five-step
// flow is this one route — `ClientOnboardingFlow`'s own header says why.
export default function ClientOnboardingScreen() {
  return <ClientOnboardingFlow />;
}

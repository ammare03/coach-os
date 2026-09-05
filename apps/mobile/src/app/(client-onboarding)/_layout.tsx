import { Stack } from 'expo-router';

import { AuthGate } from '../../features/auth/AuthGate.tsx';

// The client onboarding flow's route group — the `(coach-onboarding)`
// sibling, and everything that layout's comment says applies here
// unchanged (`phase-06-onboarding/onboarding-infrastructure/02`).
export default function ClientOnboardingLayout() {
  return (
    <AuthGate group="(client-onboarding)">
      <Stack screenOptions={{ headerShown: false }} />
    </AuthGate>
  );
}

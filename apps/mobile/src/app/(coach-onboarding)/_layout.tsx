import { Stack } from 'expo-router';

import { AuthGate } from '../../features/auth/AuthGate.tsx';

// The coach onboarding flow's route group
// (`phase-06-onboarding/onboarding-infrastructure/02`). A deliberate,
// documented extension to §9.1's tree, not an oversight in it —
// `coach-onboarding/01` Approach step 1 records the same decision, and this
// task builds the group early because the gate has to have somewhere to
// send a coach who has not finished setup.
//
// No `(tabs)` navigator: a flow shell is not a dock, so this group's root
// is its own `index` (`AuthGate`'s `GROUP_ROOT`).
//
// `AuthGate` here does both halves of the third dimension — it keeps a
// signed-out visitor and a client out, exactly as the other groups' gates
// do, and it turns an already-onboarded coach around rather than letting
// them re-enter a flow they have finished.
export default function CoachOnboardingLayout() {
  return (
    <AuthGate group="(coach-onboarding)">
      <Stack screenOptions={{ headerShown: false }} />
    </AuthGate>
  );
}

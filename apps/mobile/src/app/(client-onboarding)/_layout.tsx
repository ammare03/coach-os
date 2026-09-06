import { Stack } from 'expo-router';

import { AuthGate } from '../../features/auth/AuthGate.tsx';

// The client onboarding flow's route group — the `(coach-onboarding)`
// sibling, and everything that layout's comment says applies here
// unchanged (`phase-06-onboarding/onboarding-infrastructure/02`).
//
// `FOCUS_MODE` is `(client)/_layout.tsx`'s own constant, restated rather
// than imported so this group's one non-default presentation is visible
// where it is declared. It is the same arm of that file's three-way
// convention: `fullScreenModal` with `gestureEnabled: false`, for a screen
// there is nowhere to dismiss *to*. Swipe-to-dismiss on a stack with
// nothing behind it produces a blank screen or a bounce back and reads as a
// crash — which on the consent-pending screen would be the second thing to
// go wrong for a fifteen-year-old in the same minute
// (`guardian-consent/06`).
const FOCUS_MODE = {
  presentation: 'fullScreenModal',
  gestureEnabled: false,
} as const;

export default function ClientOnboardingLayout() {
  return (
    <AuthGate group="(client-onboarding)">
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="guardian-consent-pending" options={FOCUS_MODE} />
      </Stack>
    </AuthGate>
  );
}

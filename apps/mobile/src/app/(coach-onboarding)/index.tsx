import { Text, View } from 'react-native';

// Placeholder route, in the shape `phase-05-app-shell/router-skeleton/01`
// established: structure only — it renders its own route path and nothing
// else, deliberately. `phase-06-onboarding/coach-onboarding/01` designs and
// builds the real flow shell here, behind the `design-gate`; anything added
// first would have to be deleted then.
//
// It exists now because `onboarding-infrastructure/02`'s gate needs a real
// destination to redirect a non-onboarded coach to — a redirect to a route
// that does not exist lands on `+not-found`.
export default function CoachOnboardingScreen() {
  return (
    <View>
      <Text>(coach-onboarding)/index</Text>
    </View>
  );
}

import { Stack } from 'expo-router';

import { AuthGate } from '../../features/auth/AuthGate.tsx';

// The `(auth)` group: a Stack, never tabs — nothing in here is a peer
// destination you switch between, it is one linear flow plus two deep-link
// entry points (`UI-UX.md` §UX1.1, §UX1.4).
//
// `headerShown: false` is deliberate and applies to every screen: each one
// draws its own Liquid Glass nav bar via `AuthScreenShell` (DS§12.1)
// rather than the native header, and a screen that is pushed carries its
// own back control inside that bar.
//
// `AuthGate` (`providers-and-gates/03`) sends an already-signed-in user to
// their own group instead of rendering any of this — the same guard the two
// authenticated groups carry, pointing the other way. It wraps the group's
// own `Stack`; see `(coach)/_layout.tsx` for why it is here rather than once
// at the root.
export default function AuthLayout() {
  return (
    <AuthGate group="(auth)">
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="welcome" />
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="sign-up" />
        <Stack.Screen name="complete-social-signup" />
        <Stack.Screen name="forgot-password" />
        {/* Both deep-link targets. `reset-password/[token]` is the https
            universal link `auth-server/06` emails out (`UI-UX.md` §UX1.4);
            it stays a placeholder — filling it in is not this task's. */}
        <Stack.Screen name="reset-password/[token]" />
        <Stack.Screen name="invite/[code]" />
      </Stack>
    </AuthGate>
  );
}

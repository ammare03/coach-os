import { Stack, useSegments } from 'expo-router';

import { AuthGate } from '../../features/auth/AuthGate.tsx';

// `client-onboarding/01` — the one route in this group an authenticated
// session may stay on. Matched on the segment, not on a prefix and not on
// "any `(auth)` route with a param": `reset-password/[token]` has exactly
// that shape and must keep redirecting.
const INVITE_SEGMENT = 'invite';

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
  // The gate is a pure function of its arguments (`AuthGate.tsx`), so the
  // route read happens here, where a hook is legal, rather than inside it.
  const segments = useSegments();
  const onInviteRoute = segments[0] === '(auth)' && segments[1] === INVITE_SEGMENT;

  return (
    <AuthGate group="(auth)" exempt={onInviteRoute}>
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

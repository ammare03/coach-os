import { Stack } from 'expo-router';

import { AuthGate } from '../../features/auth/AuthGate.tsx';

/**
 * `UI-UX.md` §UX1.1's focus mode, expressed in navigator options.
 *
 * `fullScreenModal` rather than the default card push: a focus mode is entered
 * for an extended, attention-demanding activity and must cover the tabs
 * completely. It is also the presentation that contrasts with
 * `navigation-primitives/04`'s `presentation: 'modal'` for short dismissible
 * tasks — the two together are that task's three-way convention.
 *
 * `gestureEnabled: false` because Pattern C gives a focus mode exactly one
 * exit. An edge swipe out of an active set or a live call is an accident, not
 * an intention; the screen's own close control is the way out, and P09/P16/P19
 * draw it.
 */
const FOCUS_MODE = {
  presentation: 'fullScreenModal',
  gestureEnabled: false,
} as const;

// The (coach) group is a stack and the tab navigator is one screen in it, so
// every route that is not under `(tabs)/` renders with no dock — structural,
// not a per-screen option (`CLAUDE.md` §9.2, `DESIGN.md` §10.7).
// `navigation-primitives/01` exists to prove that holds rather than assume it.
//
// `headerShown: false` applies to every screen here and is NOT inherited from
// the root `Stack`: a nested navigator resolves its own `screenOptions`.
// Every coach route draws its own chrome (`DESIGN.md` §9).
//
// `AuthGate` (`providers-and-gates/03`) decides whether this group is
// reachable at all. It wraps the group's own `Stack` rather than sitting once
// at the root, so that a redirect swaps out only this navigator and leaves
// the root one — and every provider above it — mounted; see the gate's own
// comment for what happens otherwise.
export default function CoachLayout() {
  return (
    <AuthGate group="(coach)">
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        {/* The three coach focus modes. Everything else in the group — client
            detail, program editor, check-in review — is an ordinary push and
            is left to expo-router's own registration. */}
        <Stack.Screen name="session/[id]" options={FOCUS_MODE} />
        <Stack.Screen name="video/[id]" options={FOCUS_MODE} />
        <Stack.Screen name="live/[sessionId]" options={FOCUS_MODE} />
      </Stack>
    </AuthGate>
  );
}

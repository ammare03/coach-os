import { Stack } from 'expo-router';

import { AuthGate } from '../../features/auth/AuthGate.tsx';

/** The (coach) counterpart's `FOCUS_MODE`, and the same reasoning. */
const FOCUS_MODE = {
  presentation: 'fullScreenModal',
  gestureEnabled: false,
} as const;

/**
 * `UI-UX.md` §UX1's modal layer — `navigation-primitives/04`.
 *
 * A short, self-contained task the user expects to dismiss back to where they
 * were. `presentation: 'modal'` gives the card the slide-up and the inset that
 * keep the originating screen visible behind it, which is what tells the user
 * this is a detour rather than a destination.
 *
 * `gestureEnabled: true` is the native default for a modal and is stated
 * anyway, because it is the half of the convention that carries meaning:
 * swipe-to-dismiss is exactly what `FOCUS_MODE` above refuses. The two
 * constants side by side are the three-way convention — the third arm is
 * every other route in this group, which declares nothing and gets an
 * ordinary push.
 *
 * §UX1.3 still applies to whoever fills these screens in: a dismissal must
 * discard safely or keep a draft. Presentation does not excuse losing work.
 */
const MODAL = {
  presentation: 'modal',
  gestureEnabled: true,
} as const;

// The (client) counterpart to (coach)/_layout.tsx: a stack whose first screen
// is the tab navigator, so the focus modes — the workout logger and the live
// call — are siblings of `(tabs)` and render with no dock (`CLAUDE.md` §9.2,
// `UI-UX.md` §UX1.1). `headerShown: false` and `AuthGate`: see (coach).
//
// `log-food`, `scan` and `record-form-check` are the group's modals, not
// focus modes — §9.1 marks them so. They are declared here rather than in
// their own route files so that all three presentations are visible in one
// place and cannot drift apart screen by screen.
export default function ClientLayout() {
  return (
    <AuthGate group="(client)">
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="workout/[sessionId]" options={FOCUS_MODE} />
        <Stack.Screen name="live/[sessionId]" options={FOCUS_MODE} />
        <Stack.Screen name="log-food" options={MODAL} />
        <Stack.Screen name="scan" options={MODAL} />
        <Stack.Screen name="record-form-check" options={MODAL} />
        {/* Not a focus mode: the post-session summary is read afterwards, so
            it is an ordinary push with a working back. */}
        <Stack.Screen name="workout/[sessionId]/summary" />
      </Stack>
    </AuthGate>
  );
}

import { Stack } from 'expo-router';

import { AuthGate } from '../../features/auth/AuthGate.tsx';

/** The (coach) counterpart's `FOCUS_MODE`, and the same reasoning. */
const FOCUS_MODE = {
  presentation: 'fullScreenModal',
  gestureEnabled: false,
} as const;

// The (client) counterpart to (coach)/_layout.tsx: a stack whose first screen
// is the tab navigator, so the focus modes — the workout logger and the live
// call — are siblings of `(tabs)` and render with no dock (`CLAUDE.md` §9.2,
// `UI-UX.md` §UX1.1). `headerShown: false` and `AuthGate`: see (coach).
//
// `log-food`, `scan` and `record-form-check` are deliberately absent.
// §9.1 marks them modals, and `navigation-primitives/04` gives them
// `presentation: 'modal'` — a short dismissible task, not a focus mode.
export default function ClientLayout() {
  return (
    <AuthGate group="(client)">
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="workout/[sessionId]" options={FOCUS_MODE} />
        <Stack.Screen name="live/[sessionId]" options={FOCUS_MODE} />
        {/* Not a focus mode: the post-session summary is read afterwards, so
            it is an ordinary push with a working back. */}
        <Stack.Screen name="workout/[sessionId]/summary" />
      </Stack>
    </AuthGate>
  );
}

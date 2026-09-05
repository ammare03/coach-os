import { Stack } from 'expo-router';

import { AuthGate } from '../../features/auth/AuthGate.tsx';

// Bare passthrough (`phase-05-app-shell/router-skeleton/01`). The (coach)
// group is a stack: the tab navigator is one screen in it, and every
// fullscreen mode in CLAUDE.md §9.1 — session, video, checkin, program day,
// live — is pushed on top of the tabs rather than nested inside them.
//
// `AuthGate` (`providers-and-gates/03`) decides whether this group is
// reachable at all. It wraps the group's own `Stack` rather than sitting once
// at the root, so that a redirect swaps out only this navigator and leaves
// the root one — and every provider above it — mounted; see the gate's own
// comment for what happens otherwise.
export default function CoachLayout() {
  return (
    <AuthGate group="(coach)">
      <Stack />
    </AuthGate>
  );
}

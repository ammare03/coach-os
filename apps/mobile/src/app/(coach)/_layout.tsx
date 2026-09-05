import { Stack } from 'expo-router';

// Bare passthrough (`phase-05-app-shell/router-skeleton/01`). The (coach)
// group is a stack: the tab navigator is one screen in it, and every
// fullscreen mode in CLAUDE.md §9.1 — session, video, checkin, program day,
// live — is pushed on top of the tabs rather than nested inside them.
//
// `providers-and-gates/03` adds the role gate that decides whether this
// group is reachable at all; task 03 in this feature configures the tabs.
export default function CoachLayout() {
  return <Stack />;
}

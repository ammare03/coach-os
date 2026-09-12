import { SettingsScreen } from '../../../features/settings/screens/SettingsScreen.tsx';

// Composition only. The P05 placeholder — its own route path plus a bare
// disclaimer link — is gone; `SettingsScreen` is one component for both
// roles and presents the disclaimer as a list row, which is what
// `phase-06-onboarding/onboarding-infrastructure/03`'s artboard asked for
// and what `CLAUDE.md` §21.3 actually requires.
export default function CoachSettingsScreen() {
  return <SettingsScreen />;
}

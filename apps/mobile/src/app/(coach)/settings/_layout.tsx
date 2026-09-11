import { SettingsStack } from '../../../features/settings/navigation/SettingsStack.tsx';

// Composition only (`code-conventions` §1). The stack's options — header,
// tint, title, and the reason it is opaque rather than glass — live in the
// feature so the client group's identical layout cannot drift from it.
export default function CoachSettingsLayout() {
  return <SettingsStack />;
}

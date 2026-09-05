import { Link } from 'expo-router';
import { Text, View } from 'react-native';

// Placeholder route (`phase-05-app-shell/router-skeleton/01`). Structure
// only — it renders its own route path and nothing else, deliberately. The
// phase that owns this screen designs and builds it; anything added here
// first would have to be deleted then (P05 README, "Risks").
//
// The one exception, and it is not a design decision: `CLAUDE.md` §21.3
// requires the medical disclaimer to be reachable from settings, and
// `phase-06-onboarding/onboarding-infrastructure/03` builds it. This link
// is the whole of that requirement on this screen — the real settings
// screen will present it as a list row (that task's artboard, `4e`).
export default function CoachSettingsScreen() {
  return (
    <View>
      <Text>(coach)/settings/index</Text>
      <Link href="/medical-disclaimer" accessibilityRole="link">
        Medical disclaimer
      </Link>
    </View>
  );
}

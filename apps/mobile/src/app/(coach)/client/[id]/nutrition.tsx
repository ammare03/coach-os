import { useLocalSearchParams } from 'expo-router';

import { ClientNutritionScreen } from '../../../../features/clients/screens/ClientNutritionScreen.tsx';

// Composition only (`CLAUDE.md` §9.2) — the screen owns its cache key and
// its one state; this file owns the route param
// (`phase-10-coach-review-surfaces/client-detail/03`).
//
// No `onBack`, unlike the Overview route: this tab has no state that needs a
// way out. The back control and the facet bar are the shell's, in
// `_layout.tsx`.
export default function CoachClientNutritionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return <ClientNutritionScreen clientId={id} />;
}

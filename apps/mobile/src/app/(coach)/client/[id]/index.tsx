import { useLocalSearchParams, useRouter } from 'expo-router';

import { ClientOverviewScreen } from '../../../../features/clients/screens/ClientOverviewScreen.tsx';

// Composition only (`CLAUDE.md` §9.2) — the screen owns its query and its
// states; this file owns the route param and where "back" leads
// (`phase-10-coach-review-surfaces/client-detail/01`).
export default function CoachClientOverviewScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <ClientOverviewScreen
      clientId={id}
      onBack={() => {
        router.dismissTo('/(coach)/(tabs)');
      }}
    />
  );
}

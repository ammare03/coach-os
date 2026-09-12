import { useLocalSearchParams, useRouter } from 'expo-router';

import { ClientNotesScreen } from '../../../../features/clients/screens/ClientNotesScreen.tsx';

// Composition only (`CLAUDE.md` §9.2) — the screen owns its query, its four
// states, and every note mutation; this file owns the route param and where
// the one way out leads
// (`phase-10-coach-review-surfaces/coach-notes/02`).
export default function CoachClientNotesScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <ClientNotesScreen
      clientId={id}
      onBack={() => {
        // `dismissTo`, not `back`: a coach arriving from a push
        // notification has no roster behind them to pop to.
        router.dismissTo('/(coach)/(tabs)');
      }}
    />
  );
}

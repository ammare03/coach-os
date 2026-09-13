import { useLocalSearchParams, useRouter } from 'expo-router';

import { ClientOverviewScreen } from '../../../../features/clients/screens/ClientOverviewScreen.tsx';

// Composition only (`CLAUDE.md` §9.2) — the screen owns its query and its
// states; this file owns the route param and where "back" leads
// (`phase-10-coach-review-surfaces/client-detail/01`).
export default function CoachClientOverviewScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  // Both lead to the roster, and they are deliberately two props rather
  // than one: "go back" is the coach choosing to leave, and "released" is
  // this client's screen ceasing to have anything to show. If the roster
  // ever stops being the right landing for one of them, only that one
  // moves (`relationship-controls/01`).
  const toRoster = () => {
    router.dismissTo('/(coach)/(tabs)');
  };

  return <ClientOverviewScreen clientId={id} onBack={toRoster} onReleased={toRoster} />;
}

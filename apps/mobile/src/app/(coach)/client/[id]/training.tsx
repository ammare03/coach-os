import { useLocalSearchParams, useRouter } from 'expo-router';

import { ClientTrainingScreen } from '../../../../features/clients/screens/ClientTrainingScreen.tsx';

// Composition only (`CLAUDE.md` §9.2) — the screen owns its query and its
// states; this file owns the route param and where each way out leads
// (`phase-10-coach-review-surfaces/client-detail/02`).
export default function CoachClientTrainingScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <ClientTrainingScreen
      clientId={id}
      onOpenSession={(sessionId) => {
        // `session-review/01`'s screen. The route exists today as a
        // `phase-05-app-shell` placeholder; that feature fills it in, and
        // nothing here changes when it does.
        router.push({ pathname: '/(coach)/session/[id]', params: { id: sessionId } });
      }}
      onOpenOverview={() => {
        // A sibling facet, so `navigate` rather than `push` — pushing would
        // stack a second copy of the tab shell behind the one already open.
        router.navigate({ pathname: '/(coach)/client/[id]', params: { id } });
      }}
      onBack={() => {
        // `dismissTo`, not `back`: a coach arriving from a push
        // notification has no roster behind them to pop to.
        router.dismissTo('/(coach)/(tabs)');
      }}
    />
  );
}

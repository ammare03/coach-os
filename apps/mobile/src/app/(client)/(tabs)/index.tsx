import { useRouter } from 'expo-router';

import { TodayScreen } from '../../../features/workouts/components/TodayScreen.tsx';

// Composition only (`CLAUDE.md` §9.2, `code-conventions` §1) — the screen
// owns its queries, its states and its copy; this file owns where a tap
// goes and nothing else.
//
// One prop is deliberately not passed. `onPrefetchSession` is the press-in
// seam `UI-UX.md` §UX3.3 asks for, and `session-runtime` is what will have a
// query to warm — wiring a handler that does nothing would only hide that it
// is still missing.
//
// The ad-hoc start (`today-card/04`) takes no prop here: it needs the zone
// `useTodaySession` resolves, and it opens the logger through the same
// `onOpenSession` an assigned session does, so `TodayScreen` composes it.
export default function ClientTodayScreen() {
  const router = useRouter();

  return (
    <TodayScreen
      onOpenSession={(sessionId) => {
        router.push({ pathname: '/(client)/workout/[sessionId]', params: { sessionId } });
      }}
      onViewSummary={(sessionId) => {
        router.push({ pathname: '/(client)/workout/[sessionId]/summary', params: { sessionId } });
      }}
      onOpenSettings={() => {
        router.push('/(client)/settings');
      }}
    />
  );
}

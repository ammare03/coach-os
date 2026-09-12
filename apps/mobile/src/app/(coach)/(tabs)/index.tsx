import { useRouter } from 'expo-router';

import { CoachDashboardScreen } from '../../../features/clients/screens/CoachDashboardScreen.tsx';

// Composition only (`CLAUDE.md` §9.2) — the screen owns its query and its
// four states; this file owns where a tap goes
// (`phase-10-coach-review-surfaces/coach-dashboard/01`).
export default function CoachHomeScreen() {
  const router = useRouter();

  return (
    <CoachDashboardScreen
      onOpenClient={(clientId) => {
        router.push({ pathname: '/(coach)/client/[id]', params: { id: clientId } });
      }}
      onInviteClient={() => {
        router.push('/(coach)/invite-client');
      }}
    />
  );
}

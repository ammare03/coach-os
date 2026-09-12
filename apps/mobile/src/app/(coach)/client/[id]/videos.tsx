import { useLocalSearchParams } from 'expo-router';

import { ClientVideosScreen } from '../../../../features/clients/screens/ClientVideosScreen.tsx';

// Composition only (`CLAUDE.md` §9.2) — the screen owns its states and its
// cache key; this file owns the route param
// (`phase-10-coach-review-surfaces/client-detail/04`).
//
// No `onBack`, unlike the Overview route: this facet has no state that can
// fail, so it needs no recovery action that leads off the screen. The back
// control is `_layout.tsx`'s and survives whatever happens here.
export default function CoachClientVideosScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return <ClientVideosScreen clientId={id} />;
}

import { useLocalSearchParams } from 'expo-router';

import { InviteArrival } from '../../../features/auth/screens/InviteArrival.tsx';

// Param extraction and composition, and nothing else (`CLAUDE.md` §9.2).
// Which of `client-onboarding/01`'s four arrival cases applies, and what
// each one calls, is `InviteArrival`'s — a route file is not where a
// four-way branch and three mutations belong (`code-conventions`).
//
// This route is the ONE exemption in `AuthGate` (`(auth)/_layout.tsx`): an
// already-signed-in caller renders it rather than being bounced to their
// own group root, which is what made an invite link do nothing at all for
// anyone with a session.
export default function InviteRoute() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return <InviteArrival code={code ?? ''} />;
}

import { useLocalSearchParams, useRouter } from 'expo-router';

import { InviteScreen } from '../../../features/auth/screens/InviteScreen.tsx';

// Param extraction and composition, and nothing else (`CLAUDE.md` §9.2).
// Redeeming the code is `phase-06-onboarding/client-onboarding/01`'s —
// this task's own Risks section says the route is expected to be
// incomplete until then.
export default function InviteRoute() {
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code: string }>();
  return <InviteScreen code={code ?? ''} onSignIn={() => router.replace('/sign-in')} />;
}

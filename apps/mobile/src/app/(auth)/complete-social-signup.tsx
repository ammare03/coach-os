import { useLocalSearchParams } from 'expo-router';

import { CompleteSocialSignUpScreen } from '../../features/auth/screens/CompleteSocialSignUpScreen.tsx';

// Param extraction and composition, and nothing else (`CLAUDE.md` §9.2) —
// the same shape `invite/[code].tsx` uses. The 91 lines of auth chrome this
// file used to carry inline are `AuthScreenShell`'s, and the screen content
// is `CompleteSocialSignUpScreen`'s.
export default function CompleteSocialSignUpRoute() {
  const { pendingSignupToken, email } = useLocalSearchParams<{
    pendingSignupToken: string;
    email: string;
  }>();

  return (
    <CompleteSocialSignUpScreen pendingSignupToken={pendingSignupToken ?? ''} email={email ?? ''} />
  );
}

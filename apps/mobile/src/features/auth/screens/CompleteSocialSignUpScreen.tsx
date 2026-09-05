import { AuthScreenShell } from '../components/AuthScreenShell.tsx';
import { CompleteSocialSignUpForm } from '../components/CompleteSocialSignUpForm.tsx';

// The date-of-birth gate a social sign-in lands on when the identity is new
// (`social-sign-in/03`). Unchanged in structure from the version that
// shipped in `src/app/(auth)/complete-social-signup.tsx`; it moved here for
// the same `CLAUDE.md` §9.2 reason as `SignInScreen` and `SignUpScreen`,
// and the chrome it used to draw inline — a byte-for-byte copy of
// sign-in's — is now `AuthScreenShell`.
//
// No `onBack`: this screen is pushed, but going back would strand a
// half-created identity with a pending signup token and no way to finish
// it. "Wrong account? Sign in again" inside the form is the sanctioned way
// out, and that is unchanged.
export interface CompleteSocialSignUpScreenProps {
  pendingSignupToken: string;
  email: string;
}

export function CompleteSocialSignUpScreen({
  pendingSignupToken,
  email,
}: CompleteSocialSignUpScreenProps) {
  return (
    <AuthScreenShell>
      <CompleteSocialSignUpForm pendingSignupToken={pendingSignupToken} email={email} />
    </AuthScreenShell>
  );
}

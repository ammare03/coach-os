import { AuthScreenShell } from '../components/AuthScreenShell.tsx';
import { RequestPasswordResetForm } from '../components/RequestPasswordResetForm.tsx';

// ⚠️ DERIVED, NOT DRAWN — same standing decision as `WelcomeScreen`:
// `forgot-password` is not in `DESIGN.md` §11's thirteen-screen inventory
// and appears in no prototype, the design gate was raised with Ammar this
// session, and his decision was to build to the existing system rather
// than wait for a `/design` pass.
//
// Derivation, all of it from surfaces already approved:
//   · chrome                  → `AuthScreenShell`, unmodified
//   · a back control          → `UI-UX.md` §UX1.3 ("Back, always"); this
//     is the first screen in the group that is pushed rather than entered,
//     and the group's `Stack` runs `headerShown: false`
//   · heading 24/700          → identical to `SignInScreen`'s "Sign in",
//     because this screen sits at the same level of the same flow
//   · one field, one action   → `UI-UX.md` §UX2 Pattern E, "one decision
//     per screen"; there is exactly one question to ask
//   · a full-screen success   → the request has no result to show. Swapping
//     the form for the confirmation is what makes it unmistakable that
//     nothing more is expected here.
export interface ForgotPasswordScreenProps {
  onBack: () => void;
}

export function ForgotPasswordScreen({ onBack }: ForgotPasswordScreenProps) {
  return (
    <AuthScreenShell onBack={onBack}>
      <RequestPasswordResetForm onDone={onBack} />
    </AuthScreenShell>
  );
}

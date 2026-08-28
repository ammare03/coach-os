import { auth as authSchemas } from '@coachos/schemas';

import { api } from '../../../lib/trpc.ts';
import { mapAuthError, type AuthFormError } from '../auth-form-error.ts';
import { parseDateOfBirthInput } from '../date-of-birth.ts';
import { buildDeviceFields } from '../device.ts';
import { commitOpenedSession } from '../session-result.ts';

export interface CompleteSocialSignUpValues {
  pendingSignupToken: string;
  /** As typed — "DD/MM/YYYY", same shape `useSignUp` converts before validation. */
  dateOfBirth: string;
}

export type CompleteSocialSignUpResult = { ok: true } | { ok: false; error: AuthFormError };

const COMPLETE_SOCIAL_SIGNUP_ERROR_COPY: Record<string, string> = {
  AGE_BELOW_MINIMUM: 'You need to be at least 13 to use CoachOS.',
  COACH_MUST_BE_ADULT:
    'Coach accounts are for adults only. You can still join as a client if a coach invites you.',
  // `complete-social-signup.ts`'s `expiredPendingSignup()` — the pending
  // token expired or was already used.
  AUTH_REQUIRED: 'This sign-in attempt has expired. Try again.',
  UNKNOWN_CONFLICT:
    "We couldn't create your account with these details. Check your email, or sign in if you already have one.",
};

/**
 * `social-sign-in/03` + Ammar's DOB-gate decision — the second step of a
 * brand-new social sign-up. `pendingSignupToken` arrives as a route param
 * from `signInWithApple`/`signInWithGoogle`'s `needsDateOfBirth` result;
 * this hook never sees a raw Apple/Google token again. Otherwise mirrors
 * `useSignUp`'s shape exactly.
 */
export function useCompleteSocialSignUp() {
  const mutation = api.auth.completeSocialSignUp.useMutation();

  async function completeSocialSignUp(
    values: CompleteSocialSignUpValues,
  ): Promise<CompleteSocialSignUpResult> {
    const dateOfBirth = parseDateOfBirthInput(values.dateOfBirth);
    if (dateOfBirth === null) {
      const message = 'Enter your date of birth as DD/MM/YYYY.';
      return { ok: false, error: { formMessage: message, fieldErrors: { dateOfBirth: message } } };
    }

    const device = await buildDeviceFields();
    const parsed = authSchemas.completeSocialSignUpInput.safeParse({
      pendingSignupToken: values.pendingSignupToken,
      dateOfBirth,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...device,
    });
    if (!parsed.success) {
      return { ok: false, error: { formMessage: 'Check the highlighted fields and try again.' } };
    }

    try {
      const session = await mutation.mutateAsync(parsed.data);
      await commitOpenedSession(session);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: mapAuthError(error, COMPLETE_SOCIAL_SIGNUP_ERROR_COPY) };
    }
  }

  return { completeSocialSignUp, isSubmitting: mutation.isPending };
}

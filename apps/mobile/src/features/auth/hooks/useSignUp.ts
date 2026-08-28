import { auth as authSchemas } from '@coachos/schemas';

import { api } from '../../../lib/trpc.ts';
import { mapAuthError, type AuthFormError } from '../auth-form-error.ts';
import { parseDateOfBirthInput } from '../date-of-birth.ts';
import { buildDeviceFields } from '../device.ts';
import { commitOpenedSession } from '../session-result.ts';

export interface SignUpValues {
  email: string;
  password: string;
  name: string;
  /** As typed — "DD/MM/YYYY". Converted to `calendarDate`'s shape before validation. */
  dateOfBirth: string;
}

export type SignUpResult = { ok: true } | { ok: false; error: AuthFormError };

const SIGN_UP_ERROR_COPY: Record<string, string> = {
  AGE_BELOW_MINIMUM: 'You need to be at least 13 to use CoachOS.',
  COACH_MUST_BE_ADULT:
    'Coach accounts are for adults only. You can still join as a client if a coach invites you.',
  // Deliberately generic, matching `auth.signUp`'s own comment: a
  // duplicate email and a genuinely new one must be indistinguishable
  // here, or the form becomes a way to check whether an address already
  // has an account (`auth-server/02`'s Approach step 6).
  UNKNOWN_CONFLICT:
    "We couldn't create your account with these details. Check your email, or sign in if you already have one.",
};

/**
 * `useSignUp` — coach-only (`auth.signUp` has no `role` field for a caller
 * to send; `04-auth-store-and-bootstrap.md`'s server always creates a
 * coach). No role picker in this form for that reason — `/design` round
 * 2 confirmed this against the finalised "2 — Conservative" direction.
 * `timezone` is read from `Intl`, not typed by the user; `dateOfBirth`
 * arrives as "DD/MM/YYYY" and is converted before the shared schema sees
 * it. Everything else mirrors `useSignIn`'s shape.
 */
export function useSignUp() {
  const mutation = api.auth.signUp.useMutation();

  async function signUp(values: SignUpValues): Promise<SignUpResult> {
    const dateOfBirth = parseDateOfBirthInput(values.dateOfBirth);
    if (dateOfBirth === null) {
      const message = 'Enter your date of birth as DD/MM/YYYY.';
      return { ok: false, error: { formMessage: message, fieldErrors: { dateOfBirth: message } } };
    }

    const device = await buildDeviceFields();
    const parsed = authSchemas.signUpInput.safeParse({
      email: values.email,
      password: values.password,
      name: values.name,
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
      return { ok: false, error: mapAuthError(error, SIGN_UP_ERROR_COPY) };
    }
  }

  return { signUp, isSubmitting: mutation.isPending };
}

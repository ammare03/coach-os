import { auth as authSchemas } from '@coachos/schemas';

import { api } from '../../../lib/trpc.ts';
import { mapAuthError, type AuthFormError } from '../auth-form-error.ts';
import { buildDeviceFields } from '../device.ts';
import { commitOpenedSession } from '../session-result.ts';

export interface SignInValues {
  email: string;
  password: string;
}

export type SignInResult = { ok: true } | { ok: false; error: AuthFormError };

// `AUTH_REQUIRED` is deliberately the one code both an unknown email and a
// wrong password produce (`apps/api/src/routers/auth.ts`'s own comment) —
// this copy must stay generic for the same reason the server's timing and
// response shape are constant.
const SIGN_IN_ERROR_COPY: Record<string, string> = {
  AUTH_REQUIRED: 'Incorrect email or password.',
};

/**
 * `useSignIn` — validates against the same `signInInput` Zod schema the
 * server uses (device fields merged in first, since those aren't
 * user-entered), calls `auth.signIn`, and on success commits the session
 * and flips the auth store. Loading state is exposed via `isSubmitting`
 * for the form's optimistic-disabled-button pattern (`ui-conventions`
 * §10.2) — this is one of the few genuinely blocking mutations in the
 * product (`ui-primitives-core/01`'s note on `Button`'s `loading` prop).
 */
export function useSignIn() {
  const mutation = api.auth.signIn.useMutation();

  async function signIn(values: SignInValues): Promise<SignInResult> {
    const device = await buildDeviceFields();
    const parsed = authSchemas.signInInput.safeParse({ ...values, ...device });
    if (!parsed.success) {
      return { ok: false, error: { formMessage: 'Check the highlighted fields and try again.' } };
    }

    try {
      const session = await mutation.mutateAsync(parsed.data);
      await commitOpenedSession(session);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: mapAuthError(error, SIGN_IN_ERROR_COPY) };
    }
  }

  return { signIn, isSubmitting: mutation.isPending };
}

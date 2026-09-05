import { auth as authSchemas } from '@coachos/schemas';

import { api } from '../../../lib/trpc.ts';
import { mapAuthError, type AuthFormError } from '../auth-form-error.ts';

export interface RequestPasswordResetValues {
  email: string;
}

export type RequestPasswordResetResult = { ok: true } | { ok: false; error: AuthFormError };

// `auth.requestReset` shares the per-IP `auth.*` bucket AND adds a
// per-email limit of 3 / 15 min (`apps/api/src/features/auth/password-
// reset.ts`), so `RATE_LIMITED` is the one code this screen can realistically
// reach besides a network failure. `ERRORS.md` ER§1 pairs it with a
// "try again in {retryAfter}" line; the server's `retryAfterSeconds`
// detail is not surfaced here yet, so the copy stays unquantified rather
// than inventing a number.
const REQUEST_RESET_ERROR_COPY: Record<string, string> = {
  RATE_LIMITED: 'Too many attempts. Try again in a few minutes.',
};

/**
 * `auth.requestReset` — the client half of `auth-server/06`.
 *
 * The procedure resolves identically whether or not the email has an
 * account, in identical time, because a different response would be an
 * account-enumeration oracle (that procedure's own doc comment). This hook
 * therefore has no "unknown email" branch to expose, and the screen's
 * confirmation copy must not imply one either
 * (`security-and-privacy` skill).
 */
export function useRequestPasswordReset() {
  const mutation = api.auth.requestReset.useMutation();

  async function requestPasswordReset(
    values: RequestPasswordResetValues,
  ): Promise<RequestPasswordResetResult> {
    const parsed = authSchemas.requestResetInput.safeParse(values);
    if (!parsed.success) {
      return { ok: false, error: { formMessage: 'Check the highlighted fields and try again.' } };
    }

    try {
      await mutation.mutateAsync(parsed.data);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: mapAuthError(error, REQUEST_RESET_ERROR_COPY) };
    }
  }

  return { requestPasswordReset, isSubmitting: mutation.isPending };
}

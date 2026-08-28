import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';

import { api } from '../../../lib/trpc.ts';
import { mapAuthError, type AuthFormError } from '../auth-form-error.ts';
import { buildDeviceFields } from '../device.ts';
import { commitOpenedSession } from '../session-result.ts';

export type AppleSignInResult =
  | { status: 'signedIn' }
  | { status: 'needsDateOfBirth'; pendingSignupToken: string; email: string }
  | { status: 'cancelled' }
  | { status: 'error'; error: AuthFormError };

const APPLE_SIGN_IN_ERROR_COPY: Record<string, string> = {
  SOCIAL_TOKEN_INVALID: "We couldn't verify that with Apple. Try again.",
  SOCIAL_ACCOUNT_EXISTS: 'An account with this email already exists. Sign in to link it instead.',
};

function genericError(): AppleSignInResult {
  return {
    status: 'error',
    error: { formMessage: "We couldn't verify that with Apple. Try again." },
  };
}

/**
 * `social-sign-in/01` — requests an identity token from Apple with a
 * device-generated nonce, then hands it to `auth.signInWithApple`, which
 * verifies it server-side (`../../../apps/api/src/lib/auth/provider-verification.ts`)
 * and never trusts a client-side claim about who signed in. `expo-crypto`'s
 * `randomUUID()` is the nonce — 36 characters of secure randomness, well
 * within `signInWithAppleInput`'s bounds, and Apple echoes it back
 * unhashed in the identity token's own `nonce` claim (the codebase's
 * verifier compares it directly, not against a SHA-256 of it).
 */
export function useAppleSignIn() {
  const mutation = api.auth.signInWithApple.useMutation();

  async function signInWithApple(): Promise<AppleSignInResult> {
    const nonce = Crypto.randomUUID();

    let credential: AppleAuthentication.AppleAuthenticationCredential;
    try {
      credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce,
      });
    } catch (error) {
      // Apple's own SDK throws this specific code when the person dismisses
      // the sheet — not an error, nothing to show.
      if ((error as { code?: string } | null)?.code === 'ERR_REQUEST_CANCELED') {
        return { status: 'cancelled' };
      }
      return genericError();
    }

    if (!credential.identityToken) {
      return genericError();
    }

    // Apple's identity token never carries a name — `credential.fullName`
    // is the one-time chance (only present on this app's very first
    // authorization for this Apple ID), and the only place it exists at
    // all. Sent alongside the token so a brand-new account never needs to
    // ask for it separately (`packages/schemas/src/auth.ts`'s own comment).
    const fullName = [credential.fullName?.givenName, credential.fullName?.familyName]
      .filter((part): part is string => Boolean(part))
      .join(' ')
      .trim();

    const device = await buildDeviceFields();
    try {
      const result = await mutation.mutateAsync({
        identityToken: credential.identityToken,
        nonce,
        ...(fullName.length > 0 && { fullName }),
        ...device,
      });
      if (result.kind === 'needsDateOfBirth') {
        return {
          status: 'needsDateOfBirth',
          pendingSignupToken: result.pendingSignupToken,
          email: result.email,
        };
      }
      await commitOpenedSession(result);
      return { status: 'signedIn' };
    } catch (error) {
      return { status: 'error', error: mapAuthError(error, APPLE_SIGN_IN_ERROR_COPY) };
    }
  }

  return { signInWithApple, isSubmitting: mutation.isPending };
}

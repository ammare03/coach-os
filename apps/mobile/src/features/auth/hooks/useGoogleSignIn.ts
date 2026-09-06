import * as Google from 'expo-auth-session/providers/google';

import { api } from '../../../lib/trpc.ts';
import { mapAuthError, type AuthFormError } from '../auth-form-error.ts';
import { buildDeviceFields } from '../device.ts';
import { commitOpenedSession } from '../session-result.ts';

export type GoogleSignInResult =
  | { status: 'signedIn' }
  | { status: 'needsDateOfBirth'; pendingSignupToken: string; email: string }
  | { status: 'cancelled' }
  | { status: 'error'; error: AuthFormError };

const GOOGLE_SIGN_IN_ERROR_COPY: Record<string, string> = {
  SOCIAL_TOKEN_INVALID: "We couldn't verify that with Google. Try again.",
  SOCIAL_ACCOUNT_EXISTS: 'An account with this email already exists. Sign in to link it instead.',
};

function genericError(): GoogleSignInResult {
  return {
    status: 'error',
    error: { formMessage: "We couldn't verify that with Google. Try again." },
  };
}

/**
 * `social-sign-in/02` — `expo-auth-session`'s Google OIDC provider rather
 * than a native Google Sign-In SDK (`@react-native-google-signin/google-signin`):
 * no second native module, no separate config plugin, and it reuses
 * `expo-web-browser` (already a `CLAUDE.md` §3.1 dependency) for the actual
 * consent screen instead of Google Play Services. `CLAUDE.md` §3.4.1's
 * decision procedure — prefer what's already in the toolkit — decided this,
 * recorded in §3.1/§3.3 alongside this task. Costs a system-browser hop
 * instead of the native account picker; the exchange is worth it for a
 * solo-maintained free-tier app until that UX gap earns a native module.
 *
 * The authorization-code + PKCE exchange happens entirely on-device against
 * Google's token endpoint — `GOOGLE_SIGN_IN_CLIENT_IDS`' iOS/Android
 * entries are public client ids, not secrets (no client secret exists for
 * this client type), matching `security-and-privacy`'s
 * `EXPO_PUBLIC_*`-is-public rule.
 */
export function useGoogleSignIn() {
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;
  // No `redirectUri` override: the provider defaults to
  // `${applicationId}:/oauthredirect` (`com.coachos.app.dev:/oauthredirect`
  // on a dev build), which is the only redirect shape Google's iOS and
  // Android OAuth client types accept — a `coachos://` redirect is refused
  // with `redirect_uri_mismatch` before the consent screen. `app.config.ts`
  // registers the app id as a URL scheme so the browser can return to us.
  const [request, , promptAsync] = Google.useAuthRequest({
    ...(iosClientId !== undefined && { iosClientId }),
    ...(androidClientId !== undefined && { androidClientId }),
  });
  const mutation = api.auth.signInWithGoogle.useMutation();

  async function signInWithGoogle(): Promise<GoogleSignInResult> {
    if (!request) {
      return genericError();
    }

    const response = await promptAsync();
    if (response.type === 'cancel' || response.type === 'dismiss') {
      return { status: 'cancelled' };
    }
    if (response.type !== 'success') {
      return genericError();
    }

    const idToken = response.authentication?.idToken ?? response.params?.id_token;
    if (!idToken) {
      return genericError();
    }

    const device = await buildDeviceFields();
    try {
      const result = await mutation.mutateAsync({ idToken, ...device });
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
      return { status: 'error', error: mapAuthError(error, GOOGLE_SIGN_IN_ERROR_COPY) };
    }
  }

  return { signInWithGoogle, isSubmitting: mutation.isPending, ready: request !== null };
}

// `client-onboarding/01`, Approach step 6 — the way out of a wrong
// session, offered on all three signed-in invite branches.
//
// The order matters and is the whole content of this hook: revoke the
// refresh-token family server-side FIRST, then clear the device's copies,
// then flip the store. Clearing locally first would leave a live family on
// the server that nothing can now present a token for, and flipping the
// store first would unmount the screen mid-call.
//
// It never fails the user: a caller who is offline still gets signed out
// locally, because the alternative is being stuck signed in as the wrong
// account with no recovery. The family is revoked on the next successful
// refresh attempt either way (`refresh-interceptor.ts`).
import { useState } from 'react';

import { api } from '../../../lib/trpc.ts';
import { useAuthStore } from '../store.ts';
import { clearTokens, getTokens } from '../token-store.ts';

export interface SignOutResult {
  signOut: () => Promise<void>;
  isSigningOut: boolean;
}

export function useSignOut(): SignOutResult {
  const mutation = api.auth.signOut.useMutation();
  const utils = api.useUtils();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function signOut(): Promise<void> {
    setIsSigningOut(true);
    try {
      const stored = await getTokens();
      if (stored !== null) {
        await mutation
          .mutateAsync({ refreshToken: stored.refreshToken })
          // Swallowed deliberately — see the header comment.
          .catch(() => undefined);
      }
      await clearTokens();
      useAuthStore.getState().setSignedOut();
      // Nothing cached belongs to the next session.
      utils.invalidate();
    } finally {
      setIsSigningOut(false);
    }
  }

  return { signOut, isSigningOut };
}

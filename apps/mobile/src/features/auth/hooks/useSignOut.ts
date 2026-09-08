// `client-onboarding/01`, Approach step 6 — the way out of a wrong
// session, offered on all three signed-in invite branches.
//
// The order matters and is the whole content of this hook: check the
// device-mirror wipe FIRST (`local-database/03-wipe-on-logout.md`), then
// revoke the refresh-token family server-side, then clear the device's
// token copies, then flip the store. Checking the wipe first means a
// `blocked` result (unsynced outbox rows, no `force`) leaves the session
// completely untouched — nothing revoked, nothing cleared — so the caller
// can retry with `force` once the user confirms discarding the pending
// work, rather than the caller being left signed out of a session it can no
// longer use. Once past that gate: revoking locally first would leave a
// live family on the server that nothing can now present a token for, and
// flipping the store first would unmount the screen mid-call.
//
// It never fails the user for reasons outside its control: a caller who is
// offline still gets signed out locally, because the alternative is being
// stuck signed in as the wrong account with no recovery. The family is
// revoked on the next successful refresh attempt either way
// (`refresh-interceptor.ts`). A `wipeLocalDataOnSignOut` failure (as
// opposed to `blocked`) is treated the same way — sign-out proceeds rather
// than trapping the user over a local disk error.
import { useState } from 'react';

import type { WipeResult } from '../../../db/wipe.ts';
import { api } from '../../../lib/trpc.ts';
import { useAuthStore, wipeLocalDataOnSignOut } from '../store.ts';
import { clearTokens, getTokens } from '../token-store.ts';

export interface SignOutResult {
  signOut: (options?: { force?: boolean }) => Promise<WipeResult>;
  isSigningOut: boolean;
}

export function useSignOut(): SignOutResult {
  const mutation = api.auth.signOut.useMutation();
  const utils = api.useUtils();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function signOut(options: { force?: boolean } = {}): Promise<WipeResult> {
    setIsSigningOut(true);
    try {
      const wipeResult = await wipeLocalDataOnSignOut(options);
      if (wipeResult.outcome === 'blocked') {
        // Unsynced work exists and the caller didn't force it — the whole
        // sign-out is refused, not just the file delete, so there's no
        // window where the store says unauthenticated but the previous
        // user's rows are still in SQLite (this task's own acceptance
        // criteria).
        return wipeResult;
      }

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
      return wipeResult;
    } finally {
      setIsSigningOut(false);
    }
  }

  return { signOut, isSigningOut };
}

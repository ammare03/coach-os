// `phase-06-onboarding/onboarding-infrastructure/02` — the client half of
// the completion moment. Each flow's final step calls `complete()` once,
// after its own submission has succeeded; nothing else may, and nothing
// infers completeness from "every field has a value" (that task's Approach
// step 2).
import { api } from '../../../lib/trpc.ts';
import { useAuthStore } from '../../auth/store.ts';

export interface CompleteOnboardingResult {
  complete: () => Promise<void>;
  isCompleting: boolean;
}

/**
 * Calls `me.completeOnboarding`, then — in the same turn, before the promise
 * resolves to its caller — flips the auth store's `isOnboarded`.
 *
 * That ordering is the whole point of this hook, and the answer to the
 * task's stated risk. The route gate reads `isOnboarded` from Zustand
 * synchronously, so the redirect out of the flow and into the main shell is
 * a direct consequence of the write succeeding: no refetch, no foreground,
 * no relaunch, and no window in which a stale cached value can strand
 * someone in a flow they have just finished.
 *
 * Deliberately not optimistic (`useMedicalDisclaimer` states the same
 * exception): the value of this flag is that it reflects a server write
 * that actually happened. A rejected mutation leaves the store untouched
 * and the person where they were, with the error to handle — never
 * "onboarded" on a device and not on the server.
 */
export function useCompleteOnboarding(): CompleteOnboardingResult {
  const utils = api.useUtils();
  const mutation = api.me.completeOnboarding.useMutation();

  async function complete(): Promise<void> {
    await mutation.mutateAsync();
    useAuthStore.getState().setOnboarded();
    // `me.get` carries the authoritative `onboardingCompletedAt` and is now
    // stale. Fire-and-forget: the gate does not wait on it, and a settings
    // screen reading the profile later must not see the old row.
    void utils.me.get.invalidate();
  }

  return { complete, isCompleting: mutation.isPending };
}

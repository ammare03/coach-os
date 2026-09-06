// `phase-06-onboarding/coach-onboarding/04` — the completion moment, in
// one place because it is the feature's integration point and the task's
// stated risk: a bug here (the completion call failing silently, the reset
// not firing) is invisible to every earlier task's own tests.
//
// Two paths in, one path out. Invite-then-finish and finish-alone differ by
// exactly one request; everything after — `completeOnboarding`, the
// analytics event, the draft reset — is identical, and keeping it identical
// is what stops the "later" path quietly skipping the reset.
import { useState } from 'react';

import { trackEvent, asUuid } from '../../../lib/analytics/index.ts';
import { getErrorCode } from '../../../lib/error-code.ts';
import { api } from '../../../lib/trpc.ts';
import { useCoachOnboardingStore } from '../coach-store.ts';

import { useCompleteOnboarding } from './useCompleteOnboarding.ts';

/**
 * `ERRORS.md`-catalogued codes this step can actually reach, mapped to copy
 * this app wrote. Never `error.message` — `error-code.ts` is explicit that
 * nothing reads the server's own string to decide what to show.
 */
const ERROR_COPY: Record<string, string> = {
  SEAT_LIMIT_REACHED:
    'You’ve used every client seat on your plan. You can still finish setting up.',
  VALIDATION_FAILED: 'That doesn’t look like an email address.',
  RATE_LIMITED: 'Too many tries just now. Wait a minute and try again.',
};

const GENERIC = 'We couldn’t send that invite. Check your connection and try again.';

export interface FinishCoachOnboardingResult {
  finishWithInvite: (email: string) => Promise<void>;
  finishWithoutInvite: () => Promise<void>;
  isFinishing: boolean;
  /** Set only after a failed attempt; cleared at the start of the next one. */
  error: string | null;
}

export function useFinishCoachOnboarding(): FinishCoachOnboardingResult {
  const createInvite = api.invites.create.useMutation();
  const { complete } = useCompleteOnboarding();
  const [isFinishing, setIsFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The shared tail. `stepsSkipped` is the one thing the two paths disagree
   * about, and it is a count rather than a flag so a later flow with more
   * optional steps reports on the same property.
   */
  async function finish(stepsSkipped: number) {
    const { startedAt } = useCoachOnboardingStore.getState().fields;
    await complete();
    trackEvent('onboarding_completed', {
      role: 'coach',
      // Whole seconds since the first step transition. `0` when the stamp
      // is missing — a draft written before this field existed — rather
      // than a nonsense duration derived from `Date.now() - 0`.
      duration_s: startedAt === null ? 0 : Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
      steps_skipped: stepsSkipped,
    });
    // Last, and only on success. A reset before the write lands would throw
    // away a draft the coach still needs if the write then failed.
    useCoachOnboardingStore.getState().reset();
  }

  async function run(action: () => Promise<void>) {
    setError(null);
    setIsFinishing(true);
    try {
      await action();
    } catch (caught) {
      const code = getErrorCode(caught);
      setError((code === null ? undefined : ERROR_COPY[code]) ?? GENERIC);
    } finally {
      setIsFinishing(false);
    }
  }

  return {
    isFinishing,
    error,
    finishWithInvite: (email) =>
      run(async () => {
        const invite = await createInvite.mutateAsync({ email });
        trackEvent('client_invited', { invite_id: asUuid(invite.id) });
        await finish(0);
      }),
    finishWithoutInvite: () => run(() => finish(1)),
  };
}

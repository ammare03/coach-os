// `phase-06-onboarding/client-onboarding/05` — the completion moment, and
// the only place this flow reaches the server with what it collected.
//
// It is the feature's integration point and its stated risk: a bug here
// (the write failing silently, the reset not firing, the permission
// blocking completion) is invisible to every earlier task's own tests.
//
// The order is fixed and load-bearing:
//   1. `client.updateProfile` — the whole accumulated draft, one call.
//   2. `me.completeOnboarding` — only if 1 succeeded.
//   3. the analytics event, then the draft reset.
//
// The OS notification permission is deliberately NOT in that list. It is
// requested before this runs and its outcome is not an input: a client who
// declines finishes onboarding exactly as well as one who accepts.
import { client as clientSchemas } from '@coachos/schemas';
import { useState } from 'react';

import { trackEvent } from '../../../lib/analytics/index.ts';
import { getErrorCode } from '../../../lib/error-code.ts';
import { api } from '../../../lib/trpc.ts';
import { useClientOnboardingStore } from '../client-store.ts';

import { useCompleteOnboarding } from './useCompleteOnboarding.ts';

/** Catalogued codes this step can reach, mapped to copy this app wrote — never `error.message`. */
const ERROR_COPY: Record<string, string> = {
  VALIDATION_FAILED: 'Something in your answers didn’t look right. Go back and check them.',
  RATE_LIMITED: 'Too many tries just now. Wait a minute and try again.',
};

const GENERIC = 'We couldn’t save that. Check your connection and try again.';

export interface FinishClientOnboardingResult {
  finish: () => Promise<void>;
  isFinishing: boolean;
  /** Set only after a failed attempt; cleared at the start of the next one. */
  error: string | null;
}

export function useFinishClientOnboarding(): FinishClientOnboardingResult {
  const updateProfile = api.clientApp.updateProfile.useMutation();
  const { complete } = useCompleteOnboarding();
  const [isFinishing, setIsFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish(): Promise<void> {
    setError(null);
    setIsFinishing(true);
    try {
      const { fields } = useClientOnboardingStore.getState();

      // Parsed against the same schema the procedure validates with, so a
      // draft that cannot be written is caught here rather than as a
      // server round trip — and so this hook never sends a shape the
      // allowlist would reject.
      const parsed = clientSchemas.updateProfileInput.safeParse({
        goal: fields.goal,
        goalNotes: fields.goalNotes,
        dateOfBirth: fields.dateOfBirth,
        sexAtBirth: fields.sexAtBirth,
        heightCm: fields.heightCm,
        experienceLevel: fields.experienceLevel,
        equipmentAccess: [...fields.equipmentAccess],
        dietaryRestrictions: [...fields.dietaryRestrictions],
      });
      if (!parsed.success) {
        setError('Something in your answers didn’t look right. Go back and check them.');
        return;
      }

      await updateProfile.mutateAsync(parsed.data);
      await complete();

      trackEvent('onboarding_completed', {
        role: 'client',
        // Whole seconds since the first step transition. `0` when the
        // stamp is missing — a draft written before this field existed —
        // rather than a nonsense duration derived from `Date.now() - 0`.
        duration_s:
          fields.startedAt === null
            ? 0
            : Math.max(0, Math.round((Date.now() - fields.startedAt) / 1000)),
        // Nothing in this flow is skippable: every step but the
        // notification rationale gates its own Continue, and that one
        // always completes whichever way it is answered.
        steps_skipped: 0,
      });

      // Last, and only on success. A reset before the write lands would
      // throw away a draft the client still needs if the write then failed.
      useClientOnboardingStore.getState().reset();
    } catch (caught) {
      const code = getErrorCode(caught);
      setError((code === null ? undefined : ERROR_COPY[code]) ?? GENERIC);
    } finally {
      setIsFinishing(false);
    }
  }

  return { finish, isFinishing, error };
}

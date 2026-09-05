// `phase-06-onboarding/onboarding-infrastructure/03` — reads back whether
// this user has acknowledged the current wording of the §21.3 disclaimer,
// and records it when they do. Lives in a hook so the screens stay
// composition-only (`code-conventions` §1).
import { me as meSchemas } from '@coachos/schemas';

import { api } from '../../../lib/trpc.ts';

export function useMedicalDisclaimer() {
  const utils = api.useUtils();
  const status = api.me.medicalDisclaimer.status.useQuery();

  const acknowledge = api.me.medicalDisclaimer.acknowledge.useMutation({
    onSuccess: () => {
      void utils.me.medicalDisclaimer.status.invalidate();
    },
  });

  return {
    status,
    acknowledge,
    /**
     * Deliberately not optimistic (`ui-conventions` §5's "optimistic
     * always" has one sensible exception, and this is it): the whole value
     * of this record is that it reflects a server write that actually
     * happened. Advancing the flow on a write that then failed would leave
     * a person onboarded with no acknowledgment on file.
     */
    acknowledgeCurrent: () =>
      acknowledge.mutate({ version: meSchemas.CURRENT_MEDICAL_DISCLAIMER_VERSION }),
  };
}

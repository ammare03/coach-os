// `phase-06-onboarding/coach-onboarding/02` — onboarding step 2's write.
//
// Deliberately thin: the flow owns the optimistic advance and the rollback,
// because "which step is on screen" is the flow's state and not this hook's
// (`code-conventions` §5). What lives here is the one thing every caller
// would otherwise re-derive — that a successful profile write makes
// `me.get` stale.
import { api } from '../../../lib/trpc.ts';

export function useUpdateCoachProfile() {
  const utils = api.useUtils();

  return api.coach.updateProfile.useMutation({
    onSuccess: () => {
      // Fire-and-forget: nothing in the flow reads the profile back, but a
      // settings screen opened later must not show the old business name.
      void utils.me.get.invalidate();
    },
  });
}

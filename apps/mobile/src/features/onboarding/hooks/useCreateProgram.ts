// `phase-06-onboarding/coach-onboarding/03` — onboarding step 3's write.
// Thin for the same reason `useUpdateCoachProfile` is: the optimistic
// advance and the rollback are the flow's, not this hook's.
import { api } from '../../../lib/trpc.ts';

export function useCreateProgram() {
  return api.programs.create.useMutation();
}

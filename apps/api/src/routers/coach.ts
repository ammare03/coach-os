import { router } from '../trpc/init.ts';
import { protectedProcedure } from '../trpc/procedures.ts';

// `dashboard` (phase-10-coach-review-surfaces) and `notes` (phase-06-onboarding)
// are still empty. `clients.list` is a stub, not a placeholder: it exists
// solely so `04-router-registry.md`'s and `../authorization-middleware/04`'s
// reflective walks have a real two-level path (`coach.clients.list`) to
// reach. phase-06-onboarding replaces it with the real procedure — same
// name, same path, real implementation.
export const coachRouter = router({
  clients: router({
    list: protectedProcedure.query(() => []),
  }),
});

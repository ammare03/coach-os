import { router } from '../trpc/init.ts';

import { healthRouter } from './health.ts';

// `04-router-registry.md` formalises this into the full §6.1 registry
// (all eighteen top-level routers, alphabetical). For now: health only,
// to prove the mount.
export const appRouter = router({
  health: healthRouter,
});

export type AppRouter = typeof appRouter;

import { router } from '../trpc/init.ts';

// Filled by phase-11-media-pipeline. Registered empty now so the tree's
// shape is visible from api-scaffold onward.
//
// `createUploadUrl` needs CLAUDE.md §6.5's 60/hour/user tier:
// `.use(rateLimit(RATE_LIMIT_TIERS.mediaCreateUploadUrl))` (both from
// `../trpc/procedures.ts`), chained after `.input()`
// (`rate-limiting/03-per-route-config-and-429-handling.md`). Every other
// procedure in this router gets the 600/min default automatically by
// deriving from `publicProcedure`/`protectedProcedure` — nothing extra
// needed there.
export const mediaRouter = router({});

import { session as sessionSchemas } from '@coachos/schemas';

import { getSessionReview } from '../features/coach/session-review.ts';
import { router } from '../trpc/init.ts';
import { coachProcedure, ownsResource } from '../trpc/procedures.ts';

// `session.*` — the coach's read-only view of one logged session
// (`phase-10-coach-review-surfaces/session-review/01`).
//
// A top-level key rather than a third level under `coach.clients`: the
// README caps nesting at two, and `coach.clients.sessionReview` would put a
// procedure whose subject is a SESSION inside a namespace whose subject is a
// client. §6.1's list predates this feature and does not name it, exactly as
// it does not name `assignments` or `habits`.
//
// **`session` is safe as a top-level key**, unlike `client` — which had to
// become `clientApp` because `createTRPCReact`'s returned object reserves
// `.client` for the raw vanilla client (see `index.ts`'s note). The reserved
// set is `CreateTRPCReactBase`: `useContext`, `useUtils`, `Provider`,
// `createClient`, `useQueries`, `useSuspenseQueries`. `session` is not among
// them, checked against the installed `@trpc/react-query` 11.18.0 types
// rather than assumed.
export const sessionRouter = router({
  // §8.4's coach-side close: "full session with every set, PRs highlighted."
  //
  // **A `query` that writes**, which `api-conventions` §2 otherwise forbids
  // outright. The exception is deliberate, scoped to this one procedure, and
  // argued in `features/coach/session-review.ts` decision (a): opening the
  // screen IS the review, the write is `UPDATE … WHERE reviewed_at IS NULL`
  // and so idempotent on every repeat view, and making it a mutation would
  // mean the screen firing a write alongside its read for one act of reading.
  //
  // `ownsResource('workoutSession', …)` is the whole security story — the
  // resolver below re-checks no `coach_id`, and everything it reads is
  // addressed by the session id this middleware has already proven the
  // caller owns. Chained AFTER `.input()`, with the selector's parameter
  // annotated: neither is stylistic (README, "Procedure chain order").
  //
  // No `.output()` gate: nothing returned comes off a row carrying a column
  // the coach must not see, and every field is mapped explicitly rather than
  // spread (README, "When a procedure needs `.output()`").
  review: coachProcedure
    .input(sessionSchemas.reviewInput)
    .use(ownsResource('workoutSession', (i: { sessionId: string }) => i.sessionId))
    .query(({ ctx, input }) => getSessionReview(ctx.db, input.sessionId)),
});

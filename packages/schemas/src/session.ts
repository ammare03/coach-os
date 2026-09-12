// Input schemas for `session.*` — the coach's read-only view of one logged
// session (`phase-10-coach-review-surfaces/session-review/01`).
//
// A top-level module of its own rather than a third `coach.clients.*`
// entry: the router README caps nesting at two levels, and
// `coach.clients.sessionReview` would be the point where "a coach's client"
// stops being the subject and "one session" starts being it.
import type { z } from 'zod';

import { id, strictObject } from './primitives.ts';

/**
 * `session.review` — one session, every set, the PRs it set, and what the
 * client said about it.
 *
 * `sessionId` and nothing else. Everything the screen renders is a product
 * decision about what a coach needs in front of them, never a window or a
 * projection the caller may widen — the same reasoning
 * `coach.clients.overview`'s single-field input states.
 *
 * Registered in `apps/api/src/trpc/authz/resource-fields.ts` as a
 * `workoutSession`, which is what makes the authorisation enumeration test
 * probe it with another coach's session.
 */
export const reviewInput = strictObject({
  sessionId: id,
});
export type ReviewInput = z.infer<typeof reviewInput>;

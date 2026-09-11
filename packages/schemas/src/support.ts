// `support.triggerUserExport` (`account-lifecycle/12`) — the operator path.
// The only §6.1 router this package has schemas for whose caller is staff,
// not a coach or client; still no delivery-address field, same governing
// rule as `me.requestExportForDependent` — delivery is always the subject's
// own verified email, never a value this input could carry.
import { z } from 'zod';

import { id, strictObject } from './primitives.ts';

export const triggerUserExportInput = strictObject({
  subjectUserId: id,
  // Free text for the ticket system's own reference format — bounded for
  // shape only, same reasoning as `primitives.ts`'s own `.max()` comment.
  reason: z.string().trim().min(1).max(500),
  ticketReference: z.string().trim().min(1).max(100),
});

/**
 * `support.clearSessionClaim` — `SUPPORT.md` SU§3's lost-phone case, and
 * DB§14.5's third release path alongside the six-hour ceiling and the
 * fifteen-minute heartbeat rule (`phase-09-workout-logger/session-runtime/08`).
 *
 * It clears `active_device_id`/`claimed_at` on one session and touches
 * nothing else — not the status, not a set, not the prescription. The
 * operator never reads the session's contents to do it: the input names a
 * row and the result reports only whether a claim was there to clear.
 */
export const clearSessionClaimInput = strictObject({
  workoutSessionId: id,
  reason: z.string().trim().min(1).max(500),
  ticketReference: z.string().trim().min(1).max(100),
});

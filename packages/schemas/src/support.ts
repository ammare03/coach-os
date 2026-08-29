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

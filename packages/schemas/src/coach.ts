// Input schemas for `coach.*`, including its `clients` and `notes`
// sub-routers. `clients.list`/`get`/`invite`/`archive` and `notes.*` are
// filled by phase-06-onboarding (clients) and phase-10-coach-review-
// surfaces (dashboard, notes). `clients.release` (`account-lifecycle/06`)
// is the one procedure this module fills ahead of those phases.
import type { z } from 'zod';

import { id, strictObject } from './primitives.ts';

/** `coach.clients.release` (`06`) — ends the relationship from the coach's side. */
export const releaseClientInput = strictObject({
  clientId: id,
});
export type ReleaseClientInput = z.infer<typeof releaseClientInput>;

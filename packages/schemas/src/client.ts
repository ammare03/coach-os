// Input schemas for `client.*` (dashboard, today, coach). `dashboard`/
// `today`/`coach` are filled by phase-06-onboarding. `leaveCoach`
// (`account-lifecycle/06`, no input) and `updateHistorySharing`
// (`account-lifecycle/07`) land here ahead of that phase.
import type { z } from 'zod';

import { historySharingInput } from './primitives.ts';

/** `client.updateHistorySharing` (`07`) — widen or narrow the CURRENT relationship's sharing from settings. */
export const updateHistorySharingInput = historySharingInput;
export type UpdateHistorySharingInput = z.infer<typeof updateHistorySharingInput>;

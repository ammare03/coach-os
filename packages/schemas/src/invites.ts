// Input schemas for `invites.*` (`create`, `accept`, `revoke`, `listPending`).
// `01` fills `createInviteInput`; `04` adds `acceptInviteInput`; `05` adds
// `revokeInviteInput`. `listPending` takes no input.
import type { z } from 'zod';

import { email, strictObject } from './primitives.ts';

/** `invites.create` (`01`) — `email` is the only caller input; the code, the 14-day expiry, and the coach binding are all server-derived. */
export const createInviteInput = strictObject({
  email,
});
export type CreateInviteInput = z.infer<typeof createInviteInput>;

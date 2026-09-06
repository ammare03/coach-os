// Input schemas for `invites.*` (`create`, `accept`, `revoke`, `listPending`).
// `01` fills `createInviteInput`; `04` adds `acceptInviteInput`; `05` adds
// `revokeInviteInput`. `listPending` takes no input.
import { z } from 'zod';

import {
  calendarDate,
  deviceFields,
  email,
  historySharingInput,
  id,
  password,
  strictObject,
  timezone,
} from './primitives.ts';

/** `invites.create` (`01`) — `email` is the only caller input; the code, the 14-day expiry, and the coach binding are all server-derived. */
export const createInviteInput = strictObject({
  email,
});
export type CreateInviteInput = z.infer<typeof createInviteInput>;

/**
 * The 8-character unambiguous code (`invites/03`'s alphabet — 2-9, A-Z minus
 * I/O). Format-validated only; whether it resolves to a real, unexpired,
 * unaccepted, unrevoked row is `invites.accept`'s job, not this schema's
 * (`INVITE_NOT_FOUND`/`INVITE_EXPIRED`/`INVITE_ALREADY_ACCEPTED`/`INVITE_REVOKED`
 * are all runtime outcomes, never a validation failure).
 */
export const inviteCode = z
  .string()
  .length(8)
  .max(8) // `.length()` alone doesn't register as a `.max()` check to `conventions.test.ts`'s walker
  .regex(/^[2-9A-HJ-NP-Z]{8}$/, 'Not a valid invite code');

/**
 * `invites.accept` (`04`) — this procedure is also where a client's account
 * is created (`CLAUDE.md` §8.1: clients cannot self-register independently
 * of an invite, so there is no separate client sign-up step for this to
 * follow — see `../../apps/api/src/features/auth/create-coach-account.ts`'s
 * own doc comment, which names this exact task as the client-shaped
 * counterpart). `email` is deliberately absent — the created account's email
 * is the invite's own `email`, never a caller-supplied value, so the invite
 * and the account it produces can never diverge.
 *
 * `guardianEmail` is required only when the caller turns out to be 13-17
 * (checked against `dateOfBirth` server-side, not by this schema, which has
 * no way to know the outcome in advance) — omitting it there is what
 * produces `GUARDIAN_CONSENT_REQUIRED`, prompting a resubmission with it
 * filled in.
 */
export const acceptInviteInput = strictObject({
  code: inviteCode,
  password,
  name: z.string().trim().min(1).max(200),
  timezone,
  dateOfBirth: calendarDate,
  guardianEmail: email.optional(),
  ...deviceFields,
});
export type AcceptInviteInput = z.infer<typeof acceptInviteInput>;

/**
 * `invites.acceptAsExistingClient` (`07`) — no `password`/`name`/`dateOfBirth`:
 * the caller is already an authenticated, existing client. Only the code
 * and the sharing decision are theirs to supply.
 */
export const acceptInviteAsExistingClientInput = strictObject({
  code: inviteCode,
  ...historySharingInput.shape,
});
export type AcceptInviteAsExistingClientInput = z.infer<typeof acceptInviteAsExistingClientInput>;

/** `invites.revoke` (`05`) — `ownsResource('invite', ...)` confirms the id belongs to the calling coach before this ever reaches the resolver. */
export const revokeInviteInput = strictObject({
  inviteId: id,
});
export type RevokeInviteInput = z.infer<typeof revokeInviteInput>;

/**
 * `invites.preview` (`client-onboarding/01`) — what a signed-in, coachless
 * client is shown before they decide what to share with the coach who
 * invited them. Read-only, and deliberately narrow: the code the caller
 * already holds goes in, the inviting coach's display name comes back and
 * nothing else.
 *
 * It is a `clientProcedure` and it repeats
 * `accept-invite-as-existing-client.ts`'s email check, both for the same
 * reason: a preview that answered for any code would hand any signed-in
 * user an oracle for whose invite a code is (`security-and-privacy` §1).
 */
export const previewInviteInput = strictObject({
  code: inviteCode,
});
export type PreviewInviteInput = z.infer<typeof previewInviteInput>;

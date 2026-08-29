// Input schemas for `me.*` (get, update, updatePreferences, deleteAccount).
// `me.get` takes no input — only `update` (this task) needs one so far.
import { z } from 'zod';

import { id, strictObject, timezone } from './primitives.ts';

/**
 * A BCP-47-shaped locale tag (e.g. `"en"`, `"en-IN"`, `"hi"`). `identity.users.locale`
 * (DB§5.1) is an unconstrained `text` column with no `CHECK`, so this only bounds shape
 * and length — same reasoning as `primitives.ts`'s own `.max()` comment.
 */
export const locale = z.string().trim().min(2).max(35);

/**
 * `me.update` (`account-lifecycle/01`) — an explicit allowlist of the shared `users`
 * columns a person may change about themselves. `email` and `role` are deliberately
 * absent: an email change is a separate, more sensitive flow out of this task's scope,
 * and `role` is immutable (CLAUDE.md §8.1). A generic partial-update schema here would
 * risk exposing `passwordHash` or billing fields to a client-driven update — the
 * allowlist is the whole point (see this task's Risks section).
 */
export const updateMeInput = strictObject({
  name: z.string().trim().min(1).max(200).optional(),
  timezone: timezone.optional(),
  locale: locale.optional(),
  avatarAssetId: id.nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'Provide at least one field to update.',
});

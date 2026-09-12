// Input schemas for `notes.*` — a coach's private notes about one client
// (`phase-10-coach-review-surfaces/coach-notes/01`).
//
// A top-level module rather than a `coach.clients.*` entry: `identity.
// coach_client_notes` is a resource in its own right, addressed by its own
// id, and the router README caps nesting at two levels — the same call
// `session.ts` made for the same reason.
//
// **The id field is `coachNoteId`, never `noteId`.** That is the name
// `apps/api/src/trpc/authz/resource-fields.ts` already maps to the
// `coachNote` registry kind, and the authorisation enumeration test treats
// an unregistered `*Id` field as a build failure — so the name is the
// thing that makes every procedure below actually get probed.
import { z } from 'zod';

import { id, MAX_NOTE_TEXT, paginationCursor, strictObject } from './primitives.ts';

/**
 * The note body. Bounded by `MAX_NOTE_TEXT` — DB§2 leaves `body text`
 * unbounded at the database, so this cap is the only thing between a coach
 * and an unbounded write. Trimmed and non-empty: a note that renders as
 * blank space is a row nobody can find and nobody can act on.
 */
const noteBody = z.string().trim().min(1).max(MAX_NOTE_TEXT);

// `./limits.ts` owns `MAX_PAGE_SIZE`/`DEFAULT_PAGE_SIZE`, and a router
// schema module may import only `zod` and `./primitives.ts`
// (`__tests__/layout.test.ts`) — so the numbers are restated here exactly
// as `coach.ts` and `exercises.ts` restate them. Keep them in step by hand.
const MAX_NOTES_PAGE_SIZE = 100;
const DEFAULT_NOTES_PAGE_SIZE = 30;

/**
 * A fixed format bound, not a product one — an ISO 8601 instant is ~30
 * characters and never more. `primitives.paginationCursor` itself carries
 * no `.max()`, so the cap is applied here, at the one place the cursor
 * becomes reachable from an input schema (`__tests__/conventions.test.ts`'s
 * rule: an unbounded string is a bound the schema failed to set).
 */
const MAX_CURSOR = 40;

/**
 * `notes.listForClient` — every live note this coach has written about this
 * client, newest first.
 *
 * Keyset-paginated on `created_at` (DB§22 bans `OFFSET` on a list that
 * grows), using the package's own `paginationCursor` shape. No search and
 * no filter: §8.3 asks for a list and a pin, and a notes-search feature is
 * a different task.
 */
export const listForClientInput = strictObject({
  clientId: id,
  cursor: paginationCursor.max(MAX_CURSOR).optional(),
  limit: z.number().int().min(1).max(MAX_NOTES_PAGE_SIZE).default(DEFAULT_NOTES_PAGE_SIZE),
});
export type ListForClientInput = z.infer<typeof listForClientInput>;

/**
 * `notes.create`. No `coachId` field, deliberately — authorship comes from
 * the session (`CLAUDE.md` §6.2, `03-owns-resource.md` step 4), and an
 * input field for it would be the leak itself. No `isPinned` either:
 * pinning is `setPinned`, so there is one place that decides what pinned
 * means.
 */
export const createNoteInput = strictObject({
  clientId: id,
  body: noteBody,
});
export type CreateNoteInput = z.infer<typeof createNoteInput>;

/** `notes.update` — the body and nothing else. Moving a note between clients is not a thing. */
export const updateNoteInput = strictObject({
  coachNoteId: id,
  body: noteBody,
});
export type UpdateNoteInput = z.infer<typeof updateNoteInput>;

/** `notes.delete` — soft, per DB§2. */
export const deleteNoteInput = strictObject({
  coachNoteId: id,
});
export type DeleteNoteInput = z.infer<typeof deleteNoteInput>;

/**
 * `notes.setPinned`. An explicit boolean rather than a toggle: a toggle
 * applied twice by a flaky connection lands back where it started, and the
 * coach cannot tell which state they are in.
 */
export const setPinnedInput = strictObject({
  coachNoteId: id,
  isPinned: z.boolean(),
});
export type SetPinnedInput = z.infer<typeof setPinnedInput>;

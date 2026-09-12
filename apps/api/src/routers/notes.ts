import { schema } from '@coachos/db';
import { notes as notesSchemas } from '@coachos/schemas';
import { and, desc, eq, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';

import { appError } from '../lib/app-error.ts';
import { router } from '../trpc/init.ts';
import { coachProcedure, ownsResource } from '../trpc/procedures.ts';

// `notes.*` — a coach's private notes about one client
// (`phase-10-coach-review-surfaces/coach-notes/01`), and the first real
// consumer of the `coachNote` ownership kind
// (`../trpc/authz/resource-registry.ts`), which P02 seeded sixteen phases
// early with no client-side branch at all.
//
// Three properties hold across every procedure here, and none of them is
// incidental:
//
//   1. **`coachProcedure`, always.** `identity.coach_client_notes` carries
//      an in-line "never exposed to the client" warning in the schema
//      itself (DB§5.1). There is no shared or client-facing procedure in
//      this file and there must never be one.
//   2. **A note is private to the coach who WROTE it**, not to the
//      client's coach (DB§5.4). `ownsResource('coachNote', …)` resolves
//      exactly that — `coach_client_notes.coach_id = the caller` — so
//      `update`/`setPinned`/`delete` need no second check. `listForClient`
//      is the one that does, because its guard is over the CLIENT, which
//      is a different condition (the same re-statement, for the same
//      reason, as `features/coach/client-overview.ts`'s `pinnedNotesQuery`).
//   3. **`.output()` on everything.** The router README makes a gate
//      mandatory for this table — the second lock behind explicit column
//      mapping, so a column added by a later migration cannot become a
//      disclosure with no code change.
//
// The *pinned* read on the client Overview screen is NOT here: it belongs
// to `coach.clients.overview` (`pinnedNotesQuery`), and duplicating it
// would mean two queries for one list and two places to change when
// pinning changes.

/**
 * The projection every procedure returns. Aliased in the `select` itself,
 * so the row Drizzle hands back already *is* the wire shape — no spread
 * anywhere in this file (router README: a spread turns the next migration
 * into a disclosure). `coach_id` and `deleted_at` are absent on purpose:
 * the first is always the caller's own and says nothing the caller needs,
 * the second is bookkeeping.
 */
const noteColumns = {
  noteId: schema.coachClientNotes.id,
  clientId: schema.coachClientNotes.clientId,
  body: schema.coachClientNotes.body,
  isPinned: schema.coachClientNotes.isPinned,
  createdAt: schema.coachClientNotes.createdAt,
  updatedAt: schema.coachClientNotes.updatedAt,
};

// Lives next to the router, never in `packages/schemas` — the mobile
// client imports that package and has no business validating a response it
// didn't send (router README).
const noteOutput = z.object({
  noteId: z.string(),
  clientId: z.string(),
  body: z.string(),
  isPinned: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const notePageOutput = z.object({
  items: z.array(noteOutput),
  nextCursor: z.string().nullable(),
});

const deletedOutput = z.object({ noteId: z.string() });

/**
 * The answer when the guard passed but the row is no longer live.
 * `ownsResource` deliberately evaluates ownership ignoring `deleted_at`
 * (`03-owns-resource.md` step 6), so a note the coach deleted on another
 * device reaches the resolver. Step 2 fixes the response: byte-identical to
 * the guard's own refusal, so "yours but gone" and "never existed" can
 * never be told apart.
 */
function noteGone(): never {
  throw appError('NOT_YOUR_CLIENT', "We couldn't find that.", {});
}

export const notesRouter = router({
  listForClient: coachProcedure
    .input(notesSchemas.listForClientInput)
    .use(ownsResource('client', (i: { clientId: string }) => i.clientId))
    .output(notePageOutput)
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select(noteColumns)
        .from(schema.coachClientNotes)
        .where(
          and(
            // Property 2 — the guard above checked the CLIENT, not the
            // authorship. A root coach opening an assistant's client must
            // see their own notes and none of the assistant's (§2).
            eq(schema.coachClientNotes.coachId, ctx.user.coachProfileId),
            eq(schema.coachClientNotes.clientId, input.clientId),
            isNull(schema.coachClientNotes.deletedAt),
            input.cursor
              ? lt(schema.coachClientNotes.createdAt, new Date(input.cursor))
              : undefined,
          ),
        )
        // `id` is a UUIDv7 (DB§2), so it breaks a `created_at` tie in the
        // same direction the timestamp would have — the render order stays
        // deterministic even for two notes written in one transaction.
        .orderBy(desc(schema.coachClientNotes.createdAt), desc(schema.coachClientNotes.id))
        .limit(input.limit);

      const last = rows[rows.length - 1];
      return {
        items: rows,
        // A short page is the last page — issuing a cursor for one costs
        // the client a round trip to learn nothing.
        nextCursor: rows.length === input.limit && last ? last.createdAt.toISOString() : null,
      };
    }),

  create: coachProcedure
    .input(notesSchemas.createNoteInput)
    .use(ownsResource('client', (i: { clientId: string }) => i.clientId))
    .output(noteOutput)
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(schema.coachClientNotes)
        .values({
          // From the session, never from input — there is no `coachId`
          // field on `createNoteInput` for exactly this reason.
          coachId: ctx.user.coachProfileId,
          clientId: input.clientId,
          body: input.body,
        })
        .returning(noteColumns);
      if (!row) throw new Error('insert into identity.coach_client_notes returned no row');
      return row;
    }),

  update: coachProcedure
    .input(notesSchemas.updateNoteInput)
    .use(ownsResource('coachNote', (i: { coachNoteId: string }) => i.coachNoteId))
    .output(noteOutput)
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(schema.coachClientNotes)
        // No `updatedAt` here — migration 0021's `touch_updated_at` trigger
        // owns that column for this table, and setting it in two places is
        // how the two disagree.
        .set({ body: input.body })
        .where(
          and(
            eq(schema.coachClientNotes.id, input.coachNoteId),
            isNull(schema.coachClientNotes.deletedAt),
          ),
        )
        .returning(noteColumns);
      return row ?? noteGone();
    }),

  setPinned: coachProcedure
    .input(notesSchemas.setPinnedInput)
    .use(ownsResource('coachNote', (i: { coachNoteId: string }) => i.coachNoteId))
    .output(noteOutput)
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .update(schema.coachClientNotes)
        .set({ isPinned: input.isPinned })
        .where(
          and(
            eq(schema.coachClientNotes.id, input.coachNoteId),
            isNull(schema.coachClientNotes.deletedAt),
          ),
        )
        .returning(noteColumns);
      return row ?? noteGone();
    }),

  // Soft delete, per DB§2's universal convention — never a hard delete.
  //
  // Idempotent, unlike `update`/`setPinned`: deleting an already-deleted
  // note is the outcome the caller asked for, and a double-tapped button on
  // a slow connection must not produce an error for work that is already
  // done. `deleted_at` is left at the FIRST delete's instant rather than
  // overwritten, so the retention clock is not restarted by a retry.
  delete: coachProcedure
    .input(notesSchemas.deleteNoteInput)
    .use(ownsResource('coachNote', (i: { coachNoteId: string }) => i.coachNoteId))
    .output(deletedOutput)
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(schema.coachClientNotes)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(schema.coachClientNotes.id, input.coachNoteId),
            isNull(schema.coachClientNotes.deletedAt),
          ),
        );
      return { noteId: input.coachNoteId };
    }),
});

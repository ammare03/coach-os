import { schema } from '@coachos/db';
import { me as meSchemas, paginationInput } from '@coachos/schemas';
import { and, desc, eq, lt } from 'drizzle-orm';

import { cancelDeletion } from '../features/me/cancel-deletion.ts';
import { getMe } from '../features/me/get-me.ts';
import { requestDeletion } from '../features/me/request-deletion.ts';
import { updateMe } from '../features/me/update-me.ts';
import { updatePreferences } from '../features/me/update-preferences.ts';
import { appError } from '../lib/app-error.ts';
import { getSignedDownloadUrl } from '../lib/storage/r2-client.ts';
import { EXPORT_ROW_COUNT_KEYS } from '../services/export/manifest.ts';
import { requestExport } from '../services/export/request.ts';
import { router } from '../trpc/init.ts';
import { protectedProcedure } from '../trpc/procedures.ts';

export const meRouter = router({
  // `01` — no `ownsResource` needed: a user always owns their own record by
  // definition (this task's Interfaces section).
  get: protectedProcedure.query(({ ctx }) => getMe(ctx.db, ctx.user.id)),

  // `01` — the allowlist lives in `updateMeInput` (`packages/schemas/src/me.ts`);
  // this procedure never accepts a wider shape than that schema admits.
  update: protectedProcedure
    .input(meSchemas.updateMeInput)
    .mutation(({ ctx, input }) => updateMe(ctx.db, ctx.user.id, input)),

  // `02` — the two `users` opt-out booleans plus a partial notification-
  // preference upsert, one transaction (`update-preferences.ts`'s own doc
  // comment).
  updatePreferences: protectedProcedure
    .input(meSchemas.updatePreferencesInput)
    .mutation(async ({ ctx, input }) => {
      await updatePreferences(ctx.db, ctx.user.id, input);
      return { success: true } as const;
    }),

  // `03` — no input: identity and email both come from `ctx.user`, never a
  // caller-supplied id (§21.4: no email input is required to delete).
  requestDeletion: protectedProcedure.mutation(({ ctx }) =>
    requestDeletion(ctx.db, ctx, ctx.user.id, ctx.user.email, ctx.user.timezone),
  ),

  // `03` — the recovery path, reached identically from the email link or
  // directly in the app.
  cancelDeletion: protectedProcedure.mutation(async ({ ctx }) => {
    await cancelDeletion(ctx.db, ctx, ctx.user.id);
    return { success: true } as const;
  }),

  // `10` — no input beyond the caller's own identity: this is the self-
  // service path only. Deliberately available whether or not `03`'s
  // deletion grace period is active (Approach step 5) — nothing here reads
  // `deletion_requests`, so it can't accidentally gate on it.
  requestExport: protectedProcedure.mutation(({ ctx }) => requestExport(ctx.db, ctx, ctx.user.id)),

  // `10` — `NOT_FOUND`, never `FORBIDDEN`, for another user's exportId
  // (`security-and-privacy` skill §1 — an unauthorised read never confirms
  // the resource exists). A plain `userId` equality check, not
  // `ownsResource`: this is "is this MY OWN row", not a coach/client
  // cross-boundary case that middleware exists for.
  exportStatus: protectedProcedure
    .input(meSchemas.exportStatusInput)
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(schema.exportRequests)
        .where(
          and(
            eq(schema.exportRequests.id, input.exportId),
            eq(schema.exportRequests.userId, ctx.user.id),
          ),
        );
      if (!row) {
        throw appError('EXPORT_NOT_FOUND', "We couldn't find that export.", {});
      }

      // Real progress from row counts already written by the still-running
      // job (`../jobs/data-export.ts`'s `reportProgress`), never an
      // indeterminate spinner (Approach step 6).
      const progressPercent =
        row.status === 'ready'
          ? 100
          : row.status === 'queued'
            ? 0
            : Math.round(
                (Object.keys((row.rowCounts as Record<string, number> | null) ?? {}).length /
                  EXPORT_ROW_COUNT_KEYS.length) *
                  100,
              );

      return { ...row, progressPercent };
    }),

  // `10`/`11` — a fresh, short-lived signed URL for a ready archive.
  // Minted on demand rather than stored: `security-and-privacy` skill §4's
  // ≤1h ceiling means any URL saved on the row would already be stale by
  // the time a client asks for it. Same ownership check as `exportStatus`,
  // never `ownsResource` — this is "my own row", not a cross-boundary case.
  // Returns `downloadUrl: null` rather than an error for a not-yet-ready
  // row — the UI only ever calls this once it already knows the status is
  // `ready`, so this is a defensive guard, not a real user-facing state.
  exportDownloadUrl: protectedProcedure
    .input(meSchemas.exportStatusInput)
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(schema.exportRequests)
        .where(
          and(
            eq(schema.exportRequests.id, input.exportId),
            eq(schema.exportRequests.userId, ctx.user.id),
          ),
        );
      if (!row) {
        throw appError('EXPORT_NOT_FOUND', "We couldn't find that export.", {});
      }
      if (row.status !== 'ready' || !row.objectKey) {
        return { downloadUrl: null };
      }
      const downloadUrl = await getSignedDownloadUrl(row.objectKey, 3600);
      return { downloadUrl };
    }),

  // `10` — the caller's own export history, most recent first. `api-
  // conventions` §6's cursor shape; volume per user is naturally small
  // (rate-limited to one completion per day), but the pattern stays
  // consistent rather than special-cased to `OFFSET` for "this one's small".
  exportHistory: protectedProcedure.input(paginationInput).query(async ({ ctx, input }) => {
    const rows = await ctx.db
      .select()
      .from(schema.exportRequests)
      .where(
        and(
          eq(schema.exportRequests.userId, ctx.user.id),
          input.cursor ? lt(schema.exportRequests.createdAt, new Date(input.cursor)) : undefined,
        ),
      )
      .orderBy(desc(schema.exportRequests.createdAt))
      .limit(input.limit);

    const nextCursor =
      rows.length === input.limit ? (rows[rows.length - 1]?.createdAt.toISOString() ?? null) : null;
    return { items: rows, nextCursor };
  }),
});

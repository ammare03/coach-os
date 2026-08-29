import { me as meSchemas } from '@coachos/schemas';

import { cancelDeletion } from '../features/me/cancel-deletion.ts';
import { getMe } from '../features/me/get-me.ts';
import { requestDeletion } from '../features/me/request-deletion.ts';
import { updateMe } from '../features/me/update-me.ts';
import { updatePreferences } from '../features/me/update-preferences.ts';
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
});

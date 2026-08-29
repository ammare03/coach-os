import { schema, type DbClient } from '@coachos/db';
import { eq } from 'drizzle-orm';

import { ME_PROFILE_COLUMNS, type MeProfile } from './get-me.ts';

/**
 * Mirrors `packages/schemas/src/me.ts`'s `updateMeInput` exactly — that
 * schema is the enforcement point (this task's Risks section: no code path
 * here can touch `email` or `role`, since neither is a parameter of either
 * type). Every field optional: only the keys the caller actually sent are
 * present, so `.set(input)` below updates exactly those columns and leaves
 * the rest untouched.
 */
export interface UpdateMeInput {
  name?: string | undefined;
  timezone?: string | undefined;
  locale?: string | undefined;
  avatarAssetId?: string | null | undefined;
}

export async function updateMe(
  db: DbClient,
  userId: string,
  input: UpdateMeInput,
): Promise<MeProfile> {
  const [row] = await db
    .update(schema.users)
    .set(input)
    .where(eq(schema.users.id, userId))
    .returning(ME_PROFILE_COLUMNS);

  // Same unreachable-in-practice race as `get-me.ts` — the row existed when
  // `isAuthed` resolved `ctx.user` for this same request.
  if (!row) {
    throw new Error(`me.update: authenticated user ${userId} row not found`);
  }
  return row;
}

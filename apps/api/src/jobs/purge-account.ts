// `account-lifecycle/04` — the DB§19.2 transactional purge. The single
// highest-consequence procedure in this product: irreversible, and wrong
// in either direction (leaving data behind, or deleting the wrong thing)
// is a real harm. Read DATABASE.md DB§19.2 before touching this file.
import { createHash } from 'node:crypto';

import { schema, type DbClient } from '@coachos/db';
import { and, eq } from 'drizzle-orm';

import { deleteR2Objects } from '../lib/storage/r2-client.ts';

// DEFERRED — DB§19.2 steps 7 and 8 touch tables that don't exist in this
// codebase yet: `platform.moderation_actions` belongs to
// `phase-26-trust-and-safety` (unbuilt), and `platform.export_requests` is
// built by this same feature's own tasks 09/10, which run after this one.
// Both MUST extend this function once their tables land — tracked in
// docs/UNFORGET.md so this isn't silently forgotten past ship gate 1.
// `reports`/`blocks` (also phase-26) are the same story, not separately
// called out since DB§19.2 doesn't number them as their own step.

function hashUserId(userId: string): string {
  // SHA-256 hex, same pattern as `../features/auth/password-reset.ts`'s
  // local `hashEmail` — a stable, one-way identifier for compliance
  // evidence, never reversible back to the raw id from the stored value
  // alone.
  return createHash('sha256').update(userId).digest('hex');
}

async function collectMediaAssetKeys(db: DbClient, userId: string): Promise<string[]> {
  const rows = await db
    .select({
      storageKey: schema.mediaAssets.storageKey,
      thumbnailKey: schema.mediaAssets.thumbnailKey,
    })
    .from(schema.mediaAssets)
    .where(eq(schema.mediaAssets.ownerUserId, userId));

  const keys: string[] = [];
  for (const row of rows) {
    keys.push(row.storageKey);
    if (row.thumbnailKey) keys.push(row.thumbnailKey);
  }
  return keys;
}

/**
 * DB§19.2's exact order, executed here as:
 *
 * - **Step 1 (R2)** — outside the transaction, before it starts. Object
 *   storage deletion cannot participate in Postgres's atomicity (Approach
 *   step 2), so the order is deliberate: delete the objects first, then
 *   the rows that pointed at them. A crash between the two leaves at worst
 *   a database row that no longer resolves to real bytes — safe, and
 *   self-healing on retry — never the reverse (orphaned R2 objects with no
 *   row left to ever find them again).
 *
 * - **Steps 2-5** collapse into one `DELETE FROM identity.users`. Every
 *   table those steps name — every `coaching.*`, `nutrition.*`, and
 *   `training.*` row this user or their profiles own — cascades from
 *   `coach_profiles`/`client_profiles`, which themselves cascade from
 *   `users` (verified against each table's actual `onDelete` behaviour in
 *   its own schema file, not assumed from memory — this task's own Risks
 *   section). The one deliberate exception is `client_profiles.coach_id`
 *   (`ON DELETE RESTRICT`, `identity-schema/03`): the database itself
 *   refuses to purge a coach who still has clients. That is correct
 *   behaviour, not a bug this function should route around — detaching a
 *   coach's clients first is `account-lifecycle/05`'s job, not this one's.
 *
 * - **Step 9 (foods)** and **step 6 (audit log)** both run inside the
 *   transaction, before the `DELETE`, because both need something that
 *   delete destroys: step 9's `WHERE created_by_user_id = userId` (that FK
 *   is `ON DELETE SET NULL` — it would erase the very column this query
 *   filters on), and step 6's hash needs the raw id while it still exists.
 *
 * - **Step 6, the mechanism.** `platform.audit_log` carries an
 *   `audit_log_no_update` RULE (DB§8.3, migrations/0019_audit_log.sql) that
 *   narrowly permits only the FK's own `actor_user_id -> NULL` shape and
 *   silently blocks every other `UPDATE` — including one that only
 *   touches `metadata`. That was discovered live building this task, not
 *   designed around in advance: it rules out "stamp a hash onto this
 *   user's existing audit_log rows" entirely. This function instead
 *   inserts one new summary row with `actorUserId: userId` — not `null` —
 *   so the *same* FK action that nulls every one of this user's historical
 *   rows nulls this one too, uniformly, when the `DELETE` runs later in
 *   this same transaction. The hash lives in `metadata`, never in
 *   `targetId` (which has no FK and would otherwise survive as a
 *   permanent, unhashed pointer back to the deleted user).
 */
export async function purgeAccount(db: DbClient, userId: string): Promise<void> {
  const mediaKeys = await collectMediaAssetKeys(db, userId);
  await deleteR2Objects(mediaKeys);

  await db.transaction(async (tx) => {
    // Step 9 — verified foods are excluded; they're reference data once
    // promoted (DB§19.2's own note), and renaming one would degrade the
    // shared library for every coach and client using it.
    await tx
      .update(schema.foods)
      .set({ name: 'Custom food', brand: null })
      .where(and(eq(schema.foods.createdByUserId, userId), eq(schema.foods.isVerified, false)));

    // Step 6.
    await tx.insert(schema.auditLog).values({
      actorUserId: userId,
      action: 'account.purged',
      targetType: 'user',
      metadata: { purgedUserIdHash: hashUserId(userId) },
    });

    // Steps 2-5 — see this function's own doc comment.
    await tx.delete(schema.users).where(eq(schema.users.id, userId));
  });
}

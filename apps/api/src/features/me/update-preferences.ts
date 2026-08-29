import { schema, type DbClient } from '@coachos/db';
import { eq, sql } from 'drizzle-orm';

export interface NotificationPreferenceUpdate {
  channel: 'push' | 'email';
  type: string;
  enabled: boolean;
}

/**
 * Mirrors `packages/schemas/src/me.ts`'s `updatePreferencesInput` — every
 * field optional (`account-lifecycle/02` Approach step 3: a caller changes
 * one thing without resending the rest).
 */
export interface UpdatePreferencesInput {
  analyticsOptOut?: boolean | undefined;
  aiProcessingOptOut?: boolean | undefined;
  notifications?: NotificationPreferenceUpdate[] | undefined;
}

/**
 * Updates the two `identity.users` opt-out booleans directly, and upserts
 * `platform.notification_preferences` rows against their composite primary
 * key `(user_id, channel, type)` (DB§5.8) — never a delete-then-insert,
 * which would momentarily leave a row missing (and therefore defaulting to
 * `enabled = true`) for another request racing this one.
 *
 * Both writes share one transaction (`code-conventions` §7) even though
 * neither depends on the other's result — a partial write here would leave
 * `analyticsOptOut` toggled but a notification preference silently
 * unchanged, or vice versa, with no way for the caller to tell which half
 * landed.
 */
export async function updatePreferences(
  db: DbClient,
  userId: string,
  input: UpdatePreferencesInput,
): Promise<void> {
  await db.transaction(async (tx) => {
    const userUpdates: Partial<typeof schema.users.$inferInsert> = {};
    if (input.analyticsOptOut !== undefined) {
      userUpdates.analyticsOptOut = input.analyticsOptOut;
    }
    if (input.aiProcessingOptOut !== undefined) {
      userUpdates.aiProcessingOptOut = input.aiProcessingOptOut;
    }
    if (Object.keys(userUpdates).length > 0) {
      await tx.update(schema.users).set(userUpdates).where(eq(schema.users.id, userId));
    }

    if (input.notifications && input.notifications.length > 0) {
      // One multi-row upsert, not a query per tuple (`code-conventions` §7:
      // "no query inside a loop") — `excluded.enabled` is the row Postgres
      // was about to insert before the conflict, so each row's own
      // `enabled` value wins on its own conflict, not the last row's.
      await tx
        .insert(schema.notificationPreferences)
        .values(
          input.notifications.map((pref) => ({
            userId,
            channel: pref.channel,
            type: pref.type,
            enabled: pref.enabled,
          })),
        )
        .onConflictDoUpdate({
          target: [
            schema.notificationPreferences.userId,
            schema.notificationPreferences.channel,
            schema.notificationPreferences.type,
          ],
          set: { enabled: sql`excluded.enabled` },
        });
    }
  });
}

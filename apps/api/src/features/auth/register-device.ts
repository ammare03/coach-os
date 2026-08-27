// Creates or reuses the `identity.devices` row for a sign-in (`03`'s
// Approach step 5). DB§5.1 gives `devices` no client-supplied install
// identifier — its only unique constraint is `(user_id, expo_push_token)`,
// null until P15 — so the server owns device identity, not the client.
import { schema, type DbClient, type Device } from '@coachos/db';
import { and, eq } from 'drizzle-orm';

export interface RegisterDeviceInput {
  userId: string;
  deviceId?: string | undefined;
  platform: 'ios' | 'android' | 'web';
  appVersion?: string | undefined;
  osVersion?: string | undefined;
}

/**
 * A `deviceId` is trusted only if the row exists AND belongs to this user
 * — never a client-supplied id that happens to resolve to someone else's
 * device (`03`'s flow diagram). Any other case — omitted, unknown, or
 * belonging to another user — creates a fresh row rather than erroring,
 * since a reinstall or a first sign-in are both ordinary, not failures.
 */
export async function registerDevice(db: DbClient, input: RegisterDeviceInput): Promise<Device> {
  if (input.deviceId) {
    const [existing] = await db
      .select()
      .from(schema.devices)
      .where(and(eq(schema.devices.id, input.deviceId), eq(schema.devices.userId, input.userId)))
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(schema.devices)
        .set({
          lastSeenAt: new Date(),
          appVersion: input.appVersion ?? existing.appVersion,
          osVersion: input.osVersion ?? existing.osVersion,
        })
        .where(eq(schema.devices.id, existing.id))
        .returning();
      if (!updated) throw new Error('update to identity.devices did not return a row');
      return updated;
    }
  }

  const [created] = await db
    .insert(schema.devices)
    .values({
      userId: input.userId,
      platform: input.platform,
      appVersion: input.appVersion,
      osVersion: input.osVersion,
    })
    .returning();
  if (!created) throw new Error('insert into identity.devices did not return a row');
  return created;
}

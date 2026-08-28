// Both `auth.requestReset` and `auth.resetPassword` procedure bodies
// (`06`), kept out of the router so `routers/auth.ts` stays thin.
import { createHash } from 'node:crypto';

import { schema, type DbClient } from '@coachos/db';
import { and, eq, isNull } from 'drizzle-orm';

import { env } from '../../env.ts';
import { appError } from '../../lib/app-error.ts';
import { writeAuditLog } from '../../lib/audit-log.ts';
import { hashPassword } from '../../lib/auth/password.ts';
import { consumeResetToken, issueResetToken, storeResetToken } from '../../lib/auth/reset-token.ts';
import { sendEmail } from '../../lib/email/client.ts';
import { PasswordResetEmail } from '../../lib/email/templates/password-reset.ts';
import { keys } from '../../lib/redis-keys.ts';
import type { Context } from '../../trpc/context.ts';
import { enforceRateLimit } from '../../trpc/middleware/rate-limit.ts';

import { revokeAllFamiliesForUser } from './revoke-family.ts';

const RESET_RATE_LIMIT = { windowSeconds: 15 * 60, max: 3 };

function hashEmail(email: string): string {
  return createHash('sha256').update(email).digest('hex');
}

/**
 * Returns the identical shape whether or not `email` has an account, in
 * identical time — the response is a function of input validity only
 * (`06`'s Approach step 1). The rate limit below is checked
 * unconditionally, before the existence check, for the same reason: if it
 * only applied to real accounts, hitting it would itself be an
 * enumeration oracle.
 */
export async function requestReset(
  db: DbClient,
  ctx: Pick<Context, 'user' | 'request'>,
  email: string,
): Promise<void> {
  const rateLimitKey = keys.rateLimitResetEmail(hashEmail(email));
  await enforceRateLimit(rateLimitKey, RESET_RATE_LIMIT.max);

  const [user] = await db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.email, email), isNull(schema.users.deletedAt)));

  if (!user) {
    return;
  }

  // Off the response path, deliberately unawaited (`06`'s Approach step
  // 1) — hashing, the Redis write, and the Resend call all take real time,
  // and awaiting any of them here would make "account exists" measurably
  // slower than "account doesn't", the same class of leak task 02's dummy
  // hash verification exists to close.
  void sendResetEmail(db, ctx, user.id, email).catch(() => {
    // `sendResetEmail` already logs its own failure; this exists only so
    // an unhandled-rejection warning doesn't appear for work the caller
    // was never going to await the result of.
  });
}

async function sendResetEmail(
  db: DbClient,
  ctx: Pick<Context, 'user' | 'request'>,
  userId: string,
  email: string,
): Promise<void> {
  const { token, tokenHash } = issueResetToken();
  await storeResetToken(tokenHash, userId);

  await db.transaction((tx) =>
    writeAuditLog(tx, ctx, {
      action: 'auth.reset.requested',
      targetType: 'user',
      targetId: userId,
      actorUserId: userId,
    }),
  );

  const resetUrl = `${env.APP_PUBLIC_URL}/reset-password/${token}`;
  await sendEmail({
    to: email,
    subject: 'Reset your CoachOS password',
    react: PasswordResetEmail({ resetUrl }),
  });
}

function invalidResetToken() {
  return appError('AUTH_REQUIRED', 'This reset link is invalid or has expired.', {});
}

/**
 * Exchanges a token for a new password. `consumeResetToken`'s `GETDEL` is
 * what makes two concurrent submissions of the same token safe — exactly
 * one observes the `userId` and proceeds (`06`'s Approach step 3).
 */
export async function resetPassword(
  db: DbClient,
  ctx: Pick<Context, 'user' | 'request'>,
  token: string,
  newPassword: string,
): Promise<void> {
  const userId = await consumeResetToken(token);
  if (!userId) {
    throw invalidResetToken();
  }

  const passwordHash = await hashPassword(newPassword);

  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(schema.users)
      .set({ passwordHash })
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
      .returning({ id: schema.users.id });

    if (rows.length === 0) {
      // The account was soft-deleted between the token being issued and
      // consumed — the token is already gone (GETDEL above), so there is
      // nothing left to roll back, only a write that must not happen.
      return false;
    }

    await writeAuditLog(tx, ctx, {
      action: 'auth.reset.complete',
      targetType: 'user',
      targetId: userId,
      actorUserId: userId,
    });
    return true;
  });

  if (!updated) {
    throw invalidResetToken();
  }

  // After the commit, not inside it — the password-update transaction
  // stays short, and a revocation that rolled back with the password
  // change would leave the user unable to explain why they're still
  // signed in elsewhere (`06`'s Approach step 4).
  await revokeAllFamiliesForUser(db, ctx, userId, 'password_reset');
}

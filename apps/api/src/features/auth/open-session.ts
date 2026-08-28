// Shared by `signUp` and `signIn` (and, later, social sign-in and invite
// acceptance): register the device, mint an access token, open a refresh
// token family, and populate the session cache. Not itself a task
// deliverable named in `02`/`03`/`04`'s file tables — those name the pieces
// this composes (`register-device.ts`, `access-token.ts`,
// `refresh-token.ts`, `session-cache.ts`); this exists so `signUp` and
// `signIn` don't each repeat the same five-step composition.
import { schema, type DbClient } from '@coachos/db';

import { writeAuditLog } from '../../lib/audit-log.ts';
import { issueAccessToken } from '../../lib/auth/access-token.ts';
import { issueRefreshToken } from '../../lib/auth/refresh-token.ts';
import { writeSessionCache } from '../../lib/auth/session-cache.ts';
import type { Context } from '../../trpc/context.ts';

import { registerDevice, type RegisterDeviceInput } from './register-device.ts';

export interface OpenSessionInput {
  userId: string;
  role: 'coach' | 'client' | 'assistant';
  name: string;
  timezone: string;
  locale: string;
  onboardingCompletedAt: Date | null;
  coachProfileId: string | null;
  clientProfileId: string | null;
  device: Omit<RegisterDeviceInput, 'userId'>;
  /**
   * The `audit_log` action this session-open is recorded under, or `null`
   * to skip writing one. `signIn` passes `'auth.signin'` — nothing else
   * has recorded this event yet. `signUp` passes `null`: `createCoachAccount`
   * already wrote `'auth.signup'` atomically with the account's own
   * creation (`02`'s Approach step 5), and a second row here would double
   * up the one event `02`'s AC list expects.
   */
  auditAction: string | null;
}

export interface OpenedSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  deviceId: string;
  user: {
    id: string;
    role: 'coach' | 'client' | 'assistant';
    name: string;
    timezone: string;
    onboardingCompletedAt: Date | null;
  };
}

export async function openSession(
  db: DbClient,
  ctx: Pick<Context, 'user' | 'request'>,
  input: OpenSessionInput,
): Promise<OpenedSession> {
  const device = await registerDevice(db, { userId: input.userId, ...input.device });
  const accessToken = await issueAccessToken({
    userId: input.userId,
    role: input.role,
    deviceId: device.id,
  });
  const refresh = issueRefreshToken();

  // One short transaction: the refresh-token row and its audit record
  // commit together or not at all. No network call inside it (`04`'s Risks:
  // "one transaction, one connection" — the same rule applies here, this is
  // the same class of frequent, short write).
  await db.transaction(async (tx) => {
    await tx.insert(schema.refreshTokens).values({
      userId: input.userId,
      tokenHash: refresh.tokenHash,
      familyId: refresh.familyId,
      deviceId: device.id,
      expiresAt: refresh.expiresAt,
    });
    if (input.auditAction) {
      await writeAuditLog(tx, ctx, {
        action: input.auditAction,
        targetType: 'user',
        targetId: input.userId,
        actorUserId: input.userId,
      });
    }
  });

  // Best-effort, after the transaction commits — a cache write failing must
  // never roll back a real sign-in.
  await writeSessionCache(input.userId, device.id, {
    role: input.role,
    timezone: input.timezone,
    locale: input.locale,
    coachProfileId: input.coachProfileId,
    clientProfileId: input.clientProfileId,
  });

  return {
    accessToken: accessToken.token,
    refreshToken: refresh.token,
    expiresAt: accessToken.expiresAt,
    deviceId: device.id,
    user: {
      id: input.userId,
      role: input.role,
      name: input.name,
      timezone: input.timezone,
      onboardingCompletedAt: input.onboardingCompletedAt,
    },
  };
}

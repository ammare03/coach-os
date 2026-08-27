import { schema } from '@coachos/db';
import { auth as authSchemas } from '@coachos/schemas';
import { eq } from 'drizzle-orm';

import { createCoachAccount } from '../features/auth/create-coach-account.ts';
import { openSession } from '../features/auth/open-session.ts';
import { rotateRefreshToken } from '../features/auth/rotate-refresh-token.ts';
import { appError } from '../lib/app-error.ts';
import { writeAuditLog } from '../lib/audit-log.ts';
import {
  hashPassword,
  needsRehash,
  verifyDummyPassword,
  verifyPassword,
} from '../lib/auth/password.ts';
import { router } from '../trpc/init.ts';
import { authProcedure, publicProcedure } from '../trpc/procedures.ts';

// Filled by phase-03-identity-and-auth (auth-server). `signUp` and `signIn`
// land in `02`; `refresh` (`04`), `signOut`/`signOutAllDevices` (`05`), and
// `requestReset`/`resetPassword` (`06`) each add their own procedure here.
//
// Every procedure here (signIn, signUp, refresh, ...) must derive from
// `authProcedure` (`../trpc/procedures.ts`), never bare `publicProcedure` —
// that's what applies CLAUDE.md §6.5's 10/15min/IP throttle, shared across
// the whole group (`rate-limiting/03-per-route-config-and-429-handling.md`).

// A failed sign-in and "no valid session" (`../trpc/middleware/is-authed.ts`)
// deliberately share `AUTH_REQUIRED` — `02`'s Interfaces section is explicit
// that this task adds no new code, and `AUTH_REQUIRED` is the only catalogue
// entry mapped to `UNAUTHORIZED`. If `../auth-client/03-silent-refresh-and-replay.md`
// ever wires a generic "retry once on AUTH_REQUIRED" interceptor, it must
// scope that retry to `protectedProcedure` responses — retrying a rejected
// `auth.signIn` call makes no sense, there is no session to refresh.
const INVALID_CREDENTIALS_MESSAGE = 'Incorrect email or password.';

function invalidCredentials() {
  return appError('AUTH_REQUIRED', INVALID_CREDENTIALS_MESSAGE, {});
}

export const authRouter = router({
  // `auth.signUp` — coaches only (`02`'s "Why this exists"). `signUpInput`
  // has no `role` field for a caller to send; the account created here is
  // always `role: 'coach'`, enforced in `createCoachAccount`, not by an
  // input check.
  signUp: authProcedure.input(authSchemas.signUpInput).mutation(async ({ ctx, input }) => {
    const passwordHash = await hashPassword(input.password);

    // A duplicate email surfaces as a raw Postgres unique violation on
    // `users_email_unique` and is deliberately left uncaught here — the
    // request-wide `databaseErrorBoundary` (`../trpc/procedures.ts`) turns
    // it into the generic `UNKNOWN_CONFLICT`, with no table name, no
    // constraint name, and no confirmation the address exists (`02`'s
    // Approach step 6).
    const { user, coachProfile } = await ctx.db.transaction((tx) =>
      createCoachAccount(tx, ctx, {
        email: input.email,
        passwordHash,
        name: input.name,
        timezone: input.timezone,
      }),
    );

    return openSession(ctx.db, ctx, {
      userId: user.id,
      role: user.role,
      name: user.name,
      timezone: user.timezone,
      locale: user.locale,
      onboardingCompletedAt: user.onboardingCompletedAt,
      coachProfileId: coachProfile.id,
      clientProfileId: null,
      device: {
        deviceId: input.deviceId,
        platform: input.platform,
        appVersion: input.appVersion,
        osVersion: input.osVersion,
      },
      // `createCoachAccount` already wrote `'auth.signup'` atomically with
      // the account itself — no second row here.
      auditAction: null,
    });
  }),

  // `auth.signIn` — constant in shape, near-constant in time (`02`'s
  // Approach step 3). An unknown email, a wrong password, and a social-only
  // account presenting a password are indistinguishable in response body,
  // `cause.code`, and (because the dummy verification below always runs)
  // timing.
  signIn: authProcedure.input(authSchemas.signInInput).mutation(async ({ ctx, input }) => {
    const [user] = await ctx.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, input.email))
      .limit(1);

    async function logFailure(reason: string): Promise<never> {
      await ctx.db.transaction((tx) =>
        writeAuditLog(tx, ctx, {
          action: 'auth.signin.failed',
          metadata: { reason },
        }),
      );
      throw invalidCredentials();
    }

    if (!user || user.deletedAt || !user.passwordHash) {
      // Unknown email, soft-deleted user, and a social-only account (no
      // `password_hash` at all — `users_email_or_social`'s permitted shape,
      // `02`'s Approach step 4) all still pay the real Argon2id cost, so
      // none of the three is measurably faster than a genuine wrong
      // password.
      await verifyDummyPassword(input.password);
      return logFailure(!user ? 'unknown_email' : user?.deletedAt ? 'deleted_user' : 'social_only');
    }

    const valid = await verifyPassword(user.passwordHash, input.password);
    if (!valid) {
      return logFailure('wrong_password');
    }

    if (needsRehash(user.passwordHash)) {
      // The only moment a plaintext password is ever available — upgrade
      // now, in the same request, or a parameter change only applies to
      // accounts created after it (`02`'s Approach step 7).
      const rehashed = await hashPassword(input.password);
      await ctx.db
        .update(schema.users)
        .set({ passwordHash: rehashed })
        .where(eq(schema.users.id, user.id));
    }

    const [coachProfile] =
      user.role === 'coach'
        ? await ctx.db
            .select({ id: schema.coachProfiles.id })
            .from(schema.coachProfiles)
            .where(eq(schema.coachProfiles.userId, user.id))
            .limit(1)
        : [];
    const [clientProfile] =
      user.role === 'client'
        ? await ctx.db
            .select({ id: schema.clientProfiles.id })
            .from(schema.clientProfiles)
            .where(eq(schema.clientProfiles.userId, user.id))
            .limit(1)
        : [];

    return openSession(ctx.db, ctx, {
      userId: user.id,
      role: user.role,
      name: user.name,
      timezone: user.timezone,
      locale: user.locale,
      onboardingCompletedAt: user.onboardingCompletedAt,
      coachProfileId: coachProfile?.id ?? null,
      clientProfileId: clientProfile?.id ?? null,
      device: {
        deviceId: input.deviceId,
        platform: input.platform,
        appVersion: input.appVersion,
        osVersion: input.osVersion,
      },
      auditAction: 'auth.signin',
    });
  }),

  // Built on `publicProcedure`, not `authProcedure` — `04`'s Approach step
  // 5: refresh is rate-limited per family (`rotateRefreshToken` itself,
  // via `enforceRateLimit`), not per IP. It must also work with an absent
  // or expired access token; that's the whole point of the procedure.
  refresh: publicProcedure
    .input(authSchemas.refreshInput)
    .mutation(({ ctx, input }) => rotateRefreshToken(ctx.db, ctx, input.refreshToken)),
});

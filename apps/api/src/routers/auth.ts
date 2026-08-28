import { schema } from '@coachos/db';
import { auth as authSchemas } from '@coachos/schemas';
import { eq } from 'drizzle-orm';

import { evaluateSignupAge } from '../features/auth/age.ts';
import { completeSocialSignUp } from '../features/auth/complete-social-signup.ts';
import { createCoachAccount } from '../features/auth/create-coach-account.ts';
import { linkSocialProvider } from '../features/auth/link-social-provider.ts';
import { openSession } from '../features/auth/open-session.ts';
import { requestReset, resetPassword } from '../features/auth/password-reset.ts';
import { rotateRefreshToken } from '../features/auth/rotate-refresh-token.ts';
import { signOut, signOutAllDevices } from '../features/auth/sign-out.ts';
import { handleSocialSignIn } from '../features/auth/social-sign-in.ts';
import { appError } from '../lib/app-error.ts';
import { writeAuditLog } from '../lib/audit-log.ts';
import {
  hashPassword,
  needsRehash,
  verifyDummyPassword,
  verifyPassword,
} from '../lib/auth/password.ts';
import {
  verifyAppleIdentityToken,
  verifyGoogleIdToken,
} from '../lib/auth/provider-verification.ts';
import { router } from '../trpc/init.ts';
import { authProcedure, protectedProcedure, publicProcedure } from '../trpc/procedures.ts';

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

// `social-sign-in/01`, `/02` — the provider rejected the token, or
// `jwtVerify` did (bad signature, wrong aud/iss, expired, bad nonce).
// `verifyAppleIdentityToken`/`verifyGoogleIdToken` collapse every one of
// those into a `null` return (their own doc comments: a JWKS outage must
// not become a 500 in the sign-in path), so this is the one place that
// turns "null" into the catalogued client-facing code.
function socialTokenInvalid() {
  return appError('SOCIAL_TOKEN_INVALID', "We couldn't verify that sign-in. Try again.", {});
}

export const authRouter = router({
  // `auth.signUp` — coaches only (`02`'s "Why this exists"). `signUpInput`
  // has no `role` field for a caller to send; the account created here is
  // always `role: 'coach'`, enforced in `createCoachAccount`, not by an
  // input check.
  signUp: authProcedure.input(authSchemas.signUpInput).mutation(async ({ ctx, input }) => {
    // `07`'s rules table: under 13 is refused outright, 13-17 is refused
    // specifically because this procedure only ever creates a coach (the
    // 13-17 *client* path is `../invites/04-invite-acceptance.md`, a
    // different signup). Checked before any write, deliberately — a role
    // assigned before the age is known has to be revoked later.
    const ageOutcome = evaluateSignupAge(input.dateOfBirth);
    if (ageOutcome === 'AGE_BELOW_MINIMUM') {
      throw appError('AGE_BELOW_MINIMUM', 'You need to be at least 13 to use CoachOS.', {});
    }
    if (ageOutcome === 'COACH_MUST_BE_ADULT') {
      throw appError(
        'COACH_MUST_BE_ADULT',
        'Coach accounts are for adults only. You can still join as a client if a coach invites you.',
        {},
      );
    }

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
        dateOfBirth: input.dateOfBirth,
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

  // Public, not `authProcedure` — `05`'s Approach step 1: a caller whose
  // access token already expired still has a valid refresh token and
  // still needs the session ended. Requiring a live access token here
  // means the sign-out button fails for exactly the person who left the
  // app closed overnight. Always resolves — an unknown, malformed,
  // revoked, or expired token is not an error (`signOut`'s own doc
  // comment); the response never distinguishes them.
  signOut: publicProcedure.input(authSchemas.signOutInput).mutation(async ({ ctx, input }) => {
    await signOut(ctx.db, ctx, input.refreshToken);
    return { success: true } as const;
  }),

  // `protectedProcedure`, deliberately the opposite of `signOut` — ending
  // every session is high-consequence and has no expired-token case to
  // accommodate (the client can refresh first). Requiring a live access
  // token means a stolen refresh token alone can't log the real user out
  // of everything (`05`'s Approach step 1).
  signOutAllDevices: protectedProcedure.mutation(async ({ ctx }) => {
    await signOutAllDevices(ctx.db, ctx, ctx.user.id);
    return { success: true } as const;
  }),

  // `authProcedure` — the shared per-IP `auth.*` bucket still applies here
  // (`06` step 7: "an addition within §6.5's existing rule, not an
  // amendment to it"); `requestReset` itself adds a second, per-email
  // limit on top. Always returns the same shape — see `requestReset`'s own
  // doc comment for why.
  requestReset: authProcedure
    .input(authSchemas.requestResetInput)
    .mutation(async ({ ctx, input }) => {
      await requestReset(ctx.db, ctx, input.email);
      return { success: true } as const;
    }),

  resetPassword: authProcedure
    .input(authSchemas.resetPasswordInput)
    .mutation(async ({ ctx, input }) => {
      await resetPassword(ctx.db, ctx, input.token, input.newPassword);
      return { success: true } as const;
    }),

  // `social-sign-in/01` — `authProcedure`, same shared `auth.*` throttle as
  // `signIn`/`signUp` above (`procedures.ts`'s own comment: every new
  // `auth.*` procedure derives from this, or §6.5's row never actually
  // applies). Returns `{ kind: 'session', ... }` or
  // `{ kind: 'needsDateOfBirth', pendingSignupToken }` — never throws for a
  // genuinely new identity, only for a bad token or a collision.
  signInWithApple: authProcedure
    .input(authSchemas.signInWithAppleInput)
    .mutation(async ({ ctx, input }) => {
      const claim = await verifyAppleIdentityToken(input.identityToken, input.nonce);
      if (!claim) {
        throw socialTokenInvalid();
      }
      return handleSocialSignIn(ctx.db, ctx, claim, {
        deviceId: input.deviceId,
        platform: input.platform,
        appVersion: input.appVersion,
        osVersion: input.osVersion,
      });
    }),

  // `social-sign-in/02` — same shape as `signInWithApple` above.
  signInWithGoogle: authProcedure
    .input(authSchemas.signInWithGoogleInput)
    .mutation(async ({ ctx, input }) => {
      const claim = await verifyGoogleIdToken(input.idToken);
      if (!claim) {
        throw socialTokenInvalid();
      }
      return handleSocialSignIn(ctx.db, ctx, claim, {
        deviceId: input.deviceId,
        platform: input.platform,
        appVersion: input.appVersion,
        osVersion: input.osVersion,
      });
    }),

  // `social-sign-in/03` + Ammar's DOB-gate decision — the second step of a
  // brand-new social sign-up, once `pendingSignupToken` proves the identity
  // was already verified.
  completeSocialSignUp: authProcedure
    .input(authSchemas.completeSocialSignUpInput)
    .mutation(({ ctx, input }) =>
      completeSocialSignUp(ctx.db, ctx, {
        pendingSignupToken: input.pendingSignupToken,
        name: input.name,
        timezone: input.timezone,
        dateOfBirth: input.dateOfBirth,
        device: {
          deviceId: input.deviceId,
          platform: input.platform,
          appVersion: input.appVersion,
          osVersion: input.osVersion,
        },
      }),
    ),

  // `social-sign-in/03`'s collision-resolution path — `protectedProcedure`,
  // deliberately: the caller must already be signed in via their existing
  // method before this can run at all (`03`'s Risks: proof of ownership,
  // never an email match alone). `ctx.user.id` is the link target; nothing
  // here accepts a `userId` from the request body.
  linkAppleProvider: protectedProcedure
    .input(authSchemas.linkAppleProviderInput)
    .mutation(async ({ ctx, input }) => {
      const claim = await verifyAppleIdentityToken(input.identityToken, input.nonce);
      if (!claim) {
        throw socialTokenInvalid();
      }
      await linkSocialProvider(ctx.db, ctx.user.id, 'apple', claim.providerUid);
      return { success: true } as const;
    }),

  linkGoogleProvider: protectedProcedure
    .input(authSchemas.linkGoogleProviderInput)
    .mutation(async ({ ctx, input }) => {
      const claim = await verifyGoogleIdToken(input.idToken);
      if (!claim) {
        throw socialTokenInvalid();
      }
      await linkSocialProvider(ctx.db, ctx.user.id, 'google', claim.providerUid);
      return { success: true } as const;
    }),
});

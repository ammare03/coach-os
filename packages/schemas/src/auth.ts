// Input schemas for `auth.*` (signUp, signIn, refresh, signOut,
// requestReset, resetPassword). `auth-server/02` fills `signUpInput` and
// `signInInput`; `04` adds `refreshInput`; `05`/`06` add the rest. The
// output shapes these procedures return (`authSession`, `refreshOutput`)
// live in `./auth-session.ts`, not here — `layout.test.ts` holds every
// §6.1 input-schema module to importing nothing but `zod` and
// `./primitives.ts`, and `conventions.test.ts` walks every export of this
// module expecting caller input (strict, capped); an output shape belongs
// with `./pagination.ts`'s `pageOf()`, the one other schema this package
// exempts from both for the same reason.
import { z } from 'zod';

import { calendarDate, email, id, strictObject, timezone } from './primitives.ts';

/**
 * A minimum length only — `CLAUDE.md` has no stated composition policy
 * (no forced digit/symbol), which matches current NIST guidance that
 * composition rules push users toward predictable substitutions instead of
 * real entropy. The upper bound is defensive, not a UX opinion: Argon2id's
 * cost scales with input size, and an unbounded password is a way to make
 * one request expensive to hash.
 */
export const password = z.string().min(8).max(256);

/**
 * Carried by every procedure that opens a session (`signUp`, `signIn`, and
 * later `refresh` continuing the same device) — `03`'s device-identity flow
 * needs `deviceId` (omitted on a device's first sign-in) and `platform` on
 * every call; `appVersion`/`osVersion` are informational only. Not
 * `strictObject` on its own — it's always spread into a `strictObject`
 * caller, and a nested `strictObject` would reject the very keys the outer
 * schema is trying to merge in.
 */
const deviceFields = {
  deviceId: id.optional(),
  platform: z.enum(['ios', 'android', 'web']),
  appVersion: z.string().max(50).optional(),
  osVersion: z.string().max(50).optional(),
};

/**
 * `auth.signUp` — coaches only (`02`'s "Why this exists": clients cannot
 * self-register). `role` isn't a field on this schema at all, not merely
 * defaulted — there's nothing for a caller to override.
 */
export const signUpInput = strictObject({
  email,
  password,
  name: z.string().trim().min(1).max(200),
  timezone,
  // Required, not deferred to onboarding (`07`'s Approach step 1) — the
  // role decision (this procedure only ever creates a coach) depends on
  // it, and a role assigned before the age is known has to be revoked
  // later, which is worse. `auth.signUp` refuses anyone under 18
  // (`../features/auth/age.ts`'s `evaluateSignupAge`); the 13-17 client
  // path is `../invites/04-invite-acceptance.md`, a different signup with
  // a different rule.
  dateOfBirth: calendarDate,
  ...deviceFields,
});
export type SignUpInput = z.infer<typeof signUpInput>;

export const signInInput = strictObject({
  email,
  password: z.string().min(1).max(256), // no minimum here — an existing account may predate any policy change
  ...deviceFields,
});
export type SignInInput = z.infer<typeof signInInput>;

/**
 * `auth.refresh` (`04`) — the presented refresh token, opaque. No device
 * fields: rotation continues the family the token already belongs to, it
 * never opens a new one, so there's nothing here for the server to decide
 * device identity from.
 */
export const refreshInput = strictObject({
  refreshToken: z.string().min(1).max(512), // opaque, 32 raw bytes base64url-encoded (~43 chars) — 512 is a generous format-agnostic ceiling, not a length the format requires
});
export type RefreshInput = z.infer<typeof refreshInput>;

/**
 * `auth.signOut` (`05`) — optional: a device that has already discarded
 * its stored tokens locally can still call this defensively, with nothing
 * to present. That case has no family to resolve and no-ops (`05`'s
 * Approach step 7's "return, do not revoke", applied one level earlier).
 */
export const signOutInput = strictObject({
  refreshToken: z.string().min(1).max(512).optional(),
});
export type SignOutInput = z.infer<typeof signOutInput>;

/** `auth.requestReset` (`06`) — always returns the same shape; see that procedure's own doc comment. */
export const requestResetInput = strictObject({
  email,
});
export type RequestResetInput = z.infer<typeof requestResetInput>;

/** `auth.resetPassword` (`06`) — the same {@link password} rule task 02 writes with; a second policy would be a second thing to keep in sync. */
export const resetPasswordInput = strictObject({
  token: z.string().min(1).max(512),
  newPassword: password,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordInput>;

/**
 * `auth.signInWithApple` (`social-sign-in/01`) — the device-generated nonce
 * is required, not optional: `../../apps/api/src/lib/auth/provider-verification.ts`'s
 * `verifyAppleIdentityToken` rejects a token whose `nonce` claim doesn't
 * match it, and there is nothing to compare against without it.
 */
export const signInWithAppleInput = strictObject({
  identityToken: z.string().min(1).max(4096),
  nonce: z.string().min(16).max(256),
  ...deviceFields,
});
export type SignInWithAppleInput = z.infer<typeof signInWithAppleInput>;

/** `auth.signInWithGoogle` (`social-sign-in/02`) — Google's own ID token carries no per-request nonce check on this codebase's verifier (`provider-verification.ts`'s `verifyGoogleIdToken` signature), unlike Apple's. */
export const signInWithGoogleInput = strictObject({
  idToken: z.string().min(1).max(4096),
  ...deviceFields,
});
export type SignInWithGoogleInput = z.infer<typeof signInWithGoogleInput>;

/**
 * `auth.completeSocialSignUp` (`social-sign-in/03`) — the second step of a
 * brand-new social sign-up. `pendingSignupToken` is the opaque token
 * `signInWithApple`/`signInWithGoogle` returned when the verified identity
 * matched no existing account; `dateOfBirth` is collected here because
 * neither provider hands one over and `auth-server/07` requires it at
 * signup for both roles. `name` mirrors {@link signUpInput}'s field — a
 * provider's own name claim is unreliable enough (Apple never includes one
 * in the identity token at all) that this is the one source of truth,
 * regardless of what a screen pre-fills it with.
 */
export const completeSocialSignUpInput = strictObject({
  pendingSignupToken: z.string().min(1).max(512),
  name: z.string().trim().min(1).max(200),
  timezone,
  dateOfBirth: calendarDate,
  ...deviceFields,
});
export type CompleteSocialSignUpInput = z.infer<typeof completeSocialSignUpInput>;

/**
 * `auth.linkAppleProvider` / `auth.linkGoogleProvider` (`social-sign-in/03`'s
 * collision-resolution path) — called only once already signed in via the
 * existing method, so there is no `deviceFields`/session output here, just
 * the identity to re-verify and link. Split by provider rather than one
 * polymorphic schema, matching `signInWithAppleInput`/`signInWithGoogleInput`
 * above — the two providers were never going to share a shape once Apple's
 * nonce requirement is in the mix.
 */
export const linkAppleProviderInput = strictObject({
  identityToken: z.string().min(1).max(4096),
  nonce: z.string().min(16).max(256),
});
export type LinkAppleProviderInput = z.infer<typeof linkAppleProviderInput>;

export const linkGoogleProviderInput = strictObject({
  idToken: z.string().min(1).max(4096),
});
export type LinkGoogleProviderInput = z.infer<typeof linkGoogleProviderInput>;

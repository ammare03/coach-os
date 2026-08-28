// `05-public-allowlist.md`: the pressure valve on the strongest control in
// the product. **Adding a row here is a security change.** It must carry a
// real, falsifiable reason ("returns status, server time, and app version —
// no user data exists in its result at any tier" — not "it's public"), and
// needs a second reviewer's approval (see the PR template checkbox). Do not
// add a wildcard, a prefix, or any mechanism other than this list for
// exempting a procedure from `authz.test.ts` — no `@skipAuthz` marker, no
// `meta({ public: true })` flag, no env var. One list, one shape, one rule.
//
// `authz.test.ts` asserts two things about every row: staleness (the walk
// must actually produce the path) and redundancy (the path must not
// resolve to an already-guarded `protectedProcedure`) — so an entry that
// stops being true fails the build rather than sitting here silently.
export interface PublicAllowlistEntry {
  /** Exact dotted procedure path. Never a prefix or a pattern. */
  path: string;
  /** Why this procedure is safe with no caller identity. A sentence, not a word. */
  reason: string;
  /** The task document that introduced this entry — traces the decision to a spec. */
  addedBy: string;
  /** ISO date, for the monthly audit (`CLAUDE.md` §3.4.6). */
  addedOn: string;
}

export const PUBLIC_ALLOWLIST: readonly PublicAllowlistEntry[] = [
  {
    path: 'health.ping',
    reason:
      'Liveness proof for the mobile client. Returns status, server time, and app version — no user data exists in its result at any tier.',
    addedBy: 'phase-02-api-foundation/authorization-middleware/05-public-allowlist.md',
    addedOn: '2026-08-23',
  },

  {
    path: 'auth.signUp',
    reason:
      'Account creation has no caller identity to check yet — that is the whole point of a sign-up procedure. Coach-only is enforced inside the resolver (signUpInput has no role field), not by authz.',
    addedBy: 'phase-03-identity-and-auth/auth-server/02-password-hashing-and-user-creation.md',
    addedOn: '2026-08-27',
  },
  {
    path: 'auth.signIn',
    reason:
      'Credential verification is what establishes identity — a caller with no session must be able to reach this to get one. Response equivalence (unknown email / wrong password / social-only) is enforced inside the resolver, not by authz.',
    addedBy: 'phase-03-identity-and-auth/auth-server/02-password-hashing-and-user-creation.md',
    addedOn: '2026-08-27',
  },

  {
    path: 'auth.refresh',
    reason:
      'Must work with an absent or expired access token — that is the entire point of a refresh procedure. Identity is established by the presented refresh token itself (a database-backed lookup, not the JWT verifier), and it is rate-limited per token family rather than by caller identity (CLAUDE.md §6.5, api-conventions skill §7).',
    addedBy: 'phase-03-identity-and-auth/auth-server/04-refresh-token-rotation.md',
    addedOn: '2026-08-27',
  },

  {
    path: 'auth.signOut',
    reason:
      "A caller whose access token already expired still has a valid refresh token and still needs the session ended — requiring a live access token would fail the sign-out button for exactly the person who left the app closed overnight. The family is resolved from the presented token's own digest, never from caller input, so no other session can be reached (auth-server/05).",
    addedBy: 'phase-03-identity-and-auth/auth-server/05-sign-out-and-family-revocation.md',
    addedOn: '2026-08-27',
  },

  {
    path: 'auth.requestReset',
    reason:
      'A caller with no session is exactly who needs to recover an account. Response equivalence (same shape for a known and an unknown address) is enforced inside the resolver; a per-email rate limit on top of the shared auth.* bucket bounds abuse (auth-server/06).',
    addedBy: 'phase-03-identity-and-auth/auth-server/06-password-reset-via-resend.md',
    addedOn: '2026-08-27',
  },
  {
    path: 'auth.resetPassword',
    reason:
      'Identity is established by the presented reset token itself (a single-use, Redis-backed digest lookup), not by a session — a caller recovering an account has none. An unknown, expired, or already-used token returns one identical error (auth-server/06).',
    addedBy: 'phase-03-identity-and-auth/auth-server/06-password-reset-via-resend.md',
    addedOn: '2026-08-27',
  },

  {
    path: 'auth.signInWithApple',
    reason:
      "Identity is established by verifying the presented Apple identity token's signature against Apple's own published JWKS (provider-verification.ts) — a caller with no CoachOS session is exactly who needs to reach this. Collision and new-identity handling are enforced inside the resolver, not by authz.",
    addedBy: 'phase-03-identity-and-auth/social-sign-in/01-apple-sign-in.md',
    addedOn: '2026-08-28',
  },
  {
    path: 'auth.signInWithGoogle',
    reason:
      "Same reasoning as auth.signInWithApple — identity is established by verifying the presented Google ID token against Google's own published JWKS, not by a CoachOS session.",
    addedBy: 'phase-03-identity-and-auth/social-sign-in/02-google-sign-in.md',
    addedOn: '2026-08-28',
  },
  {
    path: 'auth.completeSocialSignUp',
    reason:
      "The second half of a brand-new social sign-up, reached only with a single-use, Redis-backed pendingSignupToken issued by signInWithApple/signInWithGoogle after independently verifying the provider identity — the caller has no CoachOS session yet, same shape as auth.resetPassword's token-as-identity pattern.",
    addedBy: 'phase-03-identity-and-auth/social-sign-in/03-provider-linkage.md',
    addedOn: '2026-08-28',
  },
];

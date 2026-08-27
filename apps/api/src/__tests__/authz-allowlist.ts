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

  // `auth.requestReset` and `auth.resetPassword` are deliberately NOT
  // listed yet — each is added in the same PR that implements it (`06`),
  // never speculatively ahead of it. Invite acceptance is deliberately
  // excluded even then (`CLAUDE.md` §8.1 requires it to be a protected
  // procedure).
];

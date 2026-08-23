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

  // The five `auth.*` procedures §6.1 defines as unauthenticated
  // (`auth.signUp`, `auth.signIn`, `auth.refresh`, `auth.requestReset`,
  // `auth.resetPassword`) are deliberately NOT listed yet. `routers/auth.ts`
  // is still the empty stub `api-scaffold` registered — adding their paths
  // now would make every one of them fail this file's own staleness check
  // (`authz.test.ts`'s "the walk must produce this path" assertion) the
  // moment it's added, since `appRouter._def.procedures` has nothing at
  // `auth.*` for it to find. That failure would be real, but it would teach
  // nobody anything they don't already know: the procedures don't exist.
  // `phase-03-identity-and-auth/auth-server/` adds each entry in the same
  // PR that implements the procedure it names — never speculatively ahead
  // of it. Invite acceptance is deliberately excluded even then
  // (`CLAUDE.md` §8.1 requires it to be a protected procedure).
];

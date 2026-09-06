import type { Operation, TRPCLink } from '@trpc/client';
// Type-only — see `../../lib/trpc.ts`'s own comment on why this must never
// become a value import in a bundled app.
import type { AppRouter } from 'api/src/routers/index.ts';
import * as Application from 'expo-application';
import { Platform } from 'react-native';

import { tokenCache } from './token-cache.ts';

// The closed exclusion list. Must equal the server's public allowlist
// (`apps/api/src/__tests__/authz-allowlist.ts`, CLAUDE.md §18.3) —
// duplicated knowledge, cross-asserted by this feature's own test rather
// than trusted to stay in sync by discipline (`auth-client/02` approach
// step 2). Matched by exact path, never a prefix: `auth.signOutAllDevices`
// is deliberately absent — it is `protectedProcedure` (`auth-server/05`),
// and a `startsWith('auth.')` match would silently strip its token too.
export const EXCLUDED_PROCEDURES: readonly string[] = [
  'health.ping',
  'auth.signUp',
  'auth.signIn',
  'auth.refresh',
  'auth.signOut',
  'auth.requestReset',
  'auth.resetPassword',
  'auth.signInWithApple',
  'auth.signInWithGoogle',
  'auth.completeSocialSignUp',
  'invites.accept',
  // `guardian-consent/02` — the guardian is a parent with no CoachOS
  // account, so this is `publicProcedure` on the server. Absent from
  // this list until `guardian-consent/06`, which is when this file's
  // cross-assertion against the server allowlist started failing.
  'invites.confirmGuardianConsent',
];

/** Also used by `refresh-interceptor.ts`, which sits above this link in
 * the chain and so cannot read the `needsAuth` this link stamps on
 * `op.context` for the *downstream* chain — it needs its own answer to the
 * same question, from the same list, before `op` ever reaches here. */
export function needsAuth(path: string): boolean {
  return !EXCLUDED_PROCEDURES.includes(path);
}

// `expo-application`'s native version getters are synchronous constants —
// nothing to await, so read once at module load rather than caching them
// separately (`auth-client/02` approach step 6).
const VERSION_HEADERS = {
  'x-client-version': Application.nativeApplicationVersion ?? 'unknown',
  'x-client-platform': Platform.OS,
};

/**
 * `authLink` runs ahead of `httpBatchLink` in the chain
 * (`../../lib/trpc-links.ts`) and stamps every operation with whether it
 * should carry a credential. It cannot attach the header itself — tRPC v11
 * only lets the *terminating* link touch the outgoing `Headers` object — so
 * it hands the decision forward via `op.context`, which the terminating
 * link's `headers({ opList })` callback reads through `buildRequestHeaders`
 * below.
 *
 * Deliberately synchronous and side-effect-free beyond that: `tokenCache`
 * is read at the terminating link, not here, so this link never touches
 * the cache and never becomes a place a future edit could make async
 * (`auth-client/02` approach step 5).
 */
export const authLink: TRPCLink<AppRouter> = () => {
  return ({ next, op }) =>
    next({ ...op, context: { ...op.context, needsAuth: needsAuth(op.path) } });
};

/**
 * Reduces a batch of operations to the header set `httpBatchLink` sends.
 * Version headers are unconditional. `Authorization` is attached only when
 * a token is cached AND at least one operation in the batch needs it — the
 * documented batching rule (`auth-client/02` approach step 3): a public
 * procedure receiving the header is harmless (the server ignores it), but
 * omitting it from an authenticated call in the same batch is not a trade
 * this link makes.
 *
 * Reads `tokenCache` synchronously — the whole reason that cache exists is
 * so this runs with no SecureStore call on the hot path.
 */
export function buildRequestHeaders(opList: readonly Operation[]): Record<string, string> {
  const headers: Record<string, string> = { ...VERSION_HEADERS };

  const anyNeedsAuth = opList.some((op) => op.context.needsAuth === true);
  const token = tokenCache.get();
  if (anyNeedsAuth && token) {
    headers.Authorization = `Bearer ${token.accessToken}`;
  }

  return headers;
}

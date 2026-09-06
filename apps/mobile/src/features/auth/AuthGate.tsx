import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';

import type { AccessTokenRole } from './jwt.ts';
import type { AuthStatus } from './store.ts';
import { useAuthStore } from './store.ts';

// `phase-05-app-shell/providers-and-gates/03` — the mechanism behind P05's
// phase acceptance criterion: an authenticated coach lands in `(coach)`, an
// authenticated client in `(client)`, everyone else in `(auth)`, and nobody
// sees a frame of the group they do not belong in.
//
// This is a routing decision, never an authorisation one. Every procedure
// re-derives its caller from a signature-verified token server-side
// (`CLAUDE.md` §6.2, `security-and-privacy` §1), so a patched client that
// forced its way into `(coach)` would find empty screens and `NOT_FOUND`s,
// not another coach's data. The gate exists so the right person sees the
// right app, not to keep the wrong person out of data.
//
// `phase-06-onboarding/onboarding-infrastructure/02` added a third
// dimension to that decision — onboarded or not — rather than a second,
// parallel gate. "Which app does this session belong in" is one question
// with three inputs; splitting it across two components is how the two
// answers start disagreeing.

/**
 * The three top-level route groups (`UI-UX.md` §UX1.1), plus the two
 * `phase-06-onboarding/onboarding-infrastructure/02` adds. §9.1's tree
 * never listed an onboarding group — a documented gap, not an oversight
 * (`coach-onboarding/01` Approach step 1) — and a *group* is the right
 * shape rather than a screen inside `(coach)`/`(client)`, because this gate
 * decides by group: a route reachable only mid-onboarding has to be
 * somewhere the gate can refuse to render once onboarding is done.
 */
const AUTH_GROUP = '(auth)';
const COACH_GROUP = '(coach)';
const CLIENT_GROUP = '(client)';
const COACH_ONBOARDING_GROUP = '(coach-onboarding)';
const CLIENT_ONBOARDING_GROUP = '(client-onboarding)';

export type RouteGroup =
  | typeof AUTH_GROUP
  | typeof COACH_GROUP
  | typeof CLIENT_GROUP
  | typeof COACH_ONBOARDING_GROUP
  | typeof CLIENT_ONBOARDING_GROUP;

/**
 * Each group's root. `/(coach)` and `/(client)` are not routes in their own
 * right — the tab navigator is (`.expo/types/router.d.ts`), so a group's root
 * is its `(tabs)` index. Landing on the screen a deep link named rather than
 * on the group root is `phase-05-app-shell/deep-linking/`, not this.
 *
 * The two onboarding groups have no tab navigator — a flow shell is not a
 * dock (`UI-UX.md` §UX1.1) — so their root is the group's own `index`.
 */
const GROUP_ROOT = {
  [AUTH_GROUP]: '/(auth)/welcome',
  [COACH_GROUP]: '/(coach)/(tabs)',
  [CLIENT_GROUP]: '/(client)/(tabs)',
  [COACH_ONBOARDING_GROUP]: '/(coach-onboarding)',
  [CLIENT_ONBOARDING_GROUP]: '/(client-onboarding)',
} as const;

export type AuthGateDecision =
  /** The session is still resolving — render nothing, leave the splash up. */
  | { action: 'wait' }
  /** The current route is one this session is allowed to be on. */
  | { action: 'render' }
  | { action: 'redirect'; group: RouteGroup };

/**
 * The three fields the decision is made from. An object rather than three
 * more positional parameters: the third dimension is a bare boolean, and
 * `resolveAuthGate('authenticated', 'coach', false, '(coach)')` reads as a
 * riddle at every call site and every assertion.
 */
export interface AuthGateSession {
  status: AuthStatus;
  role: AccessTokenRole | null;
  /** `users.onboarding_completed_at IS NOT NULL`, as `store.ts` holds it. */
  isOnboarded: boolean;
}

/**
 * Role picks the pair of homes; `isOnboarded` picks which of the two. An
 * assistant coach is a coach (`CLAUDE.md` §2): the same surfaces, a
 * narrower client book, and that narrowing is resolved by `ownsResource`
 * server-side (§6.2) rather than by a route group of its own — so an
 * assistant onboards through the coach flow too.
 *
 * A missing role on an authenticated session is unreachable by construction
 * — `store.ts` sets status and role together — and resolves to `(auth)`
 * anyway, so the failure mode is "signed out" and never "guessed a group".
 */
function groupForSession(role: AccessTokenRole | null, isOnboarded: boolean): RouteGroup {
  if (role === 'client') return isOnboarded ? CLIENT_GROUP : CLIENT_ONBOARDING_GROUP;
  if (role === 'coach' || role === 'assistant') {
    return isOnboarded ? COACH_GROUP : COACH_ONBOARDING_GROUP;
  }
  return AUTH_GROUP;
}

/**
 * The whole gate as a pure function of the session and the group the caller
 * is guarding, so every acceptance criterion — P05's four and this task's
 * three routing ones — is assertable without a navigator.
 *
 * `group` is `undefined` for `/` — the tree's entry point, which belongs to no
 * group and carries no content of its own (`src/app/index.tsx`). Resolving it
 * is exactly what this gate is for, and it is what makes the
 * `router.replace('/')` that every sign-in path already performs land on the
 * right home instead of bouncing back into `(auth)`.
 */
export function resolveAuthGate(
  session: AuthGateSession,
  group: RouteGroup | undefined,
  exempt: boolean = false,
): AuthGateDecision {
  if (session.status === 'loading') {
    return { action: 'wait' };
  }

  const permitted =
    session.status === 'authenticated'
      ? groupForSession(session.role, session.isOnboarded)
      : AUTH_GROUP;

  // `client-onboarding/01` — the one exemption, and the only one. An
  // authenticated caller on `(auth)/invite/[code]` renders it instead of
  // being bounced to their own group root, because that redirect is what
  // made an invite link silently do nothing for anyone already signed in.
  //
  // It is an ARGUMENT, not a route read inside this function: the caller
  // knows which route is active, this function stays pure, and every
  // existing assertion keeps holding unchanged. It also only ever widens
  // `(auth)` — a caller passing `exempt` alongside `(coach)` cannot open a
  // hole in the group gate, because the exemption is scoped to the group
  // the exempt route lives in.
  if (exempt && group === AUTH_GROUP) {
    return { action: 'render' };
  }

  if (group === undefined || group !== permitted) {
    return { action: 'redirect', group: permitted };
  }
  return { action: 'render' };
}

/**
 * Wraps one route group's own navigator. It returns `<Redirect>` **instead
 * of** `children`, never alongside them, and that substitution — not
 * `<Redirect>` itself — is what makes the transition flash-free: expo-router's
 * `<Redirect>` navigates from an effect internally, so a gate that rendered
 * both would paint the wrong group for a frame and then swap. A hand-written
 * `router.replace()` in a `useEffect` has exactly that shape, which is why
 * this task forbids one.
 *
 * ⚠️ It is mounted per group, and NOT once around the root `<Stack>` in
 * `src/app/_layout.tsx`, even though that is where task 01 drew the slot. A
 * root gate works — the redirect lands — but swapping the root `<Stack>` for a
 * `<Redirect>` unmounts the only navigator in the internal slot, which changes
 * its route key, which **remounts the root layout and every provider under
 * it**: a second `bootstrap()` (a second refresh round trip), a second
 * analytics init, and a splash sequence that restarts mid-launch. Measured,
 * not assumed. Guarding each group instead leaves the root `<Stack>` mounted
 * throughout, and only the group's own inner stack comes and goes.
 */
export function AuthGate({
  group,
  exempt = false,
  children,
}: {
  group: RouteGroup;
  /**
   * The active route is one this group's gate does not apply to
   * (`client-onboarding/01`). Supplied by the layout, which can read the
   * route; never derived in here — see `resolveAuthGate`.
   */
  exempt?: boolean;
  children: ReactNode;
}) {
  const decision = resolveAuthGate(useGateSession(), group, exempt);

  if (decision.action === 'wait') return null;
  if (decision.action === 'redirect') return <Redirect href={GROUP_ROOT[decision.group]} />;
  return <>{children}</>;
}

/**
 * The gate for `/`, which belongs to no group and so has no navigator of its
 * own to guard — it renders the redirect and nothing else.
 *
 * It redirects unconditionally once the session resolves, which is safe
 * precisely because it is a screen rather than a layout: `<Redirect>` fires
 * from `useFocusEffect`, and the `replace` it issues takes this route off the
 * stack. A layout doing the same thing re-fires on every render and loops.
 */
export function AuthHomeRedirect() {
  const decision = resolveAuthGate(useGateSession(), undefined);

  if (decision.action !== 'redirect') return null;
  return <Redirect href={GROUP_ROOT[decision.group]} />;
}

/**
 * Three field-level subscriptions rather than one object selector: Zustand
 * compares a selector's result by identity, and a selector returning a fresh
 * object re-renders every gate on every unrelated store write.
 *
 * `isOnboarded` being read from the store — and not from a `me.get` query —
 * is what answers this task's stated risk. The completion action flips it in
 * the same turn the mutation resolves, so the redirect out of the flow is a
 * synchronous consequence of the write succeeding, not of a later refetch,
 * foreground, or relaunch.
 */
function useGateSession(): AuthGateSession {
  const status = useAuthStore((state) => state.status);
  const role = useAuthStore((state) => state.role);
  const isOnboarded = useAuthStore((state) => state.isOnboarded);
  return { status, role, isOnboarded };
}

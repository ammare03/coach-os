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

/** The three top-level route groups (`UI-UX.md` §UX1.1). */
const AUTH_GROUP = '(auth)';
const COACH_GROUP = '(coach)';
const CLIENT_GROUP = '(client)';

export type RouteGroup = typeof AUTH_GROUP | typeof COACH_GROUP | typeof CLIENT_GROUP;

/**
 * Each group's root. `/(coach)` and `/(client)` are not routes in their own
 * right — the tab navigator is (`.expo/types/router.d.ts`), so a group's root
 * is its `(tabs)` index. Landing on the screen a deep link named rather than
 * on the group root is `phase-05-app-shell/deep-linking/`, not this.
 */
const GROUP_ROOT = {
  [AUTH_GROUP]: '/(auth)/welcome',
  [COACH_GROUP]: '/(coach)/(tabs)',
  [CLIENT_GROUP]: '/(client)/(tabs)',
} as const;

export type AuthGateDecision =
  /** The session is still resolving — render nothing, leave the splash up. */
  | { action: 'wait' }
  /** The current route is one this session is allowed to be on. */
  | { action: 'render' }
  | { action: 'redirect'; group: RouteGroup };

/**
 * An assistant coach is a coach (`CLAUDE.md` §2): the same surfaces, a
 * narrower client book, and that narrowing is resolved by `ownsResource`
 * server-side (§6.2) rather than by a fourth route group.
 *
 * A missing role on an authenticated session is unreachable by construction
 * — `store.ts` sets status and role together — and resolves to `(auth)`
 * anyway, so the failure mode is "signed out" and never "guessed a group".
 */
function groupForRole(role: AccessTokenRole | null): RouteGroup {
  if (role === 'client') return CLIENT_GROUP;
  if (role === 'coach' || role === 'assistant') return COACH_GROUP;
  return AUTH_GROUP;
}

/**
 * The whole gate as a pure function of the two store fields and the group the
 * caller is guarding, so all four acceptance criteria are assertable without
 * a navigator.
 *
 * `group` is `undefined` for `/` — the tree's entry point, which belongs to no
 * group and carries no content of its own (`src/app/index.tsx`). Resolving it
 * is exactly what this gate is for, and it is what makes the
 * `router.replace('/')` that every sign-in path already performs land on the
 * right home instead of bouncing back into `(auth)`.
 */
export function resolveAuthGate(
  status: AuthStatus,
  role: AccessTokenRole | null,
  group: RouteGroup | undefined,
): AuthGateDecision {
  if (status === 'loading') {
    return { action: 'wait' };
  }

  const permitted = status === 'authenticated' ? groupForRole(role) : AUTH_GROUP;

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
export function AuthGate({ group, children }: { group: RouteGroup; children: ReactNode }) {
  const status = useAuthStore((state) => state.status);
  const role = useAuthStore((state) => state.role);
  const decision = resolveAuthGate(status, role, group);

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
  const status = useAuthStore((state) => state.status);
  const role = useAuthStore((state) => state.role);
  const decision = resolveAuthGate(status, role, undefined);

  if (decision.action !== 'redirect') return null;
  return <Redirect href={GROUP_ROOT[decision.group]} />;
}

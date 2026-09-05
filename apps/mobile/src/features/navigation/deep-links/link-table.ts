import type { AccessTokenRole } from '../../auth/jwt.ts';

import type { ParsedDeepLink } from './parse.ts';

// `phase-05-app-shell/deep-linking/02` builds the table; `03` fills it with
// CLAUDE.md §9.3's seven entries. A lookup keyed on the first path segment,
// never a chain of `if`s — the point is that adding a link is adding a row,
// and that the set of links the app answers to can be read in one place and
// asserted against §9.3 in one test.

/**
 * What a link resolved to. `needs-role` is the one that matters: three of
 * §9.3's links mean different screens for a coach and a client, and at cold
 * start the auth bootstrap has not answered yet. Resolving those against a
 * guess is how a client lands on a coach screen for a frame, so the table
 * says "ask me again once you know" and `deep-linking/04` replays it.
 */
export type DeepLinkTarget =
  { status: 'resolved'; href: string } | { status: 'needs-role' } | { status: 'unhandled' };

export type LinkHandlerInput = {
  /** The first segment is the table key; handlers read the rest. */
  readonly segments: readonly string[];
  readonly query: string;
  readonly role: AccessTokenRole | null;
};

export type LinkHandler = (input: LinkHandlerInput) => DeepLinkTarget;

const UNHANDLED: DeepLinkTarget = { status: 'unhandled' };
const NEEDS_ROLE: DeepLinkTarget = { status: 'needs-role' };

/**
 * Re-encodes the dynamic segment on the way back out. It was decoded during
 * parsing so a handler can read it; expo-router reads the param straight off
 * the path, so it has to go back in encoded or a code containing a `/` or a
 * `?` silently becomes two segments.
 */
export function routeTo(path: string, query: string): DeepLinkTarget {
  return { status: 'resolved', href: query === '' ? path : `${path}?${query}` };
}

/** A handler for `/{key}/{value}` — one dynamic segment, nothing after it. */
export function singleParamLink(
  build: (value: string, role: AccessTokenRole | null) => string | null,
): LinkHandler {
  return ({ segments, query, role }) => {
    const value = segments[1];
    // A bare `/invite` with no code is a truncated link, not a route.
    if (value === undefined || value === '' || segments.length > 2) {
      return UNHANDLED;
    }
    const path = build(encodeURIComponent(value), role);
    return path === null ? NEEDS_ROLE : routeTo(path, query);
  };
}

/**
 * §9.3's table, plus UI-UX.md §UX1.4's reset link. Keyed by first segment.
 * `deep-linking/03` adds the other seven rows; this task ships the one link
 * that is already live in production email (`auth-server/06`) so the
 * machinery is exercised by something real rather than by a fixture.
 */
export const LINK_TABLE: Readonly<Record<string, LinkHandler>> = {
  // UI-UX.md §UX1.4. Reachable with no session at all — it is how a locked-out
  // user gets back in, so it must never depend on role or on the auth gate.
  'reset-password': singleParamLink((token) => `/(auth)/reset-password/${token}`),
};

/**
 * The whole resolution step as a pure function of a parsed link and the
 * role currently known, so every §9.3 row is assertable without a navigator
 * and both role branches of the role-dependent ones can be tested.
 */
export function resolveDeepLink(
  link: ParsedDeepLink,
  role: AccessTokenRole | null,
): DeepLinkTarget {
  const key = link.segments[0];
  if (key === undefined) {
    return UNHANDLED;
  }

  const handler = LINK_TABLE[key];
  if (handler === undefined) {
    return UNHANDLED;
  }

  return handler({ segments: link.segments, query: link.query, role });
}

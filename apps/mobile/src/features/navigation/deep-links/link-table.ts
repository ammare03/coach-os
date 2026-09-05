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
  if (query === '') {
    return { status: 'resolved', href: path };
  }
  // Two rows below build a path that already carries a query param of their
  // own. Joining with `?` unconditionally would produce a second `?`, which
  // expo-router reads as part of the first param's value.
  const separator = path.includes('?') ? '&' : '?';
  return { status: 'resolved', href: `${path}${separator}${query}` };
}

/**
 * A handler for `/{key}/{value}` — one dynamic segment, nothing after it,
 * which is the shape of every row in §9.3's table. The builder receives the
 * value already re-encoded and returns a target, so a row with no meaning for
 * a given role says `unhandled` while a row that cannot know yet says
 * `needs-role` — never one value standing for both.
 */
export function singleParamLink(
  build: (value: string, role: AccessTokenRole | null, query: string) => DeepLinkTarget,
): LinkHandler {
  return ({ segments, query, role }) => {
    const value = segments[1];
    // A bare `/invite` with no code is a truncated link, not a route.
    if (value === undefined || value === '' || segments.length > 2) {
      return UNHANDLED;
    }
    return build(encodeURIComponent(value), role, query);
  };
}

/**
 * `AuthGate`'s `groupForRole`, restated for the one thing this file needs
 * from it: an assistant coach is a coach (`CLAUDE.md` §2), so it reads the
 * coach half of every role-dependent row. It is deliberately NOT imported
 * from `AuthGate.tsx` — that module pulls in `expo-router` and JSX for a
 * three-line decision, and the two answers being the same is asserted in
 * this feature's tests rather than achieved by coupling.
 */
function isCoachSide(role: AccessTokenRole | null): boolean | null {
  if (role === 'coach' || role === 'assistant') return true;
  if (role === 'client') return false;
  return null;
}

/**
 * A row whose destination differs by role. Returns `needs-role` until the
 * auth bootstrap has answered, which is the whole reason that status exists:
 * `deep-linking/04` holds the link and asks again rather than letting a
 * client land on `(coach)/video/[id]` for a frame.
 */
function roleDependentLink(
  coachPath: (value: string) => string | null,
  clientPath: (value: string) => string | null,
): LinkHandler {
  return singleParamLink((value, role, query) => {
    const coachSide = isCoachSide(role);
    if (coachSide === null) {
      return NEEDS_ROLE;
    }
    const path = coachSide ? coachPath(value) : clientPath(value);
    // `null` here is "this link has no meaning for this role" — a client
    // tapping `/client/{id}`. Unhandled, so they land on their own home
    // rather than on a route their group does not contain.
    return path === null ? UNHANDLED : routeTo(path, query);
  });
}

/**
 * `CLAUDE.md` §9.3's table, transcribed, plus UI-UX.md §UX1.4's reset link.
 * Keyed by first path segment. §14.2 later depends on exactly this mapping —
 * "tapping a notification must land on the exact object, never on the home
 * screen" — so a row that resolves to a list rather than to the object is
 * marked as such below, and is a gap in that criterion, not a design.
 *
 * ⚠️ Only `/invite` is genuinely role-independent. `/live` and `/checkin`
 * look it (both roles do the same thing) but the route tree puts each group's
 * copy in its own group, so they still have to branch. That is why they use
 * `roleDependentLink` too — the branch is over which group owns the screen,
 * not over what the link means.
 */
export const LINK_TABLE: Readonly<Record<string, LinkHandler>> = {
  // UI-UX.md §UX1.4. Reachable with no session at all — it is how a locked-out
  // user gets back in, so it must never depend on role or on the auth gate.
  'reset-password': singleParamLink((token, _role, query) =>
    routeTo(`/(auth)/reset-password/${token}`, query),
  ),

  // §9.3 · invite acceptance. The only row with one destination for everyone,
  // because it is the one that runs before anyone has a role.
  //
  // ⚠️ Post-authentication behaviour, per this task's AC 4: the destination is
  // the same route, but `AuthGate` guards `(auth)` and will bounce a
  // signed-in user straight back to their own group, so an authenticated user
  // tapping an invite lands home instead of on the invite. Decided
  // 2026-09-05: a coached client is refused (leaving stays Settings-only), a
  // coachless one gets the returning-client acceptance screen
  // (`invites.acceptAsExistingClient`), a coach is refused — and
  // `phase-06-onboarding/client-onboarding/01` owns the gate exemption and
  // the branch. Tracked in `docs/UNFORGET.md`.
  invite: singleParamLink((code, _role, query) => routeTo(`/(auth)/invite/${code}`, query)),

  // §9.3 · coach → client overview. Not role-dependent so much as
  // coach-only: a client has no clients, and there is no client-side meaning
  // for this link at all. It resolves to `unhandled` for a client, which
  // lands them on their own home rather than on a route their group does not
  // contain.
  client: roleDependentLink(
    (id) => `/(coach)/client/${id}`,
    () => null,
  ),

  // §9.3 · annotator (coach) / video detail (client) — role-dependent.
  //
  // ⚠️ The client side has no route yet. §9.1's tree gives the coach
  // `(coach)/video/[id]` and gives the client nothing symmetrical; the
  // client's video surface is the Coach tab, which
  // `phase-12-feedback-comments/feedback-inbox/` builds. Until then the asset
  // id rides along as a query param so the datum is not lost — but this is a
  // §14.2 gap: a client tapping a video notification reaches the right tab,
  // not the right video.
  video: roleDependentLink(
    (assetId) => `/(coach)/video/${assetId}`,
    (assetId) => `/(client)/(tabs)/coach?assetId=${assetId}`,
  ),

  // §9.3 · session review (coach) / logger (client) — role-dependent, and the
  // two sides genuinely differ: the coach reviews a finished session,
  // the client opens the logger for it.
  session: roleDependentLink(
    (id) => `/(coach)/session/${id}`,
    (id) => `/(client)/workout/${id}`,
  ),

  // §9.3 · check-in review (coach) / check-in form (client).
  checkin: roleDependentLink(
    (id) => `/(coach)/checkin/${id}`,
    (id) => `/(client)/checkin/${id}`,
  ),

  // §9.3 · join live room. Same screen on both sides; different group.
  live: roleDependentLink(
    (sessionId) => `/(coach)/live/${sessionId}`,
    (sessionId) => `/(client)/live/${sessionId}`,
  ),

  // §9.3 · conversation.
  //
  // ⚠️ Asymmetric, and not by choice. A client has exactly one coach and so
  // exactly one conversation, which is their Coach tab — the id is not needed
  // and is dropped. The coach side has no route keyed by conversation id at
  // all: `(coach)/client/[id]/chat` is keyed by CLIENT id, and routing a
  // conversation id into it would open the wrong client's thread, which is
  // the one failure this row must not have. It goes to the coach's Inbox with
  // the id as a query param instead, for
  // `phase-14-messaging-and-realtime/conversations/` to consume. A §14.2 gap
  // on the coach side, recorded rather than papered over.
  chat: roleDependentLink(
    (conversationId) => `/(coach)/(tabs)/inbox?conversationId=${conversationId}`,
    () => '/(client)/(tabs)/coach',
  ),
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

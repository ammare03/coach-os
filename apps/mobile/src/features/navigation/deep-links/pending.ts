import type { ParsedDeepLink } from './parse.ts';

// `phase-05-app-shell/deep-linking/04`. The cold-start race, and the whole
// reason this module exists:
//
// `Linking.getInitialURL()` hands expo-router the launching URL before the
// auth bootstrap has answered, so `+native-intent.ts` cannot know whether
// `/checkin/{id}` means the coach's copy or the client's. It answers
// `needs-role` and parks the link here; the gate then redirects to whichever
// group the resolved session belongs to, and `PendingDeepLinkReplay` picks
// the link back up and layers the specific navigation on top of it.
//
// Without this, the sequence is: link resolves to nothing in particular →
// gate redirects to the group root → user lands on their home screen, and
// the link's specificity is silently gone. That is the failure §8.1's
// three-state criterion exists to catch, and it only ever happens on cold
// start, which is the state that is easiest not to test.

let pending: ParsedDeepLink | null = null;

/**
 * Held only while the session is still resolving. A link that arrives with a
 * session already known is resolved on the spot and never parked, and a link
 * that arrives while signed out and running is deliberately NOT held: it
 * would otherwise replay into whoever signs in next, who may not be the
 * person the link was for. "Tap a link, sign in, land on it" is a real
 * behaviour worth having, but it is the invite flow's
 * (`phase-06-onboarding/client-onboarding/01`) and needs its own decision.
 */
export function holdPendingDeepLink(link: ParsedDeepLink): void {
  pending = link;
}

/** Take-once. A replayed link must never replay again on the next re-render. */
export function takePendingDeepLink(): ParsedDeepLink | null {
  const held = pending;
  pending = null;
  return held;
}

/** Test seam, and the reset a sign-out would need if one is ever added. */
export function clearPendingDeepLink(): void {
  pending = null;
}

import { EmptyState } from '@coachos/ui';

// Frame `E` (`today-card/DESIGN-SPEC.md` §3.5) — the client has no active
// assignment at all. Not an error, and not the rest-day card: there is no
// program to be quiet about, so the hero has no slots to fill and §9's
// `EmptyState` is the designed replacement for a blank screen.
//
// Three rules the component itself cannot enforce:
//
// - **The body is passive.** "No program has been assigned yet", never
//   "your coach hasn't" (`COPY.md` CO§3 — never editorialise about the
//   coach). The client may be waiting on a coach who is mid-programming.
// - **No `icon`.** `EmptyState`'s contract allows the isometric solid in
//   exactly two places (`DESIGN.md` §6) and this is not one of them.
// - **Exactly one action**, which `EmptyState` pins at the type level.
//
// That action is `Log a workout anyway`, resolved in DESIGN-SPEC §0 against
// `docs/screens/client-today.md`'s *Message your coach*: a coachless client
// dead-ends on the latter, P14 messaging is unbuilt and network-bound, and
// the Coach tab is permanently in the dock, so the coach is never more than
// one tap away regardless.

export interface TodayCardNoProgramProps {
  /**
   * `false` is the detached client (`account-lifecycle/06`,
   * `clientApp.coach` → `null`) — a body swap, never a second state.
   */
  hasCoach: boolean;
  /**
   * `today-card/04`'s ad-hoc flow. **Required**: while that task was
   * unbuilt this was optional and a reduced, action-less variant rendered
   * in its place, because an offer the screen could not keep is worse than
   * no offer. `TodayScreen` now always supplies it, so that variant is
   * gone rather than unreachable.
   */
  onStartAdHoc: () => void;
}

const TITLE = 'No program yet.';

/**
 * Two whole strings rather than a fact concatenated with an offer:
 * `product-copy` §6 forbids assembling a sentence from fragments, because
 * the join is the first thing that breaks in translation.
 */
const BODY = {
  coached: 'No program has been assigned yet. You can still log a workout.',
  coachless: 'You don’t have a coach right now. You can still log a workout.',
} as const;

export function TodayCardNoProgram({ hasCoach, onStartAdHoc }: TodayCardNoProgramProps) {
  return (
    <EmptyState
      title={TITLE}
      body={BODY[hasCoach ? 'coached' : 'coachless']}
      primaryAction={{ label: 'Log a workout anyway', onPress: onStartAdHoc }}
      density="client"
      testID="today-card-no-program"
    />
  );
}

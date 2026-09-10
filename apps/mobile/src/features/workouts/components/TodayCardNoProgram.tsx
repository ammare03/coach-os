import { EmptyState, Text } from '@coachos/ui';
import { spacing } from '@coachos/ui/theme';
import { StyleSheet, View } from 'react-native';

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
  /** `today-card/04` owns the ad-hoc flow. See the fallback below for its absence. */
  onStartAdHoc?: (() => void) | undefined;
}

const TITLE = 'No program yet.';

/**
 * Four whole strings rather than a fact concatenated with an offer:
 * `product-copy` §6 forbids assembling a sentence from fragments, because
 * the join is the first thing that breaks in translation.
 *
 * The action-less pair **drops** the second sentence rather than promising
 * a workout the client cannot start yet — §3.10's degrade-by-dropping-a-
 * segment rule, and the same reasoning that left task `01`'s completed card
 * without its secondary action instead of with an inert one.
 */
const BODY = {
  coached: {
    withAction: 'No program has been assigned yet. You can still log a workout.',
    withoutAction: 'No program has been assigned yet.',
  },
  coachless: {
    withAction: 'You don’t have a coach right now. You can still log a workout.',
    withoutAction: 'You don’t have a coach right now.',
  },
} as const;

/** `EmptyState`'s own 270px measure, restated because this cannot import it. */
const BODY_MAX_WIDTH = 270;

export function TodayCardNoProgram({ hasCoach, onStartAdHoc }: TodayCardNoProgramProps) {
  const copy = BODY[hasCoach ? 'coached' : 'coachless'];

  if (onStartAdHoc) {
    return (
      <EmptyState
        title={TITLE}
        body={copy.withAction}
        primaryAction={{ label: 'Log a workout anyway', onPress: onStartAdHoc }}
        density="client"
        testID="today-card-no-program"
      />
    );
  }

  // `EmptyState` requires an action and will not render without one, so the
  // interim state is composed here at its exact geometry — 52/20 padding,
  // 6px under the heading, a 270px measure. It disappears the moment
  // `today-card/04` supplies the handler; nothing else consumes it.
  return (
    <View style={styles.block} testID="today-card-no-program">
      <View style={styles.words}>
        <Text size="h2" accessibilityRole="header" style={styles.centred}>
          {TITLE}
        </Text>
        <Text size="body-lg" tone="muted" style={styles.body}>
          {copy.withoutAction}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    alignItems: 'center',
    paddingVertical: spacing(52),
    paddingHorizontal: spacing(20),
  },
  words: {
    alignItems: 'center',
    gap: spacing(6),
  },
  centred: {
    textAlign: 'center',
  },
  body: {
    textAlign: 'center',
    maxWidth: BODY_MAX_WIDTH,
  },
});

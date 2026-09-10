import { Button, Text } from '@coachos/ui';
import { density, spacing } from '@coachos/ui/theme';
import { StyleSheet, View } from 'react-native';

// The Today card's own failure (`today-card/DESIGN-SPEC.md` §3.7). The
// session card is the screen's PRIMARY content boundary, so it is the one
// section allowed a full state (`UI-UX.md` §UX4.1 rule 2) — the header, the
// dock, and every other tab keep working.
//
// **Composed locally rather than in `packages/ui`, deliberately.**
// `NotFoundState` and `ForbiddenState` both wrap `EmptyState`, and
// `EmptyState`'s contract is one *forward* action; a retry is not one, and
// widening that component to admit it would let any empty state ship a
// second competing next step. So this reproduces `EmptyState`'s exact
// geometry — 20px column gap, 6px under the heading, a 270px measure, one
// 52px action — and gets promoted on the SECOND consumer, which
// `session-runtime` is the likely trigger for (`code-conventions` §1).
//
// Copy is `ERRORS.md` ER§1.4's `LOCAL_READ_FAILED` row, verbatim. Never red,
// never a code, never a stack trace, and the second line is the only thing
// the client actually wants to know.

export interface TodayCardErrorProps {
  onRetry: () => void;
}

/** §3.7's measure. `EmptyState`'s own 270px, restated because this cannot import it. */
const BODY_MAX_WIDTH = 270;

export function TodayCardError({ onRetry }: TodayCardErrorProps) {
  return (
    <View style={styles.block} testID="today-card-error">
      <View style={styles.words}>
        <Text size="h2" accessibilityRole="header" style={styles.centred}>
          Today&rsquo;s session didn&rsquo;t load.
        </Text>
        <Text size="body-lg" tone="muted" style={styles.body}>
          Nothing you logged has been lost.
        </Text>
      </View>
      {/* `alignSelf: 'flex-start'` on `Button`'s container beats this
          column's `alignItems: 'center'`, so the wrapper is what centres —
          the same shape `EmptyState` uses. */}
      <View>
        <Button variant="primary" size="md" density="client" onPress={onRetry}>
          Try again
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    alignItems: 'center',
    gap: density.client.sectionGap,
    paddingHorizontal: density.client.gutter,
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

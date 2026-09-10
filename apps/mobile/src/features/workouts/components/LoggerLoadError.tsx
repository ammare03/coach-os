import { Button, Text } from '@coachos/ui';
import { density, spacing } from '@coachos/ui/theme';
import { StyleSheet, View } from 'react-native';

// `ERRORS.md` ER§1.4's `LOCAL_READ_FAILED` on the logger: the device's own
// SQLite mirror refusing to answer. Never a code, never a stack trace, and
// the second line is the only thing the client actually wants to know
// mid-workout.
//
// The first line is adapted to this surface — the catalogue's row says
// "Today's session didn't load", which names the wrong screen once a
// session can be reached by deep link or on a day that is not today. The
// second line is verbatim, and it is the one ER§1.4 itself says matters
// more.
//
// **Composed locally rather than shared with `TodayCardError`, and that is
// a deliberate deferral.** The two are now the second consumer of one
// shape, which is `code-conventions` §1's promotion trigger, and
// `TodayCardError`'s own header predicted `session-runtime` would fire it.
// Promoting it means editing `packages/ui` and `TodayCard.tsx` while other
// tasks in this phase are in flight; the duplication is thirty lines of
// layout and the merge risk is not worth it in this PR.

export interface LoggerLoadErrorProps {
  onRetry: () => void;
}

/** `EmptyState`'s own measure, restated because this cannot import it (see above). */
const BODY_MAX_WIDTH = 270;

export function LoggerLoadError({ onRetry }: LoggerLoadErrorProps) {
  return (
    <View style={styles.block} testID="logger-error">
      <View style={styles.words}>
        <Text size="h2" accessibilityRole="header" style={styles.centred}>
          This workout didn&rsquo;t load.
        </Text>
        <Text size="body-lg" tone="muted" style={styles.body}>
          Nothing you logged has been lost.
        </Text>
      </View>
      {/* `alignSelf: 'flex-start'` on `Button`'s own container beats this
          column's `alignItems: 'center'`, so the wrapper is what centres. */}
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

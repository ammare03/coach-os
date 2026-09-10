import { Text } from '@coachos/ui';
import { density, spacing } from '@coachos/ui/theme';
import { StyleSheet, View } from 'react-native';

// A session with no prescription to page.
//
// **A permanent state, not a stub.** `today-card/04` lets a client start an
// ad-hoc session, and `useStartAdHocSession` writes a row whose payload has
// no exercises at all — so this screen is reachable today with nothing for
// task 03 to render. Without this the client gets a blank screen under the
// header.
//
// The copy is true of the second way the body ends up empty as well: a row
// whose `payload_json` was written by `lib/prefetch/history.ts` narrows to
// null and its prescription is unreadable (`useLoggerSession` rule (c)). It
// therefore never claims the client started this themselves, because in
// that case they did not.
//
// **No action, and that is not an oversight.** `ui-conventions` §4 asks an
// empty state for one clear next step, and this one has none to offer yet:
// adding an exercise mid-session is `session-modifications`, which is
// unbuilt. `EmptyState` requires a `primaryAction` by type precisely so a
// dead button cannot ship, so this composes its geometry instead of
// borrowing a handler that goes nowhere. When `session-modifications`
// lands, this becomes an `EmptyState` with "Add an exercise".

/** `EmptyState`'s own measure, restated because this cannot import it (see above). */
const BODY_MAX_WIDTH = 270;

export function LoggerNoPrescription() {
  return (
    <View style={styles.block} testID="logger-no-prescription">
      <Text size="h2" accessibilityRole="header" style={styles.centred}>
        Nothing prescribed for this one.
      </Text>
      <Text size="body-lg" tone="muted" style={styles.body}>
        Log whatever you train &mdash; it&rsquo;s all saved to this session.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    alignItems: 'center',
    gap: spacing(6),
    paddingHorizontal: density.client.gutter,
  },
  centred: {
    textAlign: 'center',
  },
  body: {
    textAlign: 'center',
    maxWidth: BODY_MAX_WIDTH,
  },
});

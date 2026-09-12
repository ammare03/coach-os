import { Text, createThemedStyles, spacing } from '@coachos/ui';
import { StyleSheet, View } from 'react-native';

// §8.3's Videos facet with nothing on it — and in P10 the ONLY state it can
// reach, because the procedure behind the grid ships with
// `phase-11-media-pipeline`. It is also the permanent state for a client who
// has never filmed a set, so it has to look deliberate either way.
//
// **No action, and that is not an oversight.** `ui-conventions` §4 asks an
// empty state for one clear next step and this one has none to give: only the
// CLIENT can upload a form check, so there is no coach-side action to offer,
// and every route this screen could send a coach to instead — the Chat tab,
// the annotator — is itself unbuilt today. `EmptyState` requires a
// `primaryAction` by type precisely so a dead button cannot ship, so this
// composes §9's geometry rather than borrowing a handler that goes nowhere.
// The same resolution, for the same reason, as
// `features/workouts/components/LoggerNoPrescription.tsx`.
//
// When `phase-14-messaging-and-realtime` lands, this becomes an `EmptyState`
// with "Ask for a form check" and the composer as its handler.

/** `EmptyState`'s own measure (`DESIGN.md` §9, ≤280px), restated because this cannot import it. */
const BODY_MAX_WIDTH = 270;

/**
 * §9's placeholder frames, at the empty state's own scale: three dashed
 * portrait slabs in the 3:4 the grid uses, so the shape a coach is waiting for
 * is the shape they are told about. Hidden from the reading order — the words
 * below carry the whole meaning (`accessibility` §2).
 */
function FramePlaceholders() {
  const themed = useThemedStyles();

  return (
    <View
      style={styles.frames}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={[styles.frame, styles.frameSide, themed.frame]} />
      <View style={[styles.frame, styles.frameCentre, themed.frameCentre]} />
      <View style={[styles.frame, styles.frameSide, themed.frame]} />
    </View>
  );
}

export function ClientVideosEmpty() {
  return (
    <View style={styles.block} testID="client-videos-empty">
      <FramePlaceholders />

      <View style={styles.words}>
        {/* §9 asks for a 20px Space Grotesk line; `h2` (21/25) is the closed
            scale's step for it, the same resolution `EmptyState` makes. */}
        <Text size="h2" accessibilityRole="header" style={styles.centred}>
          No form checks yet.
        </Text>
        {/* `COPY.md` §CO4.1 — state the fact, no apology. And §CO3: never
            editorialise about the other person. "This client has not uploaded
            anything" is the same fact worded as a complaint about them, and a
            coach may well be reading this a day after inviting them. */}
        <Text size="body" tone="muted" style={styles.body}>
          Videos this client uploads land here, with anything you have not reviewed at the top.
        </Text>
      </View>
    </View>
  );
}

const FRAME_ASPECT_RATIO = 3 / 4;
const FRAME_CENTRE_WIDTH = 44;
const FRAME_SIDE_WIDTH = 38;

const styles = StyleSheet.create({
  block: { alignItems: 'center', gap: spacing(16), paddingHorizontal: spacing(20) },
  frames: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing(9) },
  frame: { aspectRatio: FRAME_ASPECT_RATIO, borderWidth: 1, borderStyle: 'dashed' },
  frameSide: { width: FRAME_SIDE_WIDTH },
  frameCentre: { width: FRAME_CENTRE_WIDTH },
  words: { alignItems: 'center', gap: spacing(6) },
  centred: { textAlign: 'center' },
  body: { textAlign: 'center', maxWidth: BODY_MAX_WIDTH },
});

const useThemedStyles = createThemedStyles((t) => ({
  // `border.strong` and `border.tinted` are the interactive/tinted steps, and
  // the fill is the L1 inset well — the recessed treatment for something that
  // is not there yet, never the raised card of something that is.
  frame: { borderColor: t.colors.border.strong, backgroundColor: t.colors.bg.inset },
  frameCentre: { borderColor: t.colors.border.tinted, backgroundColor: t.colors.bg.inset },
}));

import { Text, createThemedStyles, createThemedValue, radius, spacing } from '@coachos/ui';
import { Lock } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

// §8.3's "labelled explicitly", made into one object with one geometry.
//
// **Zero props, deliberately.** A prop is how two call sites drift, and
// drift is exactly the risk `coach-notes/02`'s own Risks section names. The
// same component renders on the Notes tab (in the fixed head, above the
// scroll region) and on Overview (between the PINNED NOTES eyebrow and the
// first card), so the sentence cannot be two sentences.
//
// **A section banner, never a per-row chip.** A chip on every row repeats
// one sentence until it is texture, and it implies some rows might not be
// private. The claim is about the surface.
//
// **Not an eyebrow.** It replaced an 11px uppercase `PINNED NOTES · ONLY
// YOU CAN SEE THESE` line on Overview — fine print is what §8.3 rules out.
// 15px Medium in its own bordered well is what "explicitly" has to mean.

/** On screen. The em dash is the design's, and it is the only place it appears. */
export const PRIVACY_LABEL_TEXT = 'Private — never visible to your client';

/**
 * Spoken. Written out as two sentences because an em dash is not read
 * aloud reliably — a screen reader must not deliver this as one run-on
 * clause (`accessibility` §2).
 */
export const PRIVACY_LABEL_SPOKEN = 'Private. These notes are never visible to your client.';

const ICON_SIZE = 18;
const ICON_STROKE = 1.9;
const PADDING_VERTICAL = spacing(11);
const BORDER = 1;
const TEXT_LINE = 22; // `body`'s lineHeight — see `styles.text`.

/**
 * `1 + 11 + 22 + 11 + 1`. A floor, never a height: at 200% text the
 * sentence wraps to two lines and the well grows with it
 * (`accessibility` §3).
 */
export const PRIVACY_LABEL_MIN_HEIGHT = BORDER * 2 + PADDING_VERTICAL * 2 + TEXT_LINE;

export interface PrivacyLabelProps {
  testID?: string;
}

export function PrivacyLabel({ testID }: PrivacyLabelProps = {}) {
  const themed = useThemedStyles();
  const iconColor = useIconColor();

  return (
    // One node in the reading order, not two: the lock is decoration and
    // the sentence already says everything the lock hints at.
    <View
      style={[styles.well, themed.well]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={PRIVACY_LABEL_SPOKEN}
      testID={testID ?? 'privacy-label'}
    >
      <Lock
        size={ICON_SIZE}
        strokeWidth={ICON_STROKE}
        color={iconColor}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      {/* `body` is 15/22; `label` would be 15/20 and break the 46. The
          Medium face is asked for by name — setting `fontWeight` does
          nothing useful on Android (`Text`'s own contract). */}
      <Text size="body" className="font-sans-medium" style={styles.text}>
        {PRIVACY_LABEL_TEXT}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  well: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(11),
    minHeight: PRIVACY_LABEL_MIN_HEIGHT,
    borderRadius: radius.card,
    paddingVertical: PADDING_VERTICAL,
    paddingHorizontal: spacing(13),
    borderWidth: BORDER,
  },
  text: { flex: 1, minWidth: 0 },
});

const useThemedStyles = createThemedStyles((t) => ({
  well: {
    // L1 — the recessed-well fill, the same register as Overview's
    // injuries banner: a statement the product makes, not a card of
    // content and not a control (`DESIGN.md` §2).
    backgroundColor: t.elevation.inset.backgroundColor,
    // `border.strong`, not the L1 default `border.soft`: this well sits
    // directly above L2 note cards and a soft edge disappears against
    // them.
    borderColor: t.colors.border.strong,
  },
}));

const useIconColor = createThemedValue((t) => t.colors.fg['warm-muted']);

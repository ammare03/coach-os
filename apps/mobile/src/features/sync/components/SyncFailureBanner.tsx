import { Card, createThemedStyles, spacing, Text, useTheme } from '@coachos/ui';
import { AlertTriangle, ChevronRight } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

// DB§14.4's "surfaced in the UI as 'couldn't sync — retry', never silently
// dropped", as the design draws it (frame B, `Sync failure banner.dc.html`).
//
// Two decisions from that canvas that are easy to undo by accident:
//
//  - **Brand, never `urgent`.** DESIGN.md §1.1 reserves the maroon for
//    missed, overdue, and destructive. A stuck sync is none of the three —
//    the work is safe on the device — and the P08 cache-reset dialog made
//    the same call.
//  - **The whole row is the target.** A small "Retry" pill on the right
//    would put the recovery behind a smaller tap than the thing it
//    recovers, and it would split one idea into two accessible fragments.
//
// Attempts 1–9 are NOT this component. A row that is still backing off will
// almost always win, and announcing it would raise an alarm about a problem
// that resolves itself.

// `ERRORS.md` ER§1.4 `SYNC_PERMANENTLY_FAILED`, verbatim and split at the
// sentence the design stacks as a caption. Extracted for localisation and
// so the banner and the review sheet cannot drift apart.
export const SYNC_FAILURE_CAPTION = 'Tap to see what’s stuck.';

export function syncFailureTitle(count: number): string {
  return count === 1 ? '1 item couldn’t be saved' : `${count} items couldn’t be saved`;
}

export type SyncFailureBannerProps = {
  /** Outbox rows at DB§14.4's attempt ceiling. Zero renders nothing. */
  count: number;
  /** Opens the review surface — `SyncFailureSheet`, where the retry lives. */
  onPress: () => void;
};

export function SyncFailureBanner({ count, onPress }: SyncFailureBannerProps) {
  const theme = useTheme();
  const themed = useThemedStyles();
  const label = `${syncFailureTitle(count)}. ${SYNC_FAILURE_CAPTION}`;

  // Announced once, at the transition into failure — never a live region,
  // which would re-read the banner on every flush while someone is mid-set
  // (`accessibility` §2, and the canvas's own a11y note).
  const wasFailing = useRef(false);
  useEffect(() => {
    if (count > 0 && !wasFailing.current) AccessibilityInfo.announceForAccessibility(label);
    wasFailing.current = count > 0;
  }, [count, label]);

  if (count === 0) return null;

  return (
    // `density="coach"` for its 14px inset, which is the compactness the
    // design draws — not a statement about which app this is in. The banner
    // has to read as smaller than the cards it sits above.
    <Card elevation="raised" density="coach" onPress={onPress} accessibilityLabel={label}>
      <View style={styles.row}>
        <View
          style={[styles.glyph, themed.glyph]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <AlertTriangle size={17} color={theme.colors.brand.DEFAULT} />
        </View>
        <View style={styles.text}>
          <Text size="label">{syncFailureTitle(count)}</Text>
          {/* `muted`, not `subtle`: DESIGN.md §13 allows `subtle` at ≥14px
              only, and this caption is 12px. The canvas's colour is the one
              thing on it that a guideline overrules. */}
          <Text size="caption" tone="muted">
            {SYNC_FAILURE_CAPTION}
          </Text>
        </View>
        <ChevronRight size={16} color={theme.colors.fg.subtle} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(11),
    // Matches the glyph, so the row never collapses below it. The ≥44px
    // target is the Card: this plus `density="coach"`'s 14px inset each side.
    minHeight: 32,
  },
  glyph: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  text: {
    flex: 1,
    gap: spacing(3),
  },
});

const useThemedStyles = createThemedStyles((theme) => ({
  glyph: { ...theme.elevation.inset },
}));

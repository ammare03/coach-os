import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { density as densityTokens, glass, type Density } from '../theme/tokens.ts';

import { Button } from './Button.tsx';

export type SheetFooterProps = {
  /**
   * The commit label. `DESIGN.md` §10.8 — **action labels count**: "Add 2
   * items", "Log set 3". A footer button reading "Done" is a defect, not a
   * style preference.
   */
  actionLabel: string;
  onAction: () => void;
  /**
   * The button stays inert until something is actually picked
   * (`DESIGN.md` §9, bottom sheet). Default `true` so the safe state is the
   * one you get by forgetting.
   */
  isActionDisabled?: boolean;
  isActionLoading?: boolean;
  density?: Density;
};

/**
 * Pins the sheet's action above **both** the keyboard and the home
 * indicator. This is the single most-copied piece of layout in the app;
 * composing the two insets correctly here is what stops it being
 * re-derived — and got subtly wrong — in five different features.
 *
 * There is deliberately no "Cancel" button. The sheet is dismissed by the
 * handle, the backdrop, or the header's close; a Cancel steals horizontal
 * space from the action that actually matters.
 */
export function SheetFooter({
  actionLabel,
  onAction,
  isActionDisabled = true,
  isActionLoading = false,
  density = 'client',
}: SheetFooterProps) {
  const insets = useSafeAreaInsets();
  const pad = densityTokens[density].cardPadding;

  return (
    <View
      style={[
        styles.footer,
        {
          paddingHorizontal: pad,
          paddingTop: pad,
          // The home indicator on a notched iPhone and the gesture bar on
          // Android are two different insets; `bottom` covers both, and the
          // `pad` floor keeps a device with neither from looking cramped.
          paddingBottom: Math.max(insets.bottom, pad),
        },
      ]}
    >
      <View style={styles.hairline} pointerEvents="none" />
      <Button
        variant="primary"
        size={density === 'client' ? 'lg' : 'md'}
        fullWidth
        onPress={onAction}
        disabled={isActionDisabled}
        loading={isActionLoading}
      >
        {actionLabel}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    gap: 10,
  },
  // The faked inset top edge (`DESIGN.md` §12) — separates the footer from
  // the scrolling content above it without a full divider.
  hairline: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: glass.tier2.highlight,
  },
});

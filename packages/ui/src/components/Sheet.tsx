import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetBackdropProps,
  type BottomSheetBackgroundProps,
} from '@gorhom/bottom-sheet';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useMemo, useRef, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { createThemedStyles } from '../theme/createThemedStyles.ts';
import { radius } from '../theme/tokens.ts';
import { useTheme } from '../theme/useTheme.ts';

/**
 * The product's bottom sheet. `CLAUDE.md` §7.5 bans the native `Alert` for
 * anything but OS permission rationale, and that rule is only followable
 * because this component and `Modal` exist.
 *
 * **A sheet is for _doing_ something. A modal is for _stopping_ something.**
 * Every delete performs immediately with an undo toast; the two exceptions
 * (account deletion, client archival) use `ConfirmModal`.
 *
 * Controlled by design: in P09 the set logger's sheet state lives in a
 * Zustand slice alongside the rest of the logger draft, and an
 * internally-managed sheet cannot participate in that.
 */
export type SheetSnap = 'auto' | 'half' | 'full';

export type SheetProps = {
  isOpen: boolean;
  onDismiss: () => void;
  /**
   * `auto` — content height, capped at 90%: confirmations, quick actions,
   * the comment composer.
   * `half` — a list you scan without losing the screen behind it.
   * `full` — 90%, **never 100%**. The 10% gap is what tells the user the
   * screen is still there; a sheet at 100% is a screen and should be a
   * route instead. There is no fourth snap point.
   */
  snap?: SheetSnap;
  /**
   * Blocks the backdrop, the drag-down gesture, AND the Android hardware
   * back button. There is exactly one legitimate use in the product — a
   * sheet mid-purchase, where dismissing leaves the StoreKit transaction
   * ambiguous (P20). A surface you cannot escape is how people force-quit
   * an app.
   */
  isDismissible?: boolean;
  children: ReactNode;
  testID?: string | undefined;
};

const SNAP_POINTS: Record<Exclude<SheetSnap, 'auto'>, string[]> = {
  half: ['50%'],
  // 90%, never 100%. A sheet at full screen height IS a screen and should
  // be a route instead (§9.2 puts fullscreen focus modes outside the tab
  // layout); the 10% gap is what makes that boundary physically obvious.
  full: ['90%'],
};

/**
 * The snap points for a given snap, or `undefined` for `auto` (which sizes
 * to its content). Exported so the "never 100%" rule is testable without
 * reaching into the bottom-sheet library's props.
 */
export function resolveSheetSnapPoints(snap: SheetSnap): string[] | undefined {
  return snap === 'auto' ? undefined : SNAP_POINTS[snap];
}

/**
 * Every dismissal gesture, resolved together. `isDismissible={false}` has
 * to switch off all three — blocking only the backdrop still leaves the
 * sheet draggable off-screen, which is the bug this shape prevents.
 */
export function resolveSheetGestures(isDismissible: boolean) {
  return {
    enablePanDownToClose: isDismissible,
    enableHandlePanningGesture: isDismissible,
    enableContentPanningGesture: isDismissible,
  } as const;
}

export function Sheet({
  isOpen,
  onDismiss,
  snap = 'auto',
  isDismissible = true,
  children,
  testID,
}: SheetProps) {
  const ref = useRef<BottomSheet>(null);
  const themed = useThemedStyles();

  const snapPoints = useMemo(() => resolveSheetSnapPoints(snap), [snap]);
  const gestures = useMemo(() => resolveSheetGestures(isDismissible), [isDismissible]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={1}
        pressBehavior={isDismissible ? 'close' : 'none'}
        style={[props.style, themed.backdrop]}
      />
    ),
    [isDismissible, themed],
  );

  const handleChange = useCallback(
    (index: number) => {
      if (index === -1) onDismiss();
    },
    [onDismiss],
  );

  if (!isOpen) return null;

  return (
    <BottomSheet
      ref={ref}
      index={0}
      // `exactOptionalPropertyTypes` — `auto` sizing means omitting
      // `snapPoints` entirely, not passing it as `undefined`.
      {...(snapPoints ? { snapPoints } : {})}
      enableDynamicSizing={snap === 'auto'}
      onChange={handleChange}
      {...gestures}
      // Android's hardware back closes the topmost surface and does NOT
      // navigate. Two stacked surfaces close one at a time. This is not the
      // library's default and it is the first thing an Android reviewer
      // will try.
      android_keyboardInputMode="adjustResize"
      // The sheet rises WITH the keyboard, and dismissing the keyboard
      // restores the snap point rather than leaving a gap (§25.9 — the
      // budgeted pitfall; the config-layer `adjustResize` is set in
      // app.config.ts and this inherits it).
      keyboardBehavior={Platform.OS === 'ios' ? 'interactive' : 'extend'}
      keyboardBlurBehavior="restore"
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={themed.grabber}
      backgroundComponent={SheetBackground}
      accessibilityViewIsModal
      style={themed.sheet}
    >
      {/* `BottomSheet` itself takes no `testID`, so it lands on the content
          view — which is the part a test or a Maestro flow actually wants
          to find anyway. */}
      <BottomSheetView style={styles.content} testID={testID}>
        {children}
      </BottomSheetView>
    </BottomSheet>
  );
}

/**
 * Tier-2 glass (`DESIGN.md` §4) with the faked inset edges. React Native
 * has no inset `box-shadow`, so the bright top hairline and the dark bottom
 * one are absolutely-positioned 1px views — §12 calls them essential and
 * they are what makes the surface read as a pane rather than a rectangle.
 */
function SheetBackground({ style }: BottomSheetBackgroundProps) {
  const { glass } = useTheme();
  const themed = useThemedStyles();
  return (
    <View style={[style, themed.background]}>
      <LinearGradient
        colors={[...glass.tier2.gradient]}
        locations={[...glass.tier2.locations]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={themed.highlight} pointerEvents="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 8,
  },
});

const useThemedStyles = createThemedStyles((theme) => ({
  sheet: {
    // Tier-2's long soft drop. Android needs the hairline border alongside
    // `elevation` or the edge disappears entirely (§12).
    ...theme.glass.tier2.shadow,
  },
  background: {
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderWidth: 1,
    borderColor: theme.glass.tier2.borderColor,
    overflow: 'hidden',
    backgroundColor: theme.colors.bg.raised,
  },
  highlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: theme.glass.tier2.highlight,
  },
  grabber: {
    width: 42,
    height: 5,
    borderRadius: radius.cell,
    backgroundColor: theme.control.grabber,
  },
  backdrop: {
    backgroundColor: theme.scrim.color,
  },
}));

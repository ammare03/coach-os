import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, type ReactNode } from 'react';
import {
  BackHandler,
  Modal as RNModal,
  Pressable as RNPressable,
  StyleSheet,
  View,
} from 'react-native';

import { elevation, glass, radius, scrim } from '../theme/tokens.ts';

export type ModalProps = {
  isOpen: boolean;
  onDismiss: () => void;
  /** `false` blocks the backdrop AND the Android hardware back button. */
  isDismissible?: boolean;
  children: ReactNode;
  testID?: string | undefined;
};

/**
 * A centred, focus-trapped dialog.
 *
 * **A sheet is for _doing_ something; a modal is for _stopping_ something.**
 * `CLAUDE.md` §7.5 permits exactly two stopping points in the whole product
 * — account deletion (§21.4) and client archival — and both take a typed
 * confirmation. Everything else, including every delete, performs
 * immediately with an undo toast (`screen-states/03`).
 *
 * So this component ships with two known consumers and no more. A third is
 * a design review, not an import: confirmation dialogs train people to tap
 * "yes" without reading, which is precisely why undo is the pattern.
 */
export function Modal({ isOpen, onDismiss, isDismissible = true, children, testID }: ModalProps) {
  // Back closes the topmost surface; it does not navigate. Two stacked
  // surfaces close one at a time, which falls out of each mounted modal
  // registering its own handler — the last one registered wins, and
  // returning `true` stops the event propagating to the router.
  useEffect(() => {
    if (!isOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isDismissible) onDismiss();
      return true;
    });
    return () => sub.remove();
  }, [isOpen, isDismissible, onDismiss]);

  return (
    <RNModal
      visible={isOpen}
      transparent
      animationType="fade"
      onRequestClose={isDismissible ? onDismiss : undefined}
      statusBarTranslucent
      testID={testID}
    >
      <RNPressable
        style={styles.scrim}
        onPress={isDismissible ? onDismiss : undefined}
        // The scrim is a dismissal affordance, not a control a screen
        // reader should land on — the dialog below traps focus instead.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <View style={styles.centre} pointerEvents="box-none">
        <View
          style={styles.dialog}
          // iOS: nothing behind the dialog is reachable. Android's
          // equivalent is set on the scrim above, since RN has no
          // cross-platform focus trap.
          accessibilityViewIsModal
          accessibilityRole="alert"
        >
          <LinearGradient
            colors={[...elevation.raised.gradient]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          {/* The faked inset edges (`DESIGN.md` §12) — RN has no inset
              box-shadow, and without these the dialog reads as a flat
              rectangle rather than a lifted pane. */}
          <View style={styles.highlight} pointerEvents="none" />
          <View style={styles.lowlight} pointerEvents="none" />
          {children}
        </View>
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: scrim.color,
  },
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  dialog: {
    width: '100%',
    maxWidth: 340,
    borderRadius: radius.section,
    borderWidth: 1,
    borderColor: elevation.raised.borderColor,
    overflow: 'hidden',
    padding: 20,
    gap: 14,
    ...elevation.raised.shadow,
  },
  highlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: glass.tier2.highlight,
  },
  lowlight: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: glass.tier2.lowlight,
  },
});

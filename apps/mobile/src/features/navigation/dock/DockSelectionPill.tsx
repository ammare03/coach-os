import { createThemedStyles, useTheme } from '@coachos/ui';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View } from 'react-native';

const GRADIENT_TOP = { x: 0, y: 0 } as const;
const GRADIENT_BOTTOM = { x: 0, y: 1 } as const;

export interface DockSelectionPillProps {
  /**
   * The pill's corner radius. A dock's is always `radius.full`; the prop
   * exists because §9 states the radius per surface (dock 32, the narrower
   * bars 26) and it is always half the box, never a shared literal.
   */
  cornerRadius: number;
  testID?: string | undefined;
}

/**
 * `DESIGN.md` §4's selection pill, as material only.
 *
 * It fills the box its caller positions and owns no position, no width and
 * no motion of its own — because the two docks move it differently and both
 * are right. The coach bar cross-fades one pill per item (the prototype's
 * own `transition: background 220ms`); the client bar slides a single pill
 * across the row, and jumps it under reduced motion. Sharing the movement
 * would have meant picking one of those, which is a design change; sharing
 * the material costs nothing and is where the duplication actually was.
 *
 * Three things it does own, each of which was written twice before:
 *
 * - the 180° gradient, because React Native has no CSS gradient and a flat
 *   `backgroundColor` is a silent downgrade of §4's material;
 * - §12's faked inset hairline — RN has no inset box-shadow, so
 *   `inset 0 1px 0` becomes a 1px view clipped to the pill's own radius;
 * - the drop shadow, on the outer view rather than the clipping one.
 *   `overflow: 'hidden'` and a shadow on the same node swallow the shadow
 *   on iOS, so the material clips exactly one layer in.
 */
export function DockSelectionPill({ cornerRadius, testID }: DockSelectionPillProps) {
  const { selectionPill } = useTheme();
  const styles = usePillStyles();

  return (
    <View
      pointerEvents="none"
      testID={testID}
      style={[layout.drop, styles.drop, { borderRadius: cornerRadius }]}
    >
      <View style={[layout.clip, { borderRadius: cornerRadius }]}>
        <LinearGradient
          colors={selectionPill.gradient}
          start={GRADIENT_TOP}
          end={GRADIENT_BOTTOM}
          style={StyleSheet.absoluteFill}
        />
        <View style={[layout.hairline, styles.hairline]} />
      </View>
    </View>
  );
}

const usePillStyles = createThemedStyles((theme) => ({
  drop: theme.selectionPill.shadow,
  hairline: { backgroundColor: theme.selectionPill.highlight },
}));

// React Native 0.86 no longer types `StyleSheet.absoluteFillObject`; the
// four properties it stood for are spelled out once here.
const ABSOLUTE_FILL = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
} as const;

const layout = StyleSheet.create({
  drop: ABSOLUTE_FILL,
  clip: {
    ...ABSOLUTE_FILL,
    overflow: 'hidden',
  },
  hairline: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
  },
});

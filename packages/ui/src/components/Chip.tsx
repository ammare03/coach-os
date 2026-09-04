import { LinearGradient } from 'expo-linear-gradient';
import { X } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  colors,
  control,
  radius,
  selectionPill,
  tapTarget,
  type Density,
} from '../theme/tokens.ts';

import { IconButton } from './IconButton.tsx';
import { Pressable } from './Pressable.tsx';
import { Text } from './Text.tsx';

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  iconLeft?: ReactNode;
  /** When supplied, the chip renders a SECOND, separate 44px touch target — pressing it never fires `onPress` (`ui-primitives-core/05`). */
  onRemove?: () => void;
  /**
   * Accepted for interface consistency with every other P04 primitive
   * (CONTRACT.md rule 4), but currently a no-op: unlike `Button`/`Card`,
   * DESIGN.md §9 gives the chip exactly one literal geometry (33px,
   * padding 0/14) with no coach/client variant. Kept typed rather than
   * dropped so a future density-specific chip size is an additive change,
   * not a breaking one.
   */
  density?: Density;
  testID?: string;
}

const CHIP_HEIGHT = 33;
const CHIP_PADDING_HORIZONTAL = 14;
// CONTRACT.md rule 3 — the 44px floor is reached with symmetric `hitSlop`,
// never by growing the visible chip past DESIGN.md's 33px literal.
const CHIP_HIT_SLOP = Math.ceil((tapTarget.MIN - CHIP_HEIGHT) / 2);

/**
 * A small labelled control with `selected`, an optional leading icon, and
 * an optional remove affordance. Zero-or-more from an open set that may
 * wrap onto a second line — never a horizontally scrolling row, which
 * would hide options a client needs to see in full to answer accurately
 * (equipment access, dietary restrictions). This is the whole difference
 * from `SegmentedControl`: that component is exactly one choice from a
 * fixed, always-visible 2-4 option set.
 */
export function Chip({ label, selected = false, onPress, iconLeft, onRemove, testID }: ChipProps) {
  const interactive = Boolean(onPress);

  return (
    <View style={styles.row}>
      <Pressable
        onPress={onPress}
        disabled={!interactive}
        hitSlop={CHIP_HIT_SLOP}
        accessibilityRole={interactive ? 'button' : undefined}
        accessibilityLabel={label}
        accessibilityState={{ selected }}
        testID={testID}
        containerStyle={selected ? styles.selectedShadow : undefined}
        style={[
          styles.chip,
          selected
            ? styles.chipSelected
            : { backgroundColor: control.surface, borderColor: colors.border.strong },
        ]}
      >
        {selected ? (
          <>
            <LinearGradient
              colors={selectionPill.gradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <View
              pointerEvents="none"
              style={[styles.hairlineTop, { backgroundColor: selectionPill.highlight }]}
            />
          </>
        ) : null}
        <View style={styles.content}>
          {iconLeft}
          <Text size="label" tone={selected ? 'bright' : 'muted'} numberOfLines={1}>
            {label}
          </Text>
        </View>
      </Pressable>

      {onRemove ? (
        <IconButton
          icon={<X size={14} color={colors.fg.muted} />}
          variant="secondary"
          size="sm"
          onPress={onRemove}
          accessibilityLabel={`Remove ${label}`}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chip: {
    height: CHIP_HEIGHT,
    paddingHorizontal: CHIP_PADDING_HORIZONTAL,
    borderRadius: radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  chipSelected: {
    borderWidth: 0,
  },
  // DESIGN.md §4's selection-pill drop shadow, on the outer (non-clipped)
  // container — `overflow: 'hidden'` on `chip` above would otherwise clip it.
  selectedShadow: selectionPill.shadow,
  hairlineTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});

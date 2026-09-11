import { ChevronRight } from 'lucide-react-native';
import type { ComponentType, ReactNode } from 'react';
import { StyleSheet, Switch, View } from 'react-native';

import { density as densityTokens, spacing, type Density } from '../theme/tokens.ts';
import { useTheme } from '../theme/useTheme.ts';

import { Pressable } from './Pressable.tsx';
import { Text, type TextTone } from './Text.tsx';

/** Any component taking Lucide's two visual props. Declared here rather than imported: lucide-react-native does not export its `LucideIcon` type. */
export type ListRowIcon = ComponentType<{ size?: number; color?: string }>;

/**
 * The four trailing shapes the settings section map needs, plus an escape
 * hatch. Deliberately a discriminated union rather than four optional
 * props: `value` without a chevron and `switch` without a handler are both
 * expressible in the optional-prop version, and neither is a row.
 *
 * - `chevron` — the row navigates. The chevron is the affordance, not the
 *   control; it is hidden from the reading order.
 * - `value`   — a current setting plus the chevron (Weight unit, Appearance).
 * - `switch`  — toggles in place. The ROW is the switch, not the thumb: the
 *   thumb is 51×31 and would fail the tap floor on its own.
 * - `none`    — static. The App version row, and nothing that navigates.
 * - `custom`  — anything a later phase needs that is none of the above (a
 *   badge, an avatar stack). Rendered as-is, inside the trailing column.
 */
export type ListRowTrailing =
  | { kind: 'chevron' }
  | { kind: 'value'; value: string }
  | { kind: 'switch'; value: boolean; onValueChange: (next: boolean) => void }
  | { kind: 'none' }
  | { kind: 'custom'; render: () => ReactNode };

export interface ListRowProps {
  label: string;
  /** A second line under the label. Folded into the row's one accessibility label — two text nodes read as two items. */
  description?: string | undefined;
  /**
   * A Lucide icon COMPONENT, not an element — `icon={Download}`, never
   * `icon={<Download color={...} />}`.
   *
   * The row owns the size and the colour, so a destructive row's icon
   * cannot be left grey and a caller never has to reach for a colour token
   * to draw one. Same reasoning as `Text`'s `tone` and `Button`'s `danger`
   * variant: route the sanctioned use through the primitive, or the next
   * author writes an inline hex.
   *
   * Decorative either way — hidden from the reading order, because the
   * label already names the row.
   */
  icon?: ListRowIcon;
  /** Defaults to `chevron` when `onPress` is given and `none` when it is not. */
  trailing?: ListRowTrailing | undefined;
  onPress?: (() => void) | undefined;
  /**
   * `DESIGN.md` §1.1's `urgent` role, and nothing decorative: the label and
   * the icon recolour, the surface does not. A destructive row never draws
   * a chevron — it acts, it does not navigate.
   */
  destructive?: boolean;
  disabled?: boolean;
  density?: Density;
  /**
   * `button` (default) or `link`. `switch` is chosen by the trailing shape
   * and cannot be overridden, and a static row takes `text`.
   *
   * A row that pushes a route inside the app stays `button` — that is what
   * iOS Settings itself announces. `link` is for a row that leaves the app.
   */
  accessibilityRole?: 'button' | 'link';
  accessibilityHint?: string | undefined;
  testID?: string | undefined;
}

/**
 * `ui-conventions` §5 and `accessibility` §1 — 48, not `tapTarget.MIN`.
 * `DESIGN.md` §13 puts the floor at 44 and those two put it at 48; the
 * stricter number wins, and this is the row a client taps one-handed.
 *
 * Both densities' `row` values already clear it (66 client, 56 coach). The
 * floor exists so a future density cannot drop under it silently.
 */
export const LIST_ROW_MIN_HEIGHT = 48;

/** `DESIGN.md` §9's list-row glyph column. */
const ICON_SIZE = 20;

/** The one place the resolved row height is computed, so the test and the component cannot disagree. */
export function listRowMinHeight(density: Density): number {
  return Math.max(densityTokens[density].row, LIST_ROW_MIN_HEIGHT);
}

/**
 * A row in a settings-style list — the shape the settings screen, the coach
 * More hub, P15's notification toggles, and P26's blocked list are all made
 * of.
 *
 * Three rules it enforces so no caller has to remember them:
 *
 * 1. **One accessible item.** Label, description, and value merge into a
 *    single `accessibilityLabel`; the icon and the chevron leave the
 *    reading order. A row that reads as four fragments is exactly the
 *    failure `accessibility` §2 names for list rows.
 * 2. **The whole row is the target**, including the switch variant — the
 *    thumb is 31pt tall and is never the thing you tap.
 * 3. **Min-height, never height.** At 200% text the label wraps and the row
 *    grows; nothing clips and nothing is capped (`accessibility` §3).
 */
export function ListRow({
  label,
  description,
  icon: Icon,
  trailing,
  onPress,
  destructive = false,
  disabled = false,
  density: densityProp = 'client',
  accessibilityRole = 'button',
  accessibilityHint,
  testID,
}: ListRowProps) {
  const theme = useTheme();
  const shape: ListRowTrailing = trailing ?? (onPress ? { kind: 'chevron' } : { kind: 'none' });

  // `urgent` is `DESIGN.md` §1.1's accent text on dark (#FF8A9B), not the
  // `urgent` fill — a destructive row is a label, never a red surface.
  const labelTone: TextTone = disabled ? 'faint' : destructive ? 'urgent' : 'default';
  const secondaryTone: TextTone = disabled ? 'faint' : 'muted';
  // The icon follows the label, never its own decision. `urgent-text` here
  // is §1.1's "accent text on dark" role for a destructive control, not an
  // adherence signal — the same entitlement `Button`'s `danger` variant and
  // `Text`'s `tone="urgent"` already carry (`eslint.react-native.js`).
  const iconColor = disabled
    ? theme.colors.fg.faint
    : destructive
      ? theme.colors['urgent-text']
      : theme.colors.fg.muted;

  // On BOTH the outer pressable and the inner animated view: the outer is
  // the touch target the OS hit-tests, the inner is the box the content
  // lays out in. Guaranteeing only one of them leaves the other free to
  // fall under the floor.
  const minHeight = listRowMinHeight(densityProp);
  const rowStyle = [styles.row, { minHeight }];

  const content = (
    <>
      {Icon ? (
        <View
          style={styles.iconColumn}
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Icon size={ICON_SIZE} color={iconColor} />
        </View>
      ) : null}
      <View style={styles.labels}>
        {/* `DESIGN.md` §1.2's `label` step — 500 Instrument Sans, the face
            and weight §9 gives a list row's title. Never a `fontWeight`
            here: `Text` pins the weight to the size and setting it by hand
            does nothing on Android. */}
        <Text size="label" tone={labelTone}>
          {label}
        </Text>
        {description ? (
          <Text size="caption" tone={secondaryTone} style={styles.description}>
            {description}
          </Text>
        ) : null}
      </View>
      <View
        style={styles.trailing}
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {shape.kind === 'value' ? (
          <Text size="body-sm" tone={secondaryTone}>
            {shape.value}
          </Text>
        ) : null}
        {shape.kind === 'switch' ? (
          // `pointerEvents="none"` and no handler on the control itself:
          // the row owns the gesture and the role, so the thumb can never
          // become a second, smaller target beside it.
          <View pointerEvents="none">
            <Switch
              value={shape.value}
              disabled={disabled}
              trackColor={{ false: theme.colors.bg.inset, true: theme.colors.brand.DEFAULT }}
              thumbColor={theme.colors.fg.glass}
              ios_backgroundColor={theme.colors.bg.inset}
            />
          </View>
        ) : null}
        {shape.kind === 'custom' ? shape.render() : null}
        {/* Wrapped rather than given the `testID` directly: Lucide does not
            forward arbitrary props to the underlying SVG, so the rule
            "a destructive row draws no chevron" would be untestable. */}
        {(shape.kind === 'chevron' || shape.kind === 'value') && !destructive ? (
          <View testID="list-row-chevron">
            <ChevronRight size={16} color={theme.colors.fg.faint} />
          </View>
        ) : null}
      </View>
    </>
  );

  const accessibilityLabel = [label, description, shape.kind === 'value' ? shape.value : undefined]
    .filter((part): part is string => Boolean(part))
    .join(', ');

  if (shape.kind === 'switch') {
    const { value, onValueChange } = shape;
    return (
      <Pressable
        testID={testID}
        disabled={disabled}
        onPress={() => onValueChange(!value)}
        accessibilityRole="switch"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ checked: value }}
        containerStyle={{ minHeight }}
        style={rowStyle}
      >
        {content}
      </Pressable>
    );
  }

  if (onPress) {
    return (
      <Pressable
        testID={testID}
        disabled={disabled}
        onPress={onPress}
        accessibilityRole={accessibilityRole}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        containerStyle={{ minHeight }}
        style={rowStyle}
      >
        {content}
      </Pressable>
    );
  }

  // Static: no handler, so no control. It still reads as one item with its
  // value, which is the whole point of the App version row existing.
  return (
    <View
      testID={testID}
      style={rowStyle}
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
    >
      {content}
    </View>
  );
}

// Scheme-invariant geometry at module scope; every colour comes through
// `Text`'s tone or `useTheme()` (`createThemedStyles`' contract — a sheet
// with no colour in it does not need the hook).
const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(12),
    paddingHorizontal: spacing(16),
    // Vertical padding rather than a fixed height: at 200% text the label
    // wraps and the row grows around it.
    paddingVertical: spacing(12),
  },
  iconColumn: {
    width: spacing(26),
    alignItems: 'flex-start',
  },
  labels: {
    flex: 1,
    minWidth: 0,
  },
  description: {
    marginTop: spacing(3),
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(8),
    flexShrink: 0,
  },
});

import { Pressable, Text, useTheme } from '@coachos/ui';
import type { LucideIcon } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import type { DockItemGeometry } from './dock-item-geometry.ts';

export type { DockItemGeometry } from './dock-item-geometry.ts';

/**
 * §1.2's type scale bottoms out at `micro` (11px); §9's dock label is 10px,
 * a step the scale does not have. `micro` is the nearest, and rounding UP
 * is the right direction for the one app read at arm's length in a badly
 * lit room (`CLAUDE.md` §1.1). Reported rather than hardcoded — adding a
 * 10px step to `packages/ui` is a design decision, not one a dock takes.
 */
const LABEL_SIZE = 'micro' as const;

export interface DockItemProps {
  /** This dock's own geometry record. There is no default — see the type. */
  geometry: DockItemGeometry;
  Icon: LucideIcon;
  /**
   * The visible label. `DESIGN.md` §13 — an icon never travels alone in
   * navigation, so this is required and there is no icon-only variant.
   */
  label: string;
  focused: boolean;
  /**
   * The accessible name, composed by the caller. A count folded into it
   * there is the only way a badge reaches a screen reader, since badges
   * are hidden from the reading order (`accessibility` §2).
   */
  accessibilityLabel: string;
  /**
   * `tab` inside a tablist; `button` for a dock-shaped surface that is not
   * navigation — §9's Action bar, whose entries are commands in a toolbar.
   */
  accessibilityRole?: 'tab' | 'button';
  onPress: () => void;
  onLongPress?: (() => void) | undefined;
  /**
   * Drawn behind the glyph and the label. A per-item selection pill goes
   * here; a dock that slides ONE pill across its row mounts it on the row
   * instead and leaves this empty.
   */
  pill?: ReactNode;
  /** Anchored to the glyph box, so it tracks the icon rather than the item. */
  glyphAccessory?: ReactNode;
  /** Anchored to the item box, for a badge positioned against the item. */
  itemAccessory?: ReactNode;
  testID?: string | undefined;
  /**
   * The glyph wrapper's testID. It sits on a wrapper and never on the icon
   * because neither Lucide nor `react-native-svg` forwards one to a host
   * node — Lucide maps it to the web-only `data-testid` — and an icon that
   * cannot be asserted is an icon that can silently go missing.
   */
  iconTestID?: string | undefined;
}

/**
 * One item of a `DESIGN.md` §9 dock: selection pill, glyph, label, hit
 * slop.
 *
 * The coach dock and the client dock were built concurrently
 * (`router-skeleton` tasks 03 and 04) and each was told not to create this
 * file, because two agents writing the same module at once is the one
 * failure mode guaranteed to conflict. Both then independently reported the
 * duplication and both named this exact seam, which is what UNFORGET S11
 * records and what this closes.
 *
 * **It composes; it does not decide.** Every number it draws with arrives
 * in `geometry`, and the two docks pass two different records on purpose —
 * §9 gives ranges, and the two apps sit at their ends (`ui-conventions` §1:
 * the density difference is a prop, never a forked component). Nothing here
 * may acquire a default for a value §9 states as a range.
 *
 * **Motion is the caller's.** §5 forbids animated tab-bar icons outright,
 * so the glyph and its colour swap instantly; the only thing that moves in
 * a dock is the pill, and the two docks move theirs differently. Passing
 * the pill in as a node is what lets each keep its own — and lets §9's
 * Action bar, the likely next consumer, pass none at all.
 */
export function DockItem({
  geometry,
  Icon,
  label,
  focused,
  accessibilityLabel,
  accessibilityRole = 'tab',
  onPress,
  onLongPress,
  pill,
  glyphAccessory,
  itemAccessory,
  testID,
  iconTestID,
}: DockItemProps) {
  const { colors } = useTheme();
  const tint = focused ? colors.fg.bright : colors.fg.muted;

  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: focused }}
      onPress={onPress}
      onLongPress={onLongPress}
      pressScale={geometry.pressScale}
      hitSlop={geometry.hitSlop}
      containerStyle={layout.container}
      style={[layout.item, { minHeight: geometry.itemHeight, gap: geometry.itemGap }]}
      testID={testID}
    >
      {pill}

      <View testID={iconTestID} style={layout.glyph}>
        <Icon size={geometry.iconSize} strokeWidth={geometry.iconStrokeWidth} color={tint} />
        {glyphAccessory}
      </View>

      <Text
        size={LABEL_SIZE}
        tone={focused ? 'bright' : 'muted'}
        numberOfLines={1}
        maxFontSizeMultiplier={geometry.labelMaxFontScale}
        style={geometry.labelTracking === 0 ? undefined : { letterSpacing: geometry.labelTracking }}
      >
        {label}
      </Text>

      {itemAccessory}
    </Pressable>
  );
}

const layout = StyleSheet.create({
  // Items share their row equally. A dock's width is the device's, so the
  // item count is what sets the target width (`clientDockItemHitArea`).
  container: {
    flex: 1,
  },
  item: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

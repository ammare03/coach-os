import { Badge, GlassSurface } from '@coachos/ui';
import { duration, easing, useReducedMotion } from '@coachos/ui/theme';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { ChartColumn, House, MessageSquare, Utensils, type LucideIcon } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { DockItem, DockSelectionPill } from '../dock/index.ts';

import { CLIENT_DOCK, CLIENT_DOCK_ITEM, clientDockBottom } from './client-dock-geometry.ts';

interface ClientTabMeta {
  label: string;
  Icon: LucideIcon;
}

/**
 * Today · Nutrition · Progress · Coach — `UI-UX.md` §UX1.2, in that order,
 * keyed by the route file name under `(client)/(tabs)/`.
 *
 * Icons are Lucide (`CLAUDE.md` §3.1 — SF Symbols are iOS-only and
 * forbidden), each chosen because its geometry is the prototype's
 * geometry (`CoachOS-Client.dc.html`, the `tabs` array):
 *
 * - Today → `House`. The prototype draws a bare roof-over-walls outline;
 *   `House` is the same silhouette with a door.
 * - Nutrition → `Utensils`. The prototype draws a fork beside a spoon;
 *   Lucide's is a fork beside a spoon-headed knife — same two-utensil
 *   composition. `UtensilsCrossed` was rejected: crossed cutlery reads as
 *   "closed" or "unavailable" in most icon sets.
 * - Progress → `ChartColumn`. Both are an L-shaped axis carrying three
 *   columns of unequal height — the prototype's `M7 16V9 / M12 16V5 /
 *   M17 16v-6` against Lucide's `M8 17v-3 / M13 17V5 / M18 17V9`.
 * - Coach → `MessageSquare`. A rounded rectangle with a tail dropping from
 *   its lower-left, in both.
 *
 * `DESIGN.md` §13: an icon never travels alone in navigation. `DockItem`
 * requires both channels and offers no icon-only variant.
 */
const CLIENT_TABS: Record<string, ClientTabMeta> = {
  index: { label: 'Today', Icon: House },
  nutrition: { label: 'Nutrition', Icon: Utensils },
  progress: { label: 'Progress', Icon: ChartColumn },
  coach: { label: 'Coach', Icon: MessageSquare },
};

/**
 * The badge hangs off the glyph's top-right corner rather than off the
 * item's, so it tracks the icon — this dock's items are ~25% wider than the
 * five-item coach dock's, and the coach prototype's `right: 12px` would
 * leave the badge stranded mid-air here. That is why it goes in
 * `DockItem`'s `glyphAccessory` slot and the coach's goes in
 * `itemAccessory`.
 */
const BADGE_OFFSET = { top: -6, right: -10 } as const;

const PILL_EASING = Easing.bezier(easing.fill[0], easing.fill[1], easing.fill[2], easing.fill[3]);

/**
 * The floating client dock — `DESIGN.md` §9's Dock component, built to
 * `CoachOS-Client.dc.html`'s four-item variant.
 *
 * **It floats.** `expo-router`'s default bar is flush and consumes layout
 * height; this one is absolutely positioned 26px off the bottom edge with
 * 16px side insets and a fully-rounded 32px radius, and content scrolls
 * beneath it. Screens reserve that space with `useClientTabBarInset()`,
 * never a number typed into a screen — a list whose last row sits under the
 * bar is the standard bug this material introduces (`UI-UX.md` §UX1.2).
 *
 * **The material is `<GlassSurface tier="tier1">` and nothing else.** That
 * primitive owns all three branches — real Liquid Glass on iOS 26+,
 * `expo-blur` under the tier gradient elsewhere, and the fully opaque
 * elevation under Reduce Transparency or Increase Contrast, switched at
 * runtime without a relaunch. Importing `expo-glass-effect` or `expo-blur`
 * here would fork that decision (`ui-conventions` §5).
 *
 * **Motion is one thing only.** §5 forbids animated tab-bar icons, so the
 * glyph and its colour swap instantly. The selection pill slides
 * (`duration.state` + `easing.fill`) because §4 says it moves between
 * options and the track never recolours, and it jumps rather than slides
 * under reduced motion — the state change is never optional, only its
 * animation is. The sliding is this file's; the pill's material is
 * `DockSelectionPill`'s, shared with the coach dock, which cross-fades one
 * per item instead (UNFORGET S11).
 *
 * **The item is `dock/DockItem`, drawn from `CLIENT_DOCK_ITEM`.** One
 * component, two geometry records — §9 states the dock as ranges and this
 * bar takes the client end of every one of them.
 */
export function ClientTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const reducedMotion = useReducedMotion();

  const tabs = state.routes.flatMap((route, index) => {
    const meta = CLIENT_TABS[route.name];
    return meta ? [{ route, meta, focused: state.index === index }] : [];
  });

  const focusedPosition = Math.max(
    0,
    tabs.findIndex((tab) => tab.focused),
  );

  const [rowWidth, setRowWidth] = useState(0);
  const itemWidth = tabs.length > 0 && rowWidth > 0 ? rowWidth / tabs.length : 0;
  const pillX = useSharedValue(0);

  useEffect(() => {
    const target = focusedPosition * itemWidth;
    if (reducedMotion) {
      pillX.value = target;
      return;
    }
    pillX.value = withTiming(target, { duration: duration.state, easing: PILL_EASING });
    // `pillX` is a Reanimated shared value — a stable ref, not a reactive dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedPosition, itemWidth, reducedMotion]);

  const pillStyle = useAnimatedStyle(() => ({
    width: itemWidth,
    transform: [{ translateX: pillX.value }],
  }));

  function handleLayout(event: LayoutChangeEvent) {
    setRowWidth(Math.max(0, event.nativeEvent.layout.width - CLIENT_DOCK.padding * 2));
  }

  return (
    // §9's `0 18px 40px -14px` is `GlassSurface`'s to render, on all three
    // of its paths — including the two that clip, where it wears the drop
    // on the surface view and clips the material one layer in. This file
    // supplies only the dock's geometry.
    <GlassSurface
      tier="tier1"
      testID="client-tab-bar"
      style={[
        styles.dock,
        {
          left: CLIENT_DOCK.sideInset,
          right: CLIENT_DOCK.sideInset,
          bottom: clientDockBottom(insets.bottom),
          borderRadius: CLIENT_DOCK.radius,
        },
      ]}
    >
      <View
        testID="client-tab-bar-tablist"
        accessibilityRole="tablist"
        onLayout={handleLayout}
        style={[
          styles.row,
          { minHeight: CLIENT_DOCK.height, paddingHorizontal: CLIENT_DOCK.padding },
        ]}
      >
        {itemWidth > 0 ? (
          <Animated.View
            pointerEvents="none"
            testID="client-tab-bar-selection-pill"
            style={[
              styles.pill,
              pillStyle,
              {
                top: CLIENT_DOCK.padding,
                bottom: CLIENT_DOCK.padding,
                left: CLIENT_DOCK.padding,
              },
            ]}
          >
            <DockSelectionPill cornerRadius={CLIENT_DOCK.radius} />
          </Animated.View>
        ) : null}

        {tabs.map(({ route, meta, focused }, position) => {
          const rawBadge = descriptors[route.key]?.options.tabBarBadge;
          const badgeCount = typeof rawBadge === 'number' && rawBadge > 0 ? rawBadge : undefined;

          function handlePress() {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          }

          function handleLongPress() {
            navigation.emit({ type: 'tabLongPress', target: route.key });
          }

          return (
            <DockItem
              key={route.key}
              geometry={CLIENT_DOCK_ITEM}
              Icon={meta.Icon}
              label={meta.label}
              focused={focused}
              onPress={handlePress}
              onLongPress={handleLongPress}
              // `Badge` hides itself from the reading order by design, so a
              // count has to be folded in here or it is silent
              // (`accessibility` §2). Factual, never "you have" (`COPY.md`).
              accessibilityLabel={
                badgeCount === undefined
                  ? `${meta.label}, tab ${position + 1} of ${tabs.length}`
                  : `${meta.label}, ${badgeCount} unread, tab ${position + 1} of ${tabs.length}`
              }
              iconTestID={`client-tab-icon-${route.name}`}
              glyphAccessory={
                badgeCount === undefined ? null : (
                  <View style={[styles.badge, BADGE_OFFSET]}>
                    <Badge tone="brand" size="sm" count={badgeCount} />
                  </View>
                )
              }
            />
          );
        })}
      </View>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // The box the pill is slid across. Its radius, gradient, hairline and
  // drop all belong to `DockSelectionPill` — which is also why this node no
  // longer clips: `overflow: 'hidden'` and a shadow on one view swallow the
  // shadow on iOS.
  pill: {
    position: 'absolute',
  },
  badge: {
    position: 'absolute',
  },
});

export { CLIENT_TABS };

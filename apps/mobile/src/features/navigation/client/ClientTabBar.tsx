import { Badge, GlassSurface, Pressable, Text, useTheme } from '@coachos/ui';
import { duration, easing } from '@coachos/ui/theme';
import { LinearGradient } from 'expo-linear-gradient';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { ChartColumn, House, MessageSquare, Utensils, type LucideIcon } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import {
  CLIENT_DOCK,
  CLIENT_DOCK_ITEM_HIT_SLOP,
  clientDockBottom,
} from './client-dock-geometry.ts';

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
 * `DESIGN.md` §13: an icon never travels alone in navigation. Every item
 * below renders icon AND label, and neither is optional.
 */
const CLIENT_TABS: Record<string, ClientTabMeta> = {
  index: { label: 'Today', Icon: House },
  nutrition: { label: 'Nutrition', Icon: Utensils },
  progress: { label: 'Progress', Icon: ChartColumn },
  coach: { label: 'Coach', Icon: MessageSquare },
};

/**
 * §1.2's type scale bottoms out at `micro` (11px); §9's dock label is 10px,
 * a step the scale does not have. `micro` is the nearest, and rounding UP
 * is the right direction for the one app read at arm's length in a badly
 * lit room (`CLAUDE.md` §1.1). Reported rather than hardcoded — adding a
 * 10px step to `packages/ui` is a design decision, not one a route task
 * takes on its own.
 */
const LABEL_SIZE = 'micro' as const;

/** The client dock's `letter-spacing: .01em`, at `micro`'s 11px. The coach dock sets none. */
const LABEL_TRACKING = 0.11;

/**
 * `accessibility` §3 accepts a tab bar's labels being lost at 200% text
 * ("icons carry it, and every tab has a label for screen readers"). Capping
 * is strictly better than losing them: at 1.6 the label grows 11 → 17.6px
 * and the item's content still measures 21 + 3 + 24 = 48px inside its 52px
 * box, so nothing clips and the bar never has to grow. The screen reader
 * reads `accessibilityLabel`, which no font scale truncates.
 */
const LABEL_MAX_FONT_SCALE = 1.6;

/**
 * The badge hangs off the glyph's top-right corner rather than off the
 * item's, so it tracks the icon — this dock's items are ~25% wider than the
 * five-item coach dock's, and the coach prototype's `right: 12px` would
 * leave the badge stranded mid-air here.
 */
const BADGE_OFFSET = { top: -6, right: -10 } as const;

const PILL_EASING = Easing.bezier(easing.fill[0], easing.fill[1], easing.fill[2], easing.fill[3]);

/**
 * Reduce Motion is a live, toggleable setting rather than a static device
 * capability, so it is subscribed and not sampled once — the same treatment
 * `useGlassAvailable` gives Reduce Transparency.
 *
 * Deliberately `AccessibilityInfo` rather than Reanimated's own
 * `useReducedMotion`: this is the fourth copy of this hook in the repo
 * (`SegmentedControl`, `Skeleton`, `Toast`), all of which read
 * `AccessibilityInfo`, and matching them keeps one mechanism in the
 * codebase instead of two. Promote all of them to
 * `packages/ui/src/theme/useReducedMotion.ts` when someone owns that file —
 * this task may not, since `packages/ui` is shared with work in flight.
 */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (mounted) setReduced(value);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) =>
      setReduced(value),
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reduced;
}

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
 * animation is.
 */
export function ClientTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const { colors, selectionPill } = useTheme();
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
              selectionPill.shadow,
              {
                top: CLIENT_DOCK.padding,
                bottom: CLIENT_DOCK.padding,
                left: CLIENT_DOCK.padding,
                borderRadius: CLIENT_DOCK.radius,
              },
            ]}
          >
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
          </Animated.View>
        ) : null}

        {tabs.map(({ route, meta, focused }, position) => {
          const rawBadge = descriptors[route.key]?.options.tabBarBadge;
          const badgeCount = typeof rawBadge === 'number' && rawBadge > 0 ? rawBadge : undefined;
          const tint = focused ? colors.fg.bright : colors.fg.muted;
          const Icon = meta.Icon;

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
            <Pressable
              key={route.key}
              onPress={handlePress}
              onLongPress={handleLongPress}
              pressScale={CLIENT_DOCK.pressScale}
              hitSlop={CLIENT_DOCK_ITEM_HIT_SLOP}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              // `Badge` hides itself from the reading order by design, so a
              // count has to be folded in here or it is silent
              // (`accessibility` §2). Factual, never "you have" (`COPY.md`).
              accessibilityLabel={
                badgeCount === undefined
                  ? `${meta.label}, tab ${position + 1} of ${tabs.length}`
                  : `${meta.label}, ${badgeCount} unread, tab ${position + 1} of ${tabs.length}`
              }
              containerStyle={styles.itemOuter}
              style={[styles.item, { minHeight: CLIENT_DOCK.itemHeight, gap: CLIENT_DOCK.itemGap }]}
            >
              {/* The testID sits on the wrapper, not the glyph: `react-native-svg`
                  does not forward one to its host view, and an icon that cannot be
                  asserted is an icon that can silently go missing. */}
              <View testID={`client-tab-icon-${route.name}`} style={styles.glyph}>
                <Icon
                  size={CLIENT_DOCK.iconSize}
                  color={tint}
                  strokeWidth={CLIENT_DOCK.iconStrokeWidth}
                />
                {badgeCount === undefined ? null : (
                  <View style={[styles.badge, BADGE_OFFSET]}>
                    <Badge tone="brand" size="sm" count={badgeCount} />
                  </View>
                )}
              </View>
              <Text
                size={LABEL_SIZE}
                tone={focused ? 'bright' : 'muted'}
                numberOfLines={1}
                maxFontSizeMultiplier={LABEL_MAX_FONT_SCALE}
                style={styles.label}
              >
                {meta.label}
              </Text>
            </Pressable>
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
  pill: {
    position: 'absolute',
    overflow: 'hidden',
  },
  hairlineTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
  },
  itemOuter: {
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
  badge: {
    position: 'absolute',
  },
  label: {
    letterSpacing: LABEL_TRACKING,
  },
});

export { CLIENT_TABS };

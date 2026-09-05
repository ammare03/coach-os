import {
  GlassSurface,
  Metric,
  Pressable,
  Text,
  createThemedStyles,
  duration,
  easing,
  radius,
  useTheme,
} from '@coachos/ui';
import { LinearGradient } from 'expo-linear-gradient';
import type { Tabs } from 'expo-router';
import type { LucideIcon } from 'lucide-react-native';
import { useEffect, type ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import {
  COACH_DOCK_BADGE_BORDER_WIDTH,
  COACH_DOCK_BADGE_RIGHT,
  COACH_DOCK_BADGE_SIZE,
  COACH_DOCK_BADGE_TOP,
  COACH_DOCK_HEIGHT,
  COACH_DOCK_ICON_SIZE,
  COACH_DOCK_ICON_STROKE_WIDTH,
  COACH_DOCK_ITEM_GAP,
  COACH_DOCK_ITEM_HEIGHT,
  COACH_DOCK_PADDING_X,
  COACH_DOCK_SIDE_INSET,
  resolveCoachDockBottom,
} from './coach-dock-metrics.ts';
import { COACH_TABS } from './coach-tabs.ts';

// The renderer's own prop type, read off `Tabs` rather than deep-imported
// from `expo-router/build/react-navigation/bottom-tabs` — the same type, and
// it cannot rot against a build-directory reshuffle.
type CoachTabBarRenderer = NonNullable<ComponentProps<typeof Tabs>['tabBar']>;
export type CoachTabBarProps = Parameters<CoachTabBarRenderer>[0];

// The prototype's own `style-active="transform:scale(.94)"`, inside
// `DESIGN.md` §5's sanctioned `.92-.98` press range.
const PRESS_SCALE = 0.94;

// §5's fills / sliding-pill curve, which is what the prototype's
// `transition: background 220ms cubic-bezier(.2,.8,.2,1)` names. The
// duration comes from `duration.state` (200ms) — inside §5's own 180-220ms
// band, and the closed set has no 220.
const PILL_EASING = Easing.bezier(easing.fill[0], easing.fill[1], easing.fill[2], easing.fill[3]);

// `accessibility` §3: a tab-bar label is the one place a scale cap is the
// right answer rather than a cop-out — the dock's height is a fixed design
// value, the icon carries the meaning visually, and every item still exposes
// its full name to a screen reader through `accessibilityLabel`. 1.4 keeps
// the label inside the 52px item at the largest OS text size.
const LABEL_MAX_FONT_SCALE = 1.4;

const GRADIENT_TOP = { x: 0, y: 0 } as const;
const GRADIENT_BOTTOM = { x: 0, y: 1 } as const;

/**
 * The coach dock — `DESIGN.md` §9's five-item floating tab bar, ported from
 * `CoachOS-Coach.dc.html`'s own `tabsVisible` block.
 *
 * It is handed to `<Tabs tabBar={...}>` rather than being a restyle of the
 * default bar because the design floats: 14px in from each side, 26px up
 * from the bottom edge, fully rounded, with content running underneath it.
 * Its root is absolutely positioned, so it contributes no height to the
 * navigator's flex column and the scene fills the screen behind it — which
 * is also why every scrollable coach screen owes it `useCoachTabBarInset()`
 * at the bottom of its content (`coach-dock-metrics.ts`).
 *
 * The material is `<GlassSurface tier="tier1">`. Nothing here imports
 * `expo-glass-effect` or `expo-blur`; that primitive owns the three-way
 * branch — real Liquid Glass on iOS 26+, blur elsewhere, fully opaque under
 * Reduce Transparency or Increase Contrast, at runtime — and this file must
 * not second-guess it (`ui-conventions` §5).
 *
 * **Icons never animate.** `DESIGN.md` §5 forbids animated tab-bar icons
 * outright. The only motion is the selection pill's cross-fade, which the
 * prototype specifies, plus the shared press scale.
 *
 * Deliberately self-contained rather than shared with the client dock
 * (`router-skeleton/04`, four items, built in parallel with this). Whether
 * the two collapse into one primitive is a decision for after both exist.
 */
export function CoachTabBar({ state, descriptors, navigation, insets }: CoachTabBarProps) {
  const styles = useDockStyles();

  return (
    <GlassSurface
      tier="tier1"
      style={[styles.dock, { bottom: resolveCoachDockBottom(insets.bottom) }]}
      testID="coach-tab-bar"
    >
      <View style={layout.row} accessibilityRole="tablist">
        {COACH_TABS.map((tab) => {
          // Rendered in `COACH_TABS` order, not `state.routes` order — the
          // latter is whatever expo-router resolved off the file system
          // (alphabetically: clients, index, inbox, more, programs), and tab
          // order is a design decision.
          const index = state.routes.findIndex((candidate) => candidate.name === tab.name);
          const route = state.routes[index];
          // A tab whose route file has gone missing is a build problem, not a
          // runtime one — render nothing rather than a dead item.
          if (!route) return null;

          const options = descriptors[route.key]?.options;
          const focused = state.index === index;
          const rawBadge = options?.tabBarBadge;
          const badge = rawBadge === undefined || rawBadge === '' ? undefined : rawBadge;

          const handlePress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          const handleLongPress = () => {
            navigation.emit({ type: 'tabLongPress', target: route.key });
          };

          return (
            <CoachDockItem
              key={route.key}
              routeName={tab.name}
              label={tab.label}
              Icon={tab.Icon}
              focused={focused}
              badge={badge}
              accessibilityLabel={options?.tabBarAccessibilityLabel}
              onPress={handlePress}
              onLongPress={handleLongPress}
            />
          );
        })}
      </View>
    </GlassSurface>
  );
}

interface CoachDockItemProps {
  routeName: string;
  label: string;
  Icon: LucideIcon;
  focused: boolean;
  /**
   * The unread count. `phase-12-feedback-comments/feedback-inbox/03` supplies
   * the real number through the Inbox screen's own `tabBarBadge` option; this
   * component only owns the capability to draw it.
   */
  badge: string | number | undefined;
  accessibilityLabel: string | undefined;
  onPress: () => void;
  onLongPress: () => void;
}

function CoachDockItem({
  routeName,
  label,
  Icon,
  focused,
  badge,
  accessibilityLabel,
  onPress,
  onLongPress,
}: CoachDockItemProps) {
  const theme = useTheme();
  const styles = useDockStyles();

  // The prototype cross-fades each item's own pill background over 220ms
  // rather than sliding a single pill between items, so the port is a fade on
  // the pill's opacity. Nothing else about the item animates: the icon and
  // label swap colour instantly, exactly as the prototype's `transition` list
  // — which names `background` and `transform`, and not `color` — specifies.
  const pillOpacity = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    pillOpacity.value = withTiming(focused ? 1 : 0, {
      duration: duration.state,
      easing: PILL_EASING,
    });
  }, [focused, pillOpacity]);
  const pillStyle = useAnimatedStyle(() => ({ opacity: pillOpacity.value }));

  const badgeText = badge === undefined ? undefined : String(badge);
  const resolvedLabel =
    accessibilityLabel ?? (badgeText === undefined ? label : `${label}, ${badgeText} new`);

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={resolvedLabel}
      accessibilityState={{ selected: focused }}
      onPress={onPress}
      onLongPress={onLongPress}
      pressScale={PRESS_SCALE}
      containerStyle={layout.itemContainer}
      style={layout.item}
      testID={`coach-tab-${routeName}`}
    >
      <Animated.View style={[layout.pill, styles.pillShadow, pillStyle]} pointerEvents="none">
        <View style={layout.pillClip}>
          <LinearGradient
            colors={theme.selectionPill.gradient}
            start={GRADIENT_TOP}
            end={GRADIENT_BOTTOM}
            style={StyleSheet.absoluteFill}
          />
          {/* §12 — React Native has no inset box-shadow, so the pill's
              `inset 0 1px 0 rgba(255,255,255,.4)` is a 1px hairline, clipped
              to the pill's own radius by the wrapper around it. */}
          <View style={[layout.pillHighlight, styles.pillHighlight]} />
        </View>
      </Animated.View>

      {/* Wrapped because Lucide maps its own `testID` prop to the web-only
          `data-testid`, which never reaches a React Native node. */}
      <View testID={`coach-tab-icon-${routeName}`}>
        <Icon
          size={COACH_DOCK_ICON_SIZE}
          strokeWidth={COACH_DOCK_ICON_STROKE_WIDTH}
          color={focused ? theme.colors.fg.bright : theme.colors.fg.muted}
        />
      </View>
      <Text
        size="micro"
        tone={focused ? 'bright' : 'muted'}
        numberOfLines={1}
        maxFontSizeMultiplier={LABEL_MAX_FONT_SCALE}
      >
        {label}
      </Text>

      {badgeText === undefined ? null : (
        // The count is already announced as part of the item's
        // `accessibilityLabel`, so the badge stays out of the reading order
        // rather than repeating the number as a bare digit
        // (`accessibility` §2).
        <View
          style={[layout.badge, styles.badge]}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          testID={`coach-tab-badge-${routeName}`}
        >
          <LinearGradient
            colors={[theme.colors.brand.DEFAULT, theme.colors.brand.mid]}
            start={GRADIENT_TOP}
            end={GRADIENT_BOTTOM}
            style={StyleSheet.absoluteFill}
          />
          <Metric value={badgeText} size="micro" tone="bright" maxFontSizeMultiplier={1} />
        </View>
      )}
    </Pressable>
  );
}

// The colour-bearing styles. They follow the active scheme and are built once
// per theme identity, never per render (`createThemedStyles`). The dock's own
// geometry rides along because it has to merge with the themed shadow.
const useDockStyles = createThemedStyles((theme) => ({
  dock: {
    position: 'absolute',
    left: COACH_DOCK_SIDE_INSET,
    right: COACH_DOCK_SIDE_INSET,
    height: COACH_DOCK_HEIGHT,
    // §9's `radius: 32px` — half the dock's height, which is what
    // `radius.full` resolves to on a 64px box. A dock is always fully
    // rounded (`DESIGN.md` §1.4).
    borderRadius: radius.full,
    // `GlassSurface` renders the tier-1 gradient, the border, and both inset
    // hairlines itself, but not the outer drop — §9's
    // `0 18px 40px -14px rgba(0,0,0,.8)`, which is `glass.tier1.shadow`.
    ...theme.glass.tier1.shadow,
  },
  pillShadow: theme.selectionPill.shadow,
  pillHighlight: { backgroundColor: theme.selectionPill.highlight },
  // §9's `1.5px border rgba(22,30,47,.6)` — `bg.DEFAULT` at 60%, which is
  // `control.ring`: the ring a dock badge wears so it reads against glass of
  // any brightness.
  badge: { borderColor: theme.control.ring },
}));

// React Native 0.86 no longer types `StyleSheet.absoluteFillObject`; the four
// properties it stood for are spelled out once here.
const ABSOLUTE_FILL = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
} as const;

// Everything scheme-invariant — flex, size, radius, position within an item.
// At module scope, where it costs nothing.
const layout = StyleSheet.create({
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: COACH_DOCK_PADDING_X,
  },
  itemContainer: {
    flex: 1,
  },
  item: {
    height: COACH_DOCK_ITEM_HEIGHT,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    gap: COACH_DOCK_ITEM_GAP,
  },
  pill: {
    ...ABSOLUTE_FILL,
    borderRadius: radius.full,
  },
  pillClip: {
    ...ABSOLUTE_FILL,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  pillHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
  },
  badge: {
    position: 'absolute',
    top: COACH_DOCK_BADGE_TOP,
    right: COACH_DOCK_BADGE_RIGHT,
    minWidth: COACH_DOCK_BADGE_SIZE,
    height: COACH_DOCK_BADGE_SIZE,
    borderRadius: radius.full,
    borderWidth: COACH_DOCK_BADGE_BORDER_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});

import {
  GlassSurface,
  Metric,
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

import { DockItem, DockSelectionPill } from '../dock/index.ts';

import {
  COACH_DOCK_BADGE_BORDER_WIDTH,
  COACH_DOCK_BADGE_RIGHT,
  COACH_DOCK_BADGE_SIZE,
  COACH_DOCK_BADGE_TOP,
  COACH_DOCK_HEIGHT,
  COACH_DOCK_ITEM,
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

// §5's fills / sliding-pill curve, which is what the prototype's
// `transition: background 220ms cubic-bezier(.2,.8,.2,1)` names. The
// duration comes from `duration.state` (200ms) — inside §5's own 180-220ms
// band, and the closed set has no 220.
const PILL_EASING = Easing.bezier(easing.fill[0], easing.fill[1], easing.fill[2], easing.fill[3]);

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
 * The item itself is `dock/DockItem` — shared with the client dock, drawn
 * from `COACH_DOCK_ITEM` rather than from a shared default, because §9
 * states the dock as ranges and the two apps sit at their ends (UNFORGET
 * S11). The BAR is still this file's: five items in a designed order, a
 * cross-faded per-item pill, and a badge anchored to the item box.
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
  //
  // The MOVEMENT stays here and the MATERIAL is `DockSelectionPill`'s,
  // because the client dock slides one pill across its row instead and both
  // readings are the design.
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
    <DockItem
      geometry={COACH_DOCK_ITEM}
      Icon={Icon}
      label={label}
      focused={focused}
      accessibilityLabel={resolvedLabel}
      onPress={onPress}
      onLongPress={onLongPress}
      testID={`coach-tab-${routeName}`}
      iconTestID={`coach-tab-icon-${routeName}`}
      pill={
        <Animated.View style={[layout.pill, pillStyle]} pointerEvents="none">
          <DockSelectionPill cornerRadius={radius.full} />
        </Animated.View>
      }
      itemAccessory={
        badgeText === undefined ? null : (
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
        )
      }
    />
  );
}

// The colour-bearing styles. They follow the active scheme and are built once
// per theme identity, never per render (`createThemedStyles`). The dock's own
// geometry rides along so its one style object stays in one place.
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
    // §9's `0 18px 40px -14px rgba(0,0,0,.8)` is not here: `GlassSurface`
    // owns the tier-1 drop along with the gradient, the border and both
    // inset hairlines, on every one of its three paths.
  },
  // §9's `1.5px border rgba(22,30,47,.6)` — `bg.DEFAULT` at 60%, which is
  // `control.ring`: the ring a dock badge wears so it reads against glass of
  // any brightness.
  badge: { borderColor: theme.control.ring },
}));

// Everything scheme-invariant — flex, size, radius, position within an item.
// At module scope, where it costs nothing.
const layout = StyleSheet.create({
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: COACH_DOCK_PADDING_X,
  },
  // The box the pill is faded in and out of. Its radius, its gradient, its
  // hairline and its drop all belong to `DockSelectionPill`.
  pill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
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

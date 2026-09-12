import {
  Avatar,
  IconButton,
  Pressable,
  SkeletonText,
  Text,
  createThemedStyles,
  createThemedValue,
  density,
  spacing,
  tapTarget,
} from '@coachos/ui';
import type { Tabs } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { type ComponentProps } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CLIENT_DETAIL_TABS, useClientIdentity, type ClientDetailTab } from '../api.ts';

// The chrome above §8.3's six tabs: a way back, who this is, and the facet
// row. Handed to `<Tabs tabBar={…}>` with `tabBarPosition: 'top'`, so it is
// the navigator's own bar rather than a header the six screens each redraw
// — which is what keeps it fixed while a tab scrolls under it, and what
// makes switching a tab a navigation rather than a re-render of the screen.
//
// **Underline facets, not `SegmentedControl`.** `DESIGN.md` §9 gives the
// segmented control a track of 2–4 items and gives *underline facets* to
// five or more: a scrollable row, active `600` with a 2px brand underline,
// inactive `400` muted. Six tabs is squarely the second case, and the
// primitive would have to grow a scroll mode and drop its sliding pill to
// cover it.

// The renderer's own prop type, read off `Tabs` rather than deep-imported
// from `expo-router/build/…` — the same type, and it cannot rot against a
// build-directory reshuffle. `CoachTabBar` takes it the same way.
type TabBarRenderer = NonNullable<ComponentProps<typeof Tabs>['tabBar']>;
export type ClientDetailTabBarProps = Parameters<TabBarRenderer>[0] & {
  clientId: string;
  onBack: () => void;
};

/** §9's facet row: `gap: 18–20px`, `2px` active underline. */
const FACET_GAP = spacing(20);
const UNDERLINE_HEIGHT = 2;

/**
 * The label each facet draws, and the one the tab route is named by. Not
 * derived from the route name: "checkins" is a filename and "Check-ins" is
 * a word, and `product-copy` §6's sentence case is a copy decision rather
 * than a string transform.
 */
export const CLIENT_DETAIL_TAB_LABEL: Record<ClientDetailTab, string> = {
  overview: 'Overview',
  training: 'Training',
  nutrition: 'Nutrition',
  videos: 'Videos',
  checkins: 'Check-ins',
  chat: 'Chat',
};

export function ClientDetailTabBar({
  state,
  navigation,
  clientId,
  onBack,
}: ClientDetailTabBarProps) {
  const insets = useSafeAreaInsets();
  const themed = useThemedStyles();
  const backColor = useBackColor();
  // The same cache entry the Overview tab reads, narrowed by `select` — see
  // `useClientIdentity`. The header never owns a second request.
  const identity = useClientIdentity(clientId);

  return (
    <View style={[themed.bar, { paddingTop: insets.top }]} testID="client-detail-tab-bar">
      <View style={styles.navRow}>
        <IconButton
          icon={<ChevronLeft size={24} color={backColor} />}
          variant="ghost"
          size="md"
          onPress={onBack}
          accessibilityLabel="Back to clients"
          testID="client-detail-back"
        />
      </View>

      <View style={styles.identity}>
        <Avatar name={identity.data?.name ?? ''} userId={clientId} size="md" />
        <View style={styles.identityText}>
          {identity.data === undefined ? (
            // The bar renders before, during and after the fetch — and on a
            // failed one. A skeleton here rather than a placeholder name, so
            // nothing ever claims to be a client who is not this client.
            <SkeletonText lines={2} accessibilityLabel="Loading this client" />
          ) : (
            <>
              <Text size="h1" numberOfLines={1}>
                {identity.data.name}
              </Text>
              <Text size="caption" tone="muted" numberOfLines={1} style={styles.meta}>
                {describeIdentity(identity.data.status, identity.data.goal)}
              </Text>
            </>
          )}
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.facets}
        // The row scrolls, so it is one scrollable region rather than six
        // stops in the reading order before the content (`accessibility` §7).
        accessibilityRole="tablist"
      >
        {CLIENT_DETAIL_TABS.map((tab, position) => {
          // Rendered in `CLIENT_DETAIL_TABS` order, not `state.routes` order
          // — the latter is whatever expo-router resolved off the file
          // system (alphabetically: chat, checkins, index, notes, …), and
          // facet order is a design decision. `notes` is in the directory
          // and declared by `_layout.tsx`, and is deliberately not in this
          // array: `coach-notes` adds it.
          const routeName = tab === 'overview' ? 'index' : tab;
          const index = state.routes.findIndex((candidate) => candidate.name === routeName);
          const route = state.routes[index];
          // A facet whose route file has gone missing is a build problem,
          // not a runtime one — render nothing rather than a dead item.
          if (route === undefined) return null;

          const focused = state.index === index;

          return (
            <Pressable
              key={tab}
              onPress={() => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented) {
                  navigation.navigate(route.name, route.params);
                }
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              // "Overview, tab 1 of 6" — position spoken, because a
              // scrollable row hides how many there are (`accessibility` §2).
              accessibilityLabel={`${CLIENT_DETAIL_TAB_LABEL[tab]}, tab ${String(position + 1)} of ${String(CLIENT_DETAIL_TABS.length)}`}
              style={styles.facet}
              hitSlop={FACET_HIT_SLOP}
              testID={`client-detail-tab-${tab}`}
            >
              {/* §9's active facet is `600`, and `label` pins Medium. A
                  weight change is a FAMILY change in this system — setting
                  `fontWeight` does nothing useful on Android (`Text`'s own
                  contract), so the semibold face is asked for by name. */}
              <Text
                size="label"
                tone={focused ? 'default' : 'muted'}
                {...(focused ? { className: 'font-sans-semibold' } : {})}
              >
                {CLIENT_DETAIL_TAB_LABEL[tab]}
              </Text>
              {/* Always rendered, transparent when inactive: a conditional
                  underline changes the row's height by 2px as the selection
                  moves, and the content below it jumps. */}
              <View
                style={[styles.underline, focused ? themed.underlineActive : styles.underlineIdle]}
              />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/**
 * "Active · Fat loss", or just "Invited". Two facts, never a judgement
 * (`product-copy` §1) — and no "no goal set", which would read as a
 * reprimand for an onboarding step the client may not have reached.
 */
export function describeIdentity(
  status: 'invited' | 'active' | 'paused' | 'archived',
  goal: string | null,
): string {
  const statusLabel = STATUS_LABEL[status];
  return goal === null ? statusLabel : `${statusLabel} · ${GOAL_LABEL(goal)}`;
}

const STATUS_LABEL: Record<'invited' | 'active' | 'paused' | 'archived', string> = {
  invited: 'Invited',
  active: 'Active',
  paused: 'Paused',
  archived: 'Archived',
};

/** `training_goal` is a snake_case enum; the screen says words. */
function GOAL_LABEL(goal: string): string {
  const words = goal.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const FACET_HIT_SLOP = { top: 4, bottom: 4, left: 0, right: 0 };
const GUTTER = density.coach.gutter;

const styles = StyleSheet.create({
  navRow: { height: tapTarget.MIN, paddingHorizontal: spacing(8), justifyContent: 'center' },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(12),
    paddingHorizontal: GUTTER,
    paddingBottom: spacing(12),
  },
  identityText: { flex: 1, minWidth: 0 },
  meta: { marginTop: spacing(3) },
  facets: { paddingHorizontal: GUTTER, gap: FACET_GAP },
  // `minHeight` and padding, never `height`: at 200% text the label grows
  // and a fixed row would clip it (`accessibility` §3).
  facet: { paddingTop: spacing(11), justifyContent: 'flex-end' },
  underline: { height: UNDERLINE_HEIGHT, marginTop: spacing(9), borderRadius: UNDERLINE_HEIGHT },
  underlineIdle: { backgroundColor: 'transparent' },
});

const useThemedStyles = createThemedStyles((t) => ({
  bar: {
    backgroundColor: t.colors.bg.DEFAULT,
    borderBottomWidth: 1,
    borderBottomColor: t.colors.border.soft,
  },
  underlineActive: { backgroundColor: t.colors.brand.DEFAULT },
}));

const useBackColor = createThemedValue((t) => t.colors.fg.DEFAULT);

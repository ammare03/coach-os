import { Tabs, useLocalSearchParams, useRouter } from 'expo-router';

import { ClientDetailTabBar } from '../../../../features/clients/components/ClientDetailTabBar.tsx';

// §8.3's tab shell. Composition only (`CLAUDE.md` §9.2) — the bar's own
// geometry, labels, order, and header live in
// `features/clients/components/ClientDetailTabBar.tsx`; this file says which
// navigator renders it and which routes belong to it.
//
// **A `Tabs` navigator, not a stack and not local state.** Two properties
// follow from it and both are §8.3 acceptance criteria:
//
//   - every tab keeps its own route, so its query key, its scroll position,
//     and its mounted state are the navigator's to hold — switching a tab is
//     a navigation, never a refetch;
//   - a visited tab stays mounted (`lazy` is on, so an unvisited one is not
//     mounted at all), which is what makes "switching tabs after each has
//     loaded once shows no spinner" true structurally rather than by tuning
//     a `staleTime`.
//
// `tabBarPosition: 'top'` puts the bar above the scene rather than below it
// — this is a facet row over a detail screen, not a dock. It is set in
// `screenOptions` because `BottomTabView` reads it from the FOCUSED route's
// options, so a per-screen value would move the bar when a tab changed.

export default function CoachClientDetailLayout() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <Tabs
      tabBar={(props) => (
        <ClientDetailTabBar
          {...props}
          clientId={id}
          onBack={() => {
            // `dismissTo`, not `back`: a coach arriving from a push
            // notification has no roster behind them to pop to.
            router.dismissTo('/(coach)/(tabs)');
          }}
        />
      )}
      screenOptions={{ headerShown: false, tabBarPosition: 'top' }}
    >
      {/* Every route file in this directory is declared, in facet order.
          Leaving one out makes expo-router warn about an undeclared route,
          and the warning is the useful kind — it means the directory and the
          navigator disagree. */}
      <Tabs.Screen name="index" />
      <Tabs.Screen name="training" />
      <Tabs.Screen name="nutrition" />
      <Tabs.Screen name="videos" />
      <Tabs.Screen name="checkins" />
      <Tabs.Screen name="chat" />
      {/* Declared, and deliberately NOT a facet: the Notes tab is
          `coach-notes`'s feature (DB§5.4 — a note is private to the coach
          who wrote it, a distinct authorisation story worth isolating), and
          that feature adds it to `CLIENT_DETAIL_TABS` when it ships. The
          route exists today as a `phase-05-app-shell` placeholder, so
          without this line the navigator would report it as undeclared. */}
      <Tabs.Screen name="notes" />
    </Tabs>
  );
}

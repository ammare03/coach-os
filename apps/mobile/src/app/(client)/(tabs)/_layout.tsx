import { Tabs } from 'expo-router/js-tabs';

import { ClientTabBar } from '../../../features/navigation/client/ClientTabBar.tsx';

/**
 * Today · Nutrition · Progress · Coach (`UI-UX.md` §UX1.2).
 *
 * Composition only, per `CLAUDE.md` §9.2 — the dock itself, its geometry,
 * its icons and its motion all live in `src/features/navigation/client/`. What this
 * file decides is the two things a route file is allowed to decide: which
 * screens are tabs, and in what order. The order is not the file system's
 * (which would give Coach · Today · Nutrition · Progress alphabetically), so
 * the four `<Tabs.Screen>` entries below are load-bearing rather than
 * decorative.
 *
 * `tabBar` replaces expo-router's default flush bar with the floating dock
 * `DESIGN.md` §9 specifies. `tabBarStyle: { display: 'none' }` is deliberately
 * NOT used — the custom bar is rendered by this navigator, not hidden.
 *
 * Imported from `expo-router/js-tabs` rather than `expo-router`: the latter's
 * `Tabs` re-export is deprecated in SDK 57, and this entry point is also
 * where `BottomTabBarProps` (which `ClientTabBar` is typed against) lives.
 */
export default function ClientTabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <ClientTabBar {...props} />}
      // Nothing here reserves space for the bar, deliberately: `ClientTabBar`
      // positions itself absolutely, so it consumes no layout height and the
      // scene already fills the screen behind it. Each screen reserves the
      // dock's own footprint at the bottom of its content instead, via
      // `useClientTabBarInset()`.
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="nutrition" />
      <Tabs.Screen name="progress" />
      <Tabs.Screen name="coach" />
    </Tabs>
  );
}

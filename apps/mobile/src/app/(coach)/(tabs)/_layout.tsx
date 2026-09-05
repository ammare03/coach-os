import { Tabs } from 'expo-router';

import { COACH_TABS } from '../../../features/navigation/coach/coach-tabs.ts';
import { CoachTabBar } from '../../../features/navigation/coach/CoachTabBar.tsx';

// Composition only (`CLAUDE.md` §9.2). Every value the dock draws — order,
// labels, icons, geometry, material — lives in
// `src/features/navigation/coach/`; this file only says which navigator
// renders it and which routes belong to it.
//
// The custom `tabBar` is Ammar's decision on `router-skeleton/03`: the dock in
// `DESIGN.md` §9 floats 26px above the bottom edge with 14px side insets and a
// fully rounded pill, which the default flush bar cannot express. `CoachTabBar`
// positions itself absolutely, so the scene fills the screen behind it — see
// `useCoachTabBarInset()` for the inset that keeps a screen's last row tappable.
export default function CoachTabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <CoachTabBar {...props} />}
      // Every coach route draws its own chrome (`src/app/_layout.tsx`).
      screenOptions={{ headerShown: false }}
    >
      {COACH_TABS.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.label }} />
      ))}
    </Tabs>
  );
}

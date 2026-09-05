import { readFileSync } from 'node:fs';
import path from 'node:path';

import { Tabs } from 'expo-router/js-tabs';
import { fireEvent, renderRouter, screen, within } from 'expo-router/testing-library';
import { ChartColumn, House, MessageSquare, Utensils } from 'lucide-react-native';
import { StyleSheet } from 'react-native';

import ClientTabsLayout from '../../../../app/(client)/(tabs)/_layout.tsx';
import ClientCoachScreen from '../../../../app/(client)/(tabs)/coach.tsx';
import ClientTodayScreen from '../../../../app/(client)/(tabs)/index.tsx';
import ClientNutritionScreen from '../../../../app/(client)/(tabs)/nutrition.tsx';
import ClientProgressScreen from '../../../../app/(client)/(tabs)/progress.tsx';
import { clientTabBarInset } from '../client-dock-geometry.ts';
import { CLIENT_TABS, ClientTabBar } from '../ClientTabBar.tsx';

// The real navigator, not a hand-built `BottomTabBarProps` fixture: the tab
// bar's whole job is to read react-navigation's state and drive it, and a
// fixture would assert that the fixture is shaped the way this file thinks
// it is. `renderRouter` gives the genuine descriptors, the genuine focused
// index, and the genuine `tabPress` -> navigate path.
function renderClientTabs(initialUrl = '/(client)/(tabs)') {
  return renderRouter(
    {
      '(client)/(tabs)/_layout': ClientTabsLayout,
      '(client)/(tabs)/index': ClientTodayScreen,
      '(client)/(tabs)/nutrition': ClientNutritionScreen,
      '(client)/(tabs)/progress': ClientProgressScreen,
      '(client)/(tabs)/coach': ClientCoachScreen,
    },
    { initialUrl },
  );
}

const TABS = [
  { name: 'index', label: 'Today', position: 1 },
  { name: 'nutrition', label: 'Nutrition', position: 2 },
  { name: 'progress', label: 'Progress', position: 3 },
  { name: 'coach', label: 'Coach', position: 4 },
] as const;

describe('the client dock', () => {
  it('renders all four tabs, in UI-UX.md §UX1.2 order', () => {
    renderClientTabs();

    for (const tab of TABS) {
      expect(screen.getByLabelText(`${tab.label}, tab ${tab.position} of 4`)).toBeTruthy();
    }
  });

  it('gives every tab an icon AND a label, never an icon alone', () => {
    renderClientTabs();

    for (const tab of TABS) {
      // DESIGN.md §13 — "icons never travel alone in navigation". Both
      // channels are asserted inside the same item, so removing either
      // fails here. Scoped with `within` because the focused screen also
      // renders its own title, and a bare `getByText('Today')` would match
      // that instead and pass with no dock at all.
      const item = within(screen.getByLabelText(`${tab.label}, tab ${tab.position} of 4`));

      expect(item.getByTestId(`client-tab-icon-${tab.name}`)).toBeTruthy();
      expect(item.getByText(tab.label)).toBeTruthy();
    }
  });

  it('uses the Lucide glyph whose path matches the prototype, per tab', () => {
    // The mapping itself, asserted as data — a swapped icon is a silent
    // visual regression that renders perfectly well.
    expect(CLIENT_TABS.index?.Icon).toBe(House);
    expect(CLIENT_TABS.nutrition?.Icon).toBe(Utensils);
    expect(CLIENT_TABS.progress?.Icon).toBe(ChartColumn);
    expect(CLIENT_TABS.coach?.Icon).toBe(MessageSquare);
  });

  it('marks exactly one tab selected, and it is the focused route', () => {
    renderClientTabs('/(client)/(tabs)/progress');

    expect(screen.getByLabelText('Progress, tab 3 of 4').props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(screen.getByLabelText('Today, tab 1 of 4').props.accessibilityState).toMatchObject({
      selected: false,
    });
  });

  it('navigates when a tab is pressed', () => {
    renderClientTabs();
    expect(screen.getByText('(client)/(tabs)/index')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Nutrition, tab 2 of 4'));

    expect(screen.getByText('(client)/(tabs)/nutrition')).toBeTruthy();
  });

  it('gives every item the tab role inside a tablist', () => {
    renderClientTabs();

    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByTestId('client-tab-bar-tablist').props.accessibilityRole).toBe('tablist');
  });

  it('sizes the sliding selection pill to one item once the bar has measured', () => {
    renderClientTabs();

    // The dock's own width on a 390pt device: 390 − 16 − 16 of side inset.
    // Jest never lays anything out, so the measurement is supplied here
    // rather than skipped — the pill's width is derived from it, and a pill
    // that spans two items or none is a real bug that only geometry catches.
    fireEvent(screen.getByTestId('client-tab-bar-tablist'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 358, height: 64 } },
    });

    const pill = screen.getByTestId('client-tab-bar-selection-pill');

    // DESIGN.md §4 — the pill moves between options and the track never
    // recolours, so exactly one item's worth of it exists: (358 − 12) / 4.
    expect(StyleSheet.flatten(pill.props.style).width).toBe(86.5);
  });
});

describe('the client dock material', () => {
  const source = readFileSync(path.resolve(__dirname, '../ClientTabBar.tsx'), 'utf8');

  it('is a GlassSurface, never a hand-rolled blur', () => {
    // `ui-conventions` §5 and `ui-primitives-core/07`: one primitive owns
    // the three-way branch (iOS 26 Liquid Glass / expo-blur / the opaque
    // fallback under Reduce Transparency or Increase Contrast, switched at
    // runtime). A second import of either package here forks that decision
    // and silently breaks the accessibility path, which no render test in a
    // Node environment can catch.
    expect(source).toMatch(/<GlassSurface\s+tier="tier1"/);
    expect(source).not.toMatch(/from 'expo-blur'/);
    expect(source).not.toMatch(/from 'expo-glass-effect'/);
  });

  it('renders the bar itself', () => {
    renderClientTabs();

    expect(screen.getByTestId('client-tab-bar')).toBeTruthy();
  });
});

// `UI-UX.md` §UX1.2 puts badges on Inbox and Coach, counting unread
// ACTIONABLE items. The client dock in `CoachOS-Client.dc.html` carries
// none yet — P12/P14 own what would populate it — so the capability is
// built and left unpopulated, and this is what proves it is really there
// rather than notionally there.
function BadgedClientTabsLayout() {
  return (
    <Tabs tabBar={(props) => <ClientTabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="coach" options={{ tabBarBadge: 3 }} />
    </Tabs>
  );
}

describe('the client dock badge', () => {
  it('is absent by default', () => {
    renderClientTabs();

    expect(screen.getByLabelText('Coach, tab 4 of 4')).toBeTruthy();
    expect(screen.queryByLabelText(/unread/)).toBeNull();
  });

  it('renders a count and folds it into the item label when a tab declares one', () => {
    renderRouter(
      {
        '(client)/(tabs)/_layout': BadgedClientTabsLayout,
        '(client)/(tabs)/index': ClientTodayScreen,
        '(client)/(tabs)/coach': ClientCoachScreen,
      },
      { initialUrl: '/(client)/(tabs)' },
    );

    // `Badge` is hidden from the reading order, so the count has to reach a
    // screen reader through the tab's own label or it is silent.
    const item = screen.getByLabelText('Coach, 3 unread, tab 2 of 2');

    // `includeHiddenElements` because `Badge` sets
    // `accessibilityElementsHidden` on itself — a standalone focusable "3"
    // tells a screen-reader user nothing, which is exactly why the count is
    // in the label above as well as on screen here.
    expect(within(item).getByText('3', { includeHiddenElements: true })).toBeTruthy();
  });
});

describe('a client tab screen', () => {
  it('reserves the floating dock footprint at the bottom of its content', () => {
    renderClientTabs();

    const contentStyle = StyleSheet.flatten(
      screen.getByTestId('client-tab-screen').props.contentContainerStyle,
    );

    // With no safe-area provider in this test the inset is §9's own 26 + 64
    // + a 12px gap. The assertion is that the screen consumes the shared
    // derivation at all — a hardcoded number in the screen would drift the
    // moment the dock's geometry moved.
    expect(contentStyle.paddingBottom).toBe(clientTabBarInset(0));
    expect(contentStyle.paddingBottom).toBeGreaterThan(64);
  });
});

import { Stack } from 'expo-router';
import { renderRouter, screen } from 'expo-router/testing-library';

import CoachTabsLayout from '../../../../app/(coach)/(tabs)/_layout.tsx';
import CoachClientsScreen from '../../../../app/(coach)/(tabs)/clients.tsx';
import CoachInboxScreen from '../../../../app/(coach)/(tabs)/inbox.tsx';
import CoachHomeScreen from '../../../../app/(coach)/(tabs)/index.tsx';
import CoachMoreScreen from '../../../../app/(coach)/(tabs)/more.tsx';
import CoachProgramsScreen from '../../../../app/(coach)/(tabs)/programs.tsx';
import { COACH_TABS } from '../coach-tabs.ts';

// The half of `router-skeleton/03`'s "navigate through all five tabs" that can
// be checked without a device: the real `(coach)/(tabs)` layout, mounted in the
// real navigator, with the real dock — not the bar rendered against a fixture.
// What a device still has to answer (glass on iOS 26, the runtime collapse to
// opaque, ≥55fps under the bar) is recorded in this task's report.
function renderCoachTabs(initialUrl: string) {
  return renderRouter(
    {
      _layout: () => <Stack screenOptions={{ headerShown: false }} />,
      '(coach)/(tabs)/_layout': CoachTabsLayout,
      '(coach)/(tabs)/index': CoachHomeScreen,
      '(coach)/(tabs)/clients': CoachClientsScreen,
      '(coach)/(tabs)/programs': CoachProgramsScreen,
      '(coach)/(tabs)/inbox': CoachInboxScreen,
      '(coach)/(tabs)/more': CoachMoreScreen,
    },
    { initialUrl },
  );
}

describe('the (coach)/(tabs) layout', () => {
  it('mounts the dock over the tab screens', () => {
    renderCoachTabs('/(coach)/(tabs)');

    expect(screen.getByTestId('coach-tab-bar')).toBeTruthy();
    for (const tab of COACH_TABS) {
      expect(screen.getByText(tab.label)).toBeTruthy();
    }
  });

  it.each([
    ['/(coach)/(tabs)', '(coach)/(tabs)/index', 'Home'],
    ['/(coach)/(tabs)/clients', '(coach)/(tabs)/clients', 'Clients'],
    ['/(coach)/(tabs)/programs', '(coach)/(tabs)/programs', 'Programs'],
    ['/(coach)/(tabs)/inbox', '(coach)/(tabs)/inbox', 'Inbox'],
    ['/(coach)/(tabs)/more', '(coach)/(tabs)/more', 'More'],
  ])('resolves %s to %s, with %s selected in the dock', (url, route, label) => {
    renderCoachTabs(url);

    expect(screen.getByText(route)).toBeTruthy();

    const selected = screen
      .getAllByRole('tab')
      .filter((tab) => tab.props.accessibilityState?.selected === true);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.props.accessibilityLabel).toBe(label);
  });
});

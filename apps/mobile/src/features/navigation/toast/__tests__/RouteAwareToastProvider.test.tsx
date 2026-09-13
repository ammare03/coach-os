import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { RouteAwareToastProvider } from '../RouteAwareToastProvider.tsx';

let mockSegments: readonly string[] = [];

jest.mock('expo-router', () => ({
  useSegments: () => mockSegments,
}));

// The wiring half of UNFORGET S46. `toast-bottom-offset.test.ts` pins what the
// offset SHOULD be per route; this pins that the host is actually positioned
// with it, which is the part a refactor can quietly drop while every arithmetic
// test stays green.
//
// `initialWindowMetrics` is null under Jest, so the inset here is 0 throughout
// — which is the device the shipped 102 was measured on, and therefore the one
// the regression case has to be asserted against.

function renderAt(segments: readonly string[]) {
  mockSegments = segments;
  return render(
    <RouteAwareToastProvider>
      <Text>screen</Text>
    </RouteAwareToastProvider>,
  );
}

describe('RouteAwareToastProvider', () => {
  it('positions the host above the dock on a docked route', () => {
    renderAt(['(coach)', '(tabs)', 'clients']);

    expect(screen.getByTestId('toast-host')).toHaveStyle({ bottom: 102 });
  });

  it('positions the host on the bottom floor in settings', () => {
    renderAt(['(client)', 'settings', 'sharing']);

    expect(screen.getByTestId('toast-host')).toHaveStyle({ bottom: 26 });
  });

  it('still renders the screen beneath it', () => {
    renderAt(['(coach)', 'settings', 'index']);

    expect(screen.getByText('screen')).toBeOnTheScreen();
  });
});

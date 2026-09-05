import { fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { WelcomeScreen } from '../WelcomeScreen.tsx';

// `AuthScreenShell`'s glass nav bar reads `useSafeAreaInsets`, which throws
// without a provider ancestor, and `initialWindowMetrics` resolves to
// `null` under Jest — same reasoning as `YourDataScreen.test.tsx`.
const TEST_METRICS = {
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
  frame: { x: 0, y: 0, width: 390, height: 844 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={TEST_METRICS}>{ui}</SafeAreaProvider>);
}

// `AuthScreenShell` renders the ambient `PulseRingBackground`, which calls
// Reanimated's `useReducedMotion` — not covered by the shared native mock
// in `@coachos/config/jest.native-mocks`. The rings are decorative and
// `pointerEvents="none"`, so standing them down keeps this test about the
// screen. (Adding `useReducedMotion` to the shared double would fix it for
// every future auth screen test; that file is outside this task's scope.)
jest.mock('../../components/PulseRingBackground.tsx', () => ({
  PulseRingBackground: () => null,
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  Link: jest.requireActual('react-native').Text,
}));

describe('WelcomeScreen', () => {
  it('offers exactly one primary action, and it goes to sign-up', () => {
    render(<WelcomeScreen />);

    fireEvent.press(screen.getByText('Create account'));

    expect(mockPush).toHaveBeenCalledWith('/sign-up');
  });

  it('offers sign-in as a secondary link rather than a second button', () => {
    render(<WelcomeScreen />);

    // Present, but not a `Button` — `ui-conventions` §4's one-primary-action
    // rule is the point of the screen.
    expect(screen.getByText('Sign in')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  });

  it('says up front that clients join by invite', () => {
    render(<WelcomeScreen />);

    expect(screen.getByText('Clients join with an invite from their coach.')).toBeTruthy();
  });

  it('states what the product is without promising an outcome', () => {
    render(<WelcomeScreen />);

    // `COPY.md` §CO2 — the headline describes the product, it does not
    // promise the user a result.
    expect(screen.getByText('Everything your clients do, in one place.')).toBeTruthy();
  });
});

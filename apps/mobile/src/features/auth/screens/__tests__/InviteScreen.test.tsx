import { fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { InviteScreen } from '../InviteScreen.tsx';

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

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  Link: jest.requireActual('react-native').Text,
}));

describe('InviteScreen', () => {
  it('shows the code it was handed', () => {
    render(<InviteScreen code="ABC123" onSignIn={jest.fn()} />);

    expect(screen.getByText(/ABC123/)).toBeTruthy();
  });

  it('reads the code to a screen reader as a labelled value', () => {
    render(<InviteScreen code="ABC123" onSignIn={jest.fn()} />);

    expect(screen.getByLabelText('Invite code ABC123')).toBeTruthy();
  });

  it('is honest that the invite cannot be accepted yet, without blaming the user', () => {
    render(<InviteScreen code="ABC123" onSignIn={jest.fn()} />);

    expect(screen.getByText(/Accepting an invite is not available in this build yet/)).toBeTruthy();
  });

  it('is not a dead end', () => {
    const onSignIn = jest.fn();
    render(<InviteScreen code="ABC123" onSignIn={onSignIn} />);

    fireEvent.press(screen.getByText('Go to sign in'));

    expect(onSignIn).toHaveBeenCalledTimes(1);
  });
});

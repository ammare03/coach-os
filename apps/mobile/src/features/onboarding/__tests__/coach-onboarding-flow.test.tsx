import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAuthStore } from '../../auth/store.ts';
import { useCoachOnboardingStore } from '../coach-store.ts';
import { CoachOnboardingFlow } from '../screens/CoachOnboardingFlow.tsx';

// `phase-06-onboarding/coach-onboarding/01`'s Verification, as a test
// rather than a manual walk: the shell's chrome, the disclaimer gate, and
// the persistence of a step transition.

const mockAcknowledge = {
  mutate: jest.fn(),
  isPending: false,
  isError: false,
};

// The flow calls this on every render regardless of which step is on
// screen; step 2 is `coach-profile-step.test.tsx`'s subject, not this
// file's, so it is stood down here rather than exercised.
jest.mock('../hooks/useUpdateCoachProfile.ts', () => ({
  useUpdateCoachProfile: () => ({ mutate: jest.fn(), isPending: false }),
}));

jest.mock('../../settings/hooks/useMedicalDisclaimer.ts', () => ({
  useMedicalDisclaimer: () => ({
    status: { data: undefined },
    acknowledge: mockAcknowledge,
    acknowledgeCurrent: jest.fn(),
  }),
}));

// `CoachOnboardingShell` reads `useSafeAreaInsets`, which throws without a
// provider ancestor, and `initialWindowMetrics` resolves to `null` under
// Jest — the same reasoning `WelcomeScreen.test.tsx` records.
const TEST_METRICS = {
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
  frame: { x: 0, y: 0, width: 390, height: 844 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={TEST_METRICS}>{ui}</SafeAreaProvider>);
}

function signInAsCoach() {
  useAuthStore.setState({ status: 'authenticated', role: 'coach', userId: 'u1' });
}

beforeEach(() => {
  mockAcknowledge.mutate.mockReset();
  mockAcknowledge.isPending = false;
  mockAcknowledge.isError = false;
  signInAsCoach();
  useCoachOnboardingStore.getState().reset();
  // `reset()` clears `draftUserId`, which is what the store's own
  // signed-in-user binding compares against — restamp by writing a step.
  useCoachOnboardingStore.getState().setStep(0);
});

describe('CoachOnboardingFlow', () => {
  it('opens on the disclaimer, showing the progress indicator and no back', () => {
    render(<CoachOnboardingFlow />);

    expect(screen.getByText('Step 1 of 4')).toBeTruthy();
    expect(screen.getByText('Before you start')).toBeTruthy();
    expect(screen.queryByLabelText('Back')).toBeNull();
  });

  it('does not advance until the disclaimer is acknowledged', () => {
    render(<CoachOnboardingFlow />);

    // The acknowledgment control is `MedicalDisclaimer`'s, and its Continue
    // is inert until the row is tapped — so pressing Continue first must
    // leave the flow exactly where it was.
    fireEvent.press(screen.getByText('Continue'));

    expect(mockAcknowledge.mutate).not.toHaveBeenCalled();
    expect(useCoachOnboardingStore.getState().currentStep).toBe(0);
    expect(screen.getByText('Step 1 of 4')).toBeTruthy();
  });

  it('advances only once the acknowledgment write has succeeded', () => {
    render(<CoachOnboardingFlow />);

    fireEvent.press(screen.getByTestId('medical-disclaimer-acknowledge'));
    fireEvent.press(screen.getByText('Continue'));

    expect(mockAcknowledge.mutate).toHaveBeenCalledTimes(1);
    // Still on step 1 — the mutation has not called back yet.
    expect(useCoachOnboardingStore.getState().currentStep).toBe(0);

    const call = mockAcknowledge.mutate.mock.calls[0];
    const options = call?.[1] as { onSuccess: () => void };
    act(() => options.onSuccess());

    expect(useCoachOnboardingStore.getState().currentStep).toBe(1);
  });

  it('persists the step so a resumed flow reopens where it was left', () => {
    useCoachOnboardingStore.getState().setStep(2);
    render(<CoachOnboardingFlow />);

    expect(screen.getByText('Step 3 of 4')).toBeTruthy();
    expect(screen.getByText('Your first program')).toBeTruthy();
  });

  it('offers back on every step after the first, and it moves the store', () => {
    useCoachOnboardingStore.getState().setStep(2);
    render(<CoachOnboardingFlow />);

    fireEvent.press(screen.getByLabelText('Back'));

    expect(useCoachOnboardingStore.getState().currentStep).toBe(1);
    expect(screen.getByText('Step 2 of 4')).toBeTruthy();
  });
});

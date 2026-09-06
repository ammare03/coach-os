import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAuthStore } from '../../auth/store.ts';
import { useClientOnboardingStore } from '../client-store.ts';
import { ClientOnboardingFlow } from '../screens/ClientOnboardingFlow.tsx';

// `phase-06-onboarding/client-onboarding/02`'s Verification: the disclaimer
// gates the flow, each goal option captures the right enum value, and both
// fields land in the draft store rather than on the wire.

const mockAcknowledge = jest.fn();

jest.mock('../../settings/hooks/useMedicalDisclaimer.ts', () => ({
  useMedicalDisclaimer: () => ({
    status: { data: undefined },
    acknowledge: { mutate: mockAcknowledge, isPending: false, isError: false },
    acknowledgeCurrent: jest.fn(),
  }),
}));

// `client-onboarding/05`'s completion hook is built by the flow on every
// render regardless of the step on screen, and it reaches tRPC. Standing it
// down keeps this file about its own step — step 5 is
// `client-onboarding-completion.test.tsx`'s subject.
jest.mock('../hooks/useFinishClientOnboarding.ts', () => ({
  useFinishClientOnboarding: () => ({
    finish: jest.fn(),
    isFinishing: false,
    error: null,
  }),
}));

const TEST_METRICS = {
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
  frame: { x: 0, y: 0, width: 390, height: 844 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={TEST_METRICS}>{ui}</SafeAreaProvider>);
}

beforeEach(() => {
  mockAcknowledge.mockReset();
  useAuthStore.setState({
    status: 'authenticated',
    userId: 'client-1',
    role: 'client',
    isOnboarded: false,
  });
  useClientOnboardingStore.getState().reset();
});

/** Puts the flow past the disclaimer, which is step 1 (`client-steps.ts`). */
function startAtGoals() {
  useClientOnboardingStore.getState().setStep(1);
}

describe('the client onboarding flow', () => {
  it('opens on the medical disclaimer, not on goals', () => {
    render(<ClientOnboardingFlow />);

    expect(screen.getByText('Before you start')).toBeTruthy();
    expect(screen.queryByText('What are you after?')).toBeNull();
  });

  it('counts the disclaimer as step 1 of 5', () => {
    render(<ClientOnboardingFlow />);

    expect(screen.getByText('Step 1 of 5')).toBeTruthy();
  });

  // The gate: nothing advances until the acknowledgment is recorded
  // server-side. `DisclaimerStep` only calls back `onSuccess`.
  it('does not move past the disclaimer until the acknowledgment is recorded', () => {
    render(<ClientOnboardingFlow />);

    // The acknowledgment control is `MedicalDisclaimer`'s, and its Continue
    // is inert until the row is tapped.
    fireEvent.press(screen.getByText('Continue'));
    expect(mockAcknowledge).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('medical-disclaimer-acknowledge'));
    fireEvent.press(screen.getByText('Continue'));

    expect(mockAcknowledge).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('What are you after?')).toBeNull();

    const options = mockAcknowledge.mock.calls[0]?.[1] as { onSuccess: () => void };
    act(() => options.onSuccess());

    expect(screen.getByText('What are you after?')).toBeTruthy();
    expect(screen.getByText('Step 2 of 5')).toBeTruthy();
  });
});

describe('GoalsStep', () => {
  it('offers every training_goal value as a thumb-sized option card', () => {
    startAtGoals();
    render(<ClientOnboardingFlow />);

    for (const label of [
      'Lose fat',
      'Build muscle',
      'Get stronger or faster',
      'Feel healthier day to day',
      'Something else',
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it.each([
    ['Lose fat', 'fat_loss'],
    ['Build muscle', 'muscle_gain'],
    ['Get stronger or faster', 'performance'],
    ['Feel healthier day to day', 'health'],
    ['Something else', 'other'],
  ])('captures %s as %s in the draft store', (label, stored) => {
    startAtGoals();
    render(<ClientOnboardingFlow />);

    fireEvent.press(screen.getByText(label));

    expect(useClientOnboardingStore.getState().fields.goal).toBe(stored);
  });

  it('captures the optional notes field', () => {
    startAtGoals();
    render(<ClientOnboardingFlow />);

    fireEvent.changeText(
      screen.getByLabelText('Anything your coach should know?'),
      'Half marathon in March.',
    );

    expect(useClientOnboardingStore.getState().fields.goalNotes).toBe('Half marathon in March.');
  });

  it('will not continue without a goal, and will once one is picked', () => {
    startAtGoals();
    render(<ClientOnboardingFlow />);

    fireEvent.press(screen.getByText('Continue'));
    expect(useClientOnboardingStore.getState().currentStep).toBe(1);

    fireEvent.press(screen.getByText('Build muscle'));
    fireEvent.press(screen.getByText('Continue'));
    expect(useClientOnboardingStore.getState().currentStep).toBe(2);
  });

  // The accumulate-then-submit-once decision, as a test: this step reaches
  // the network not at all.
  it('stamps the flow’s start time on the first transition and never restarts it', () => {
    startAtGoals();
    render(<ClientOnboardingFlow />);

    fireEvent.press(screen.getByText('Build muscle'));
    fireEvent.press(screen.getByText('Continue'));
    const first = useClientOnboardingStore.getState().fields.startedAt;
    expect(first).not.toBeNull();

    act(() => {
      useClientOnboardingStore.getState().setStep(1);
    });
    fireEvent.press(screen.getByText('Continue'));

    expect(useClientOnboardingStore.getState().fields.startedAt).toBe(first);
  });
});

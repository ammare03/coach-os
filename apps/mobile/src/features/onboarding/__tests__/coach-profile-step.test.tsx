import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAuthStore } from '../../auth/store.ts';
import { useCoachOnboardingStore } from '../coach-store.ts';
import { CoachOnboardingFlow } from '../screens/CoachOnboardingFlow.tsx';

// `phase-06-onboarding/coach-onboarding/02`'s Verification, minus the round
// trip: what the step sends, that a keystroke never sends anything, and
// that a failed write puts the coach back on the step with their values
// intact rather than stranding them a step ahead of a row that was never
// written.

const mockMutate = jest.fn();

jest.mock('../hooks/useUpdateCoachProfile.ts', () => ({
  useUpdateCoachProfile: () => ({ mutate: mockMutate, isPending: false }),
}));

jest.mock('../hooks/useCreateProgram.ts', () => ({
  useCreateProgram: () => ({ mutate: jest.fn(), isPending: false }),
}));

jest.mock('../../settings/hooks/useMedicalDisclaimer.ts', () => ({
  useMedicalDisclaimer: () => ({
    status: { data: undefined },
    acknowledge: { mutate: jest.fn(), isPending: false, isError: false },
    acknowledgeCurrent: jest.fn(),
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
  mockMutate.mockReset();
  useAuthStore.setState({ status: 'authenticated', role: 'coach', userId: 'u1' });
  useCoachOnboardingStore.getState().reset();
  useCoachOnboardingStore.getState().setStep(1); // the profile step
});

describe('CoachProfileStep', () => {
  it('keeps Continue inert until a business name is entered', () => {
    render(<CoachOnboardingFlow />);

    fireEvent.press(screen.getByText('Continue'));
    expect(mockMutate).not.toHaveBeenCalled();
    expect(useCoachOnboardingStore.getState().currentStep).toBe(1);
  });

  it('persists every keystroke locally and sends nothing until the step is left', () => {
    render(<CoachOnboardingFlow />);

    fireEvent.changeText(screen.getByLabelText('Business name'), 'Iron & Oak');
    fireEvent.press(screen.getByText('Powerlifting'));

    expect(useCoachOnboardingStore.getState().fields.businessName).toBe('Iron & Oak');
    expect(useCoachOnboardingStore.getState().fields.specialties).toEqual(['powerlifting']);
    // The whole point of the draft store: this data survives an app kill
    // without a single request having been made.
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('submits trimmed values once, on advancing, and advances optimistically', () => {
    render(<CoachOnboardingFlow />);

    fireEvent.changeText(screen.getByLabelText('Business name'), '  Iron & Oak  ');
    fireEvent.press(screen.getByText('Strength'));
    fireEvent.press(screen.getByText('Continue'));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate.mock.calls[0]?.[0]).toEqual({
      businessName: 'Iron & Oak',
      specialties: ['strength'],
    });
    expect(useCoachOnboardingStore.getState().currentStep).toBe(2);
  });

  it('deselects a specialty on a second tap', () => {
    render(<CoachOnboardingFlow />);

    fireEvent.press(screen.getByText('Mobility'));
    fireEvent.press(screen.getByText('Mobility'));

    expect(useCoachOnboardingStore.getState().fields.specialties).toEqual([]);
  });

  it('returns to the step, with the values intact, when the write fails', () => {
    render(<CoachOnboardingFlow />);

    fireEvent.changeText(screen.getByLabelText('Business name'), 'Iron & Oak');
    fireEvent.press(screen.getByText('Continue'));

    const options = mockMutate.mock.calls[0]?.[1] as { onError: () => void };
    act(() => options.onError());

    expect(useCoachOnboardingStore.getState().currentStep).toBe(1);
    expect(useCoachOnboardingStore.getState().fields.businessName).toBe('Iron & Oak');
    expect(screen.getByText(/couldn’t save that/)).toBeTruthy();
  });

  it('drops a specialty this build no longer recognises rather than sending it', () => {
    // A draft can outlive the list it was written against (`coach.ts`'s
    // "add, don't narrow" note) — the value must not reach a procedure
    // whose schema would reject the whole call because of it.
    useCoachOnboardingStore.getState().updateField('businessName', 'Iron & Oak');
    useCoachOnboardingStore.getState().updateField('specialties', ['strength', 'kettlebell-flow']);
    render(<CoachOnboardingFlow />);

    fireEvent.press(screen.getByText('Continue'));

    expect(mockMutate.mock.calls[0]?.[0]).toEqual({
      businessName: 'Iron & Oak',
      specialties: ['strength'],
    });
  });
});

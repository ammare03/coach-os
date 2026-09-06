import { fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAuthStore } from '../../auth/store.ts';
import { useClientOnboardingStore } from '../client-store.ts';
import { cmToFeetInches, feetInchesToCm, parseHeightInput } from '../height.ts';
import { ClientOnboardingFlow } from '../screens/ClientOnboardingFlow.tsx';

// `phase-06-onboarding/client-onboarding/03`'s Verification: the bounds
// match the `CHECK` exactly at and beyond 50/260, and switching units never
// changes the stored centimetres.

jest.mock('../../settings/hooks/useMedicalDisclaimer.ts', () => ({
  useMedicalDisclaimer: () => ({
    status: { data: undefined },
    acknowledge: { mutate: jest.fn(), isPending: false, isError: false },
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

/** Step index 2 is `measurements` (`client-steps.ts`). */
function startAtMeasurements() {
  useClientOnboardingStore.getState().setStep(2);
}

function draft() {
  return useClientOnboardingStore.getState().fields;
}

beforeEach(() => {
  useAuthStore.setState({
    status: 'authenticated',
    userId: 'client-1',
    role: 'client',
    isOnboarded: false,
  });
  useClientOnboardingStore.getState().reset();
});

describe('MeasurementsStep', () => {
  it('captures date of birth as a calendar date, not as it was typed', () => {
    startAtMeasurements();
    render(<ClientOnboardingFlow />);

    fireEvent.changeText(screen.getByLabelText('Date of birth'), '14 / 03 / 1994');

    expect(draft().dateOfBirth).toBe('1994-03-14');
  });

  it('rejects a malformed date of birth without storing anything', () => {
    startAtMeasurements();
    render(<ClientOnboardingFlow />);

    fireEvent.changeText(screen.getByLabelText('Date of birth'), '14/03');

    expect(draft().dateOfBirth).toBe('');
    expect(screen.getByText('Enter your date of birth as DD/MM/YYYY.')).toBeTruthy();
  });

  // Sensitive data, so the opt-out is a peer of the other three, not a
  // link under them (`client-onboarding/03`, Approach step 2).
  it('offers every sex-at-birth value the CHECK allows, with “prefer not to say” among them', () => {
    startAtMeasurements();
    render(<ClientOnboardingFlow />);

    for (const label of ['Female', 'Male', 'Intersex', 'Prefer not to say']) {
      expect(screen.getByText(label)).toBeTruthy();
    }

    fireEvent.press(screen.getByText('Prefer not to say'));
    expect(draft().sexAtBirth).toBe('prefer_not_to_say');
  });

  it('captures the experience level against the enum', () => {
    startAtMeasurements();
    render(<ClientOnboardingFlow />);

    fireEvent.press(screen.getByText('A year or two'));
    expect(draft().experienceLevel).toBe('intermediate');
  });

  it('stores a valid height in centimetres', () => {
    startAtMeasurements();
    render(<ClientOnboardingFlow />);

    fireEvent.changeText(screen.getByLabelText('Height in centimetres'), '168');

    expect(draft().heightCm).toBe(168);
  });

  // The exact `client_profiles_height_cm_check` bounds, at and beyond.
  it.each([
    ['50', 50],
    ['260', 260],
  ])('accepts %s cm — the CHECK boundary itself', (typed, stored) => {
    startAtMeasurements();
    render(<ClientOnboardingFlow />);

    fireEvent.changeText(screen.getByLabelText('Height in centimetres'), typed);

    expect(draft().heightCm).toBe(stored);
    expect(screen.queryByText('Enter a height between 50 and 260 cm.')).toBeNull();
  });

  it.each(['49', '261'])('refuses %s cm, and stores nothing', (typed) => {
    startAtMeasurements();
    render(<ClientOnboardingFlow />);

    fireEvent.changeText(screen.getByLabelText('Height in centimetres'), typed);

    expect(draft().heightCm).toBeNull();
    expect(screen.getByText('Enter a height between 50 and 260 cm.')).toBeTruthy();
  });

  it('stores centimetres when the client types feet and inches', () => {
    startAtMeasurements();
    render(<ClientOnboardingFlow />);

    fireEvent.press(screen.getByText('ft / in'));
    fireEvent.changeText(screen.getByLabelText('Feet'), '5');
    fireEvent.changeText(screen.getByLabelText('Inches'), '6');

    expect(draft().heightCm).toBe(167.6);
  });

  it('leaves the stored centimetres untouched when the unit is switched', () => {
    startAtMeasurements();
    render(<ClientOnboardingFlow />);

    fireEvent.changeText(screen.getByLabelText('Height in centimetres'), '180');
    expect(draft().heightCm).toBe(180);

    fireEvent.press(screen.getByText('ft / in'));
    expect(draft().heightCm).toBe(180);

    fireEvent.press(screen.getByText('cm'));
    expect(draft().heightCm).toBe(180);
  });

  it('will not continue until all four fields are answered', () => {
    startAtMeasurements();
    render(<ClientOnboardingFlow />);

    fireEvent.press(screen.getByText('Continue'));
    expect(useClientOnboardingStore.getState().currentStep).toBe(2);

    fireEvent.changeText(screen.getByLabelText('Date of birth'), '14 / 03 / 1994');
    fireEvent.press(screen.getByText('Female'));
    fireEvent.changeText(screen.getByLabelText('Height in centimetres'), '168');
    fireEvent.press(screen.getByText('New to this'));
    fireEvent.press(screen.getByText('Continue'));

    expect(useClientOnboardingStore.getState().currentStep).toBe(3);
  });
});

describe('height conversion', () => {
  it('round-trips a height through feet and inches within the rounding it declares', () => {
    const { feet, inches } = cmToFeetInches(180);
    expect(feetInchesToCm(feet, inches)).toBeCloseTo(180, 0);
  });

  it('treats a blank or half-typed field as unanswered, never as zero', () => {
    expect(parseHeightInput('cm', { cm: '' })).toBeNull();
    expect(parseHeightInput('cm', { cm: 'x' })).toBeNull();
    expect(parseHeightInput('ft', { feet: '', inches: '6' })).toBeNull();
  });

  it('treats missing inches as zero once feet are given', () => {
    expect(parseHeightInput('ft', { feet: '6', inches: '' })).toBe(182.9);
  });
});

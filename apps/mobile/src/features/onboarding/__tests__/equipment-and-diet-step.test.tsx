import { fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAuthStore } from '../../auth/store.ts';
import { useClientOnboardingStore } from '../client-store.ts';
import { ClientOnboardingFlow } from '../screens/ClientOnboardingFlow.tsx';

// `phase-06-onboarding/client-onboarding/04`'s Verification: multi-select
// from each starter list, a free-text addition beyond it, and both landing
// in the draft store as `text[]`-shaped arrays.

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

/** Step index 3 is `equipment` (`client-steps.ts`). */
function startAtEquipment() {
  useClientOnboardingStore.getState().setStep(3);
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

describe('EquipmentAndDietStep', () => {
  it('offers a starter list for each field', () => {
    startAtEquipment();
    render(<ClientOnboardingFlow />);

    expect(screen.getByText('Full gym')).toBeTruthy();
    expect(screen.getByText('Bodyweight only')).toBeTruthy();
    expect(screen.getByText('Vegetarian')).toBeTruthy();
    expect(screen.getByText('Jain')).toBeTruthy();
  });

  it('multi-selects equipment, keeping every choice', () => {
    startAtEquipment();
    render(<ClientOnboardingFlow />);

    fireEvent.press(screen.getByText('Full gym'));
    fireEvent.press(screen.getByText('Resistance bands'));

    expect(draft().equipmentAccess).toEqual(['Full gym', 'Resistance bands']);
  });

  it('deselects on a second press', () => {
    startAtEquipment();
    render(<ClientOnboardingFlow />);

    fireEvent.press(screen.getByText('Dumbbells'));
    fireEvent.press(screen.getByText('Dumbbells'));

    expect(draft().equipmentAccess).toEqual([]);
  });

  it('keeps the two fields independent', () => {
    startAtEquipment();
    render(<ClientOnboardingFlow />);

    fireEvent.press(screen.getByText('Home gym'));
    fireEvent.press(screen.getByText('Lactose-free'));

    expect(draft().equipmentAccess).toEqual(['Home gym']);
    expect(draft().dietaryRestrictions).toEqual(['Lactose-free']);
  });

  // The columns are `text[]` with no `CHECK` by design, so the starter
  // list must not be a ceiling.
  it('accepts a dietary value the starter list does not have', () => {
    startAtEquipment();
    render(<ClientOnboardingFlow />);

    fireEvent.press(screen.getByTestId('add-to-dietary-needs'));
    fireEvent.changeText(screen.getByLabelText('Add to dietary needs'), 'Shellfish');
    fireEvent.press(screen.getByText('Add'));

    expect(draft().dietaryRestrictions).toEqual(['Shellfish']);
    expect(screen.getByText('Shellfish')).toBeTruthy();
  });

  it('accepts an equipment value the starter list does not have', () => {
    startAtEquipment();
    render(<ClientOnboardingFlow />);

    fireEvent.press(screen.getByTestId('add-to-equipment'));
    fireEvent.changeText(screen.getByLabelText('Add to equipment'), 'Sandbag');
    fireEvent.press(screen.getByText('Add'));

    expect(draft().equipmentAccess).toEqual(['Sandbag']);
  });

  it('ignores a blank or duplicate addition', () => {
    startAtEquipment();
    render(<ClientOnboardingFlow />);

    fireEvent.press(screen.getByText('Full gym'));
    fireEvent.press(screen.getByTestId('add-to-equipment'));
    fireEvent.changeText(screen.getByLabelText('Add to equipment'), '  Full gym  ');
    fireEvent.press(screen.getByText('Add'));

    expect(draft().equipmentAccess).toEqual(['Full gym']);
  });

  // Both fields are genuinely optional — an empty array is how "none" is
  // expressed, and neither column has a NOT NULL default of anything else.
  it('continues with nothing selected', () => {
    startAtEquipment();
    render(<ClientOnboardingFlow />);

    fireEvent.press(screen.getByText('Continue'));

    expect(useClientOnboardingStore.getState().currentStep).toBe(4);
    expect(draft().equipmentAccess).toEqual([]);
    expect(draft().dietaryRestrictions).toEqual([]);
  });
});

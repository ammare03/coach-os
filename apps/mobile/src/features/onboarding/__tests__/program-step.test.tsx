import {
  act,
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAuthStore } from '../../auth/store.ts';
import { useCoachOnboardingStore } from '../coach-store.ts';
import { CoachOnboardingFlow } from '../screens/CoachOnboardingFlow.tsx';

// `phase-06-onboarding/coach-onboarding/03`'s Verification, minus the round
// trip: what the step drafts, what it sends, and that a failure puts the
// coach back on the step with the program they built still in hand.

const mockCreateProgram = jest.fn();
const mockSearch = jest.fn();

jest.mock('../hooks/useUpdateCoachProfile.ts', () => ({
  useUpdateCoachProfile: () => ({ mutate: jest.fn(), isPending: false }),
}));

jest.mock('../hooks/useCreateProgram.ts', () => ({
  useCreateProgram: () => ({ mutate: mockCreateProgram, isPending: false }),
}));

// The flow builds this on every render regardless of the step on screen;
// step 4 is `invite-and-complete.test.tsx`'s subject, not this file's.
jest.mock('../hooks/useFinishCoachOnboarding.ts', () => ({
  useFinishCoachOnboarding: () => ({
    finishWithInvite: jest.fn(),
    finishWithoutInvite: jest.fn(),
    isFinishing: false,
    error: null,
  }),
}));

jest.mock('../../settings/hooks/useMedicalDisclaimer.ts', () => ({
  useMedicalDisclaimer: () => ({
    status: { data: undefined },
    acknowledge: { mutate: jest.fn(), isPending: false, isError: false },
    acknowledgeCurrent: jest.fn(),
  }),
}));

// The picker is the only surface here that reads the network. Standing the
// tRPC hook down keeps this a test of the step rather than of the client.
jest.mock('../../../lib/trpc.ts', () => ({
  api: { exercises: { search: { useQuery: () => mockSearch() } } },
}));

const TEST_METRICS = {
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
  frame: { x: 0, y: 0, width: 390, height: 844 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={TEST_METRICS}>{ui}</SafeAreaProvider>);
}

beforeEach(() => {
  mockCreateProgram.mockReset();
  mockSearch.mockReset().mockReturnValue({
    isPending: false,
    isError: false,
    data: [
      { id: 'ex-1', name: 'Back Squat', primaryMuscle: 'quadriceps', equipment: 'Barbell' },
      { id: 'ex-2', name: 'Barbell Row', primaryMuscle: 'lats', equipment: 'Barbell' },
    ],
    refetch: jest.fn(),
  });
  useAuthStore.setState({ status: 'authenticated', role: 'coach', userId: 'u1' });
  useCoachOnboardingStore.getState().reset();
  useCoachOnboardingStore.getState().setStep(2); // the program step
});

describe('ProgramStep', () => {
  it('starts with three named, empty days', () => {
    render(<CoachOnboardingFlow />);

    expect(useCoachOnboardingStore.getState().fields.programDays).toEqual([
      { name: 'Day 1', exercises: [] },
      { name: 'Day 2', exercises: [] },
      { name: 'Day 3', exercises: [] },
    ]);
    // An empty day is a valid day, not a state to recover from.
    expect(screen.getAllByText('You can leave a day empty and fill it in later.')).toHaveLength(3);
  });

  it('keeps Continue inert until the program has a name', () => {
    render(<CoachOnboardingFlow />);

    fireEvent.press(screen.getByText('Continue'));

    expect(mockCreateProgram).not.toHaveBeenCalled();
    expect(useCoachOnboardingStore.getState().currentStep).toBe(2);
  });

  it('adds picked exercises to the day they were picked for, with sensible targets', async () => {
    render(<CoachOnboardingFlow />);

    fireEvent.press(screen.getByLabelText('Add exercise to Day 2'));
    await waitFor(() => expect(screen.getByLabelText('Back Squat')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('Back Squat'));
    fireEvent.press(screen.getByText('Add 1 exercise'));

    const days = useCoachOnboardingStore.getState().fields.programDays;
    expect(days[0]?.exercises).toEqual([]);
    expect(days[1]?.exercises).toEqual([
      {
        exerciseId: 'ex-1',
        exerciseName: 'Back Squat',
        targetSets: 3,
        targetRepsMin: 8,
        targetRepsMax: 12,
      },
    ]);
  });

  it('counts the selection on the commit button and keeps it inert while empty', async () => {
    render(<CoachOnboardingFlow />);

    fireEvent.press(screen.getByLabelText('Add exercise to Day 1'));
    await waitFor(() => expect(screen.getByText('Add 0 exercises')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('Back Squat'));
    fireEvent.press(screen.getByLabelText('Barbell Row'));

    // `DESIGN.md` §10.8 — the label counts what will happen.
    expect(screen.getByText('Add 2 exercises')).toBeTruthy();
  });

  it('sends the drafted program once, on advancing, and advances optimistically', () => {
    const store = useCoachOnboardingStore.getState();
    store.updateField('programName', '  Foundation  ');
    store.updateField('programDays', [
      {
        name: 'Push',
        exercises: [
          {
            exerciseId: 'ex-1',
            exerciseName: 'Back Squat',
            targetSets: 4,
            targetRepsMin: 6,
            targetRepsMax: 8,
          },
        ],
      },
      { name: '   ', exercises: [] },
    ]);
    render(<CoachOnboardingFlow />);

    fireEvent.press(screen.getByText('Continue'));

    expect(mockCreateProgram).toHaveBeenCalledTimes(1);
    expect(mockCreateProgram.mock.calls[0]?.[0]).toEqual({
      name: 'Foundation',
      days: [
        {
          name: 'Push',
          // The draft's display-only `exerciseName` never crosses the wire.
          exercises: [{ exerciseId: 'ex-1', targetSets: 4, targetRepsMin: 6, targetRepsMax: 8 }],
        },
        // A day the coach blanked still needs a name — the column is NOT NULL.
        { name: 'Day 2', exercises: [] },
      ],
    });
    expect(useCoachOnboardingStore.getState().currentStep).toBe(3);
  });

  it('records the created program id so a second Continue cannot make a second program', () => {
    useCoachOnboardingStore.getState().updateField('programName', 'Foundation');
    render(<CoachOnboardingFlow />);

    fireEvent.press(screen.getByText('Continue'));
    const options = mockCreateProgram.mock.calls[0]?.[1] as {
      onSuccess: (program: { id: string }) => void;
    };
    act(() => options.onSuccess({ id: 'prog-1' }));

    expect(useCoachOnboardingStore.getState().fields.programId).toBe('prog-1');
  });

  it('returns to the step with the program intact when the write fails', () => {
    useCoachOnboardingStore.getState().updateField('programName', 'Foundation');
    render(<CoachOnboardingFlow />);

    fireEvent.press(screen.getByText('Continue'));
    const options = mockCreateProgram.mock.calls[0]?.[1] as { onError: () => void };
    act(() => options.onError());

    expect(useCoachOnboardingStore.getState().currentStep).toBe(2);
    expect(useCoachOnboardingStore.getState().fields.programName).toBe('Foundation');
    expect(screen.getByText(/couldn’t save that/)).toBeTruthy();
  });
});

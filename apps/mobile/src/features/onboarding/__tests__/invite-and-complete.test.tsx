import { fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react-native';
import { TRPCClientError } from '@trpc/client';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAuthStore } from '../../auth/store.ts';
import { useCoachOnboardingStore } from '../coach-store.ts';
import { CoachOnboardingFlow } from '../screens/CoachOnboardingFlow.tsx';

// `phase-06-onboarding/coach-onboarding/04`'s Verification, and the task's
// own stated risk: this step is the feature's integration point, so what is
// asserted here is the ORDER of the completion moment — invite, then
// complete, then reset — and that the "later" path does all of it too.

const mockCreateInvite = jest.fn();
const mockComplete = jest.fn();
const mockTrackEvent = jest.fn();

jest.mock('../hooks/useUpdateCoachProfile.ts', () => ({
  useUpdateCoachProfile: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('../hooks/useCreateProgram.ts', () => ({
  useCreateProgram: () => ({ mutate: jest.fn(), isPending: false }),
}));
jest.mock('../hooks/useCompleteOnboarding.ts', () => ({
  useCompleteOnboarding: () => ({ complete: mockComplete, isCompleting: false }),
}));
jest.mock('../../settings/hooks/useMedicalDisclaimer.ts', () => ({
  useMedicalDisclaimer: () => ({
    status: { data: undefined },
    acknowledge: { mutate: jest.fn(), isPending: false, isError: false },
    acknowledgeCurrent: jest.fn(),
  }),
}));
jest.mock('../../../lib/analytics/index.ts', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
  asUuid: (value: string) => value,
}));
jest.mock('../../../lib/trpc.ts', () => ({
  api: {
    exercises: { search: { useQuery: () => ({ isPending: true }) } },
    invites: { create: { useMutation: () => ({ mutateAsync: mockCreateInvite }) } },
  },
}));

/** The wire shape `apps/api/src/trpc/error-formatter.ts` produces. */
function appError(appCode: string) {
  return TRPCClientError.from({
    error: {
      code: -32001,
      message: 'nope',
      data: { code: 'BAD_REQUEST', httpStatus: 400, appCode, details: {} },
    },
  });
}

const TEST_METRICS = {
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
  frame: { x: 0, y: 0, width: 390, height: 844 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={TEST_METRICS}>{ui}</SafeAreaProvider>);
}

beforeEach(() => {
  mockCreateInvite.mockReset().mockResolvedValue({ id: 'invite-1' });
  mockComplete.mockReset().mockResolvedValue(undefined);
  mockTrackEvent.mockReset();
  useAuthStore.setState({ status: 'authenticated', role: 'coach', userId: 'u1' });
  useCoachOnboardingStore.getState().reset();
  useCoachOnboardingStore.getState().setStep(3); // the invite step
});

describe('InviteFirstClientStep', () => {
  it('keeps Send invite inert until the address could actually be sent to', () => {
    render(<CoachOnboardingFlow />);

    fireEvent.changeText(screen.getByLabelText('Client email'), 'not-an-email');
    fireEvent.press(screen.getByText('Send invite'));

    expect(mockCreateInvite).not.toHaveBeenCalled();
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it('creates the invite, then completes onboarding, then clears the draft', async () => {
    useCoachOnboardingStore.getState().updateField('businessName', 'Iron & Oak');
    render(<CoachOnboardingFlow />);

    fireEvent.changeText(screen.getByLabelText('Client email'), 'maya@example.com');
    fireEvent.press(screen.getByText('Send invite'));

    await waitFor(() => expect(mockComplete).toHaveBeenCalledTimes(1));
    expect(mockCreateInvite).toHaveBeenCalledWith({ email: 'maya@example.com' });
    // Order matters: completing before the invite would mark a coach
    // onboarded on the strength of a request that had not happened yet.
    expect(mockCreateInvite.mock.invocationCallOrder[0]).toBeLessThan(
      mockComplete.mock.invocationCallOrder[0] ?? 0,
    );
    await waitFor(() => expect(useCoachOnboardingStore.getState().fields.businessName).toBe(''));
  });

  it('records the invite and the completion, with no email in either', async () => {
    render(<CoachOnboardingFlow />);

    fireEvent.changeText(screen.getByLabelText('Client email'), 'maya@example.com');
    fireEvent.press(screen.getByText('Send invite'));

    await waitFor(() => expect(mockTrackEvent).toHaveBeenCalledTimes(2));
    expect(mockTrackEvent).toHaveBeenNthCalledWith(1, 'client_invited', { invite_id: 'invite-1' });
    expect(mockTrackEvent).toHaveBeenNthCalledWith(2, 'onboarding_completed', {
      role: 'coach',
      duration_s: expect.any(Number),
      steps_skipped: 0,
    });
    // §20's guardrail — an address must never reach PostHog.
    expect(JSON.stringify(mockTrackEvent.mock.calls)).not.toContain('maya@example.com');
  });

  it('finishes without an invite when the coach says later, and counts the skip', async () => {
    render(<CoachOnboardingFlow />);

    fireEvent.press(screen.getByText('I’ll invite someone later'));

    await waitFor(() => expect(mockComplete).toHaveBeenCalledTimes(1));
    expect(mockCreateInvite).not.toHaveBeenCalled();
    expect(mockTrackEvent).toHaveBeenCalledWith('onboarding_completed', {
      role: 'coach',
      duration_s: expect.any(Number),
      steps_skipped: 1,
    });
    // The reset is on the shared tail, so "later" cannot skip it.
    await waitFor(() => expect(useCoachOnboardingStore.getState().currentStep).toBe(0));
  });

  it('keeps the coach in the flow, with copy they can act on, when the seat check refuses', async () => {
    mockCreateInvite.mockRejectedValue(appError('SEAT_LIMIT_REACHED'));
    render(<CoachOnboardingFlow />);

    fireEvent.changeText(screen.getByLabelText('Client email'), 'maya@example.com');
    fireEvent.press(screen.getByText('Send invite'));

    await waitFor(() => expect(screen.getByText(/every client seat/)).toBeTruthy());
    expect(mockComplete).not.toHaveBeenCalled();
    // It never traps: Later still finishes the flow.
    expect(screen.getByText('I’ll invite someone later')).toBeTruthy();
  });

  it('does not complete, or clear the draft, when the invite request fails', async () => {
    mockCreateInvite.mockRejectedValue(new Error('offline'));
    useCoachOnboardingStore.getState().updateField('businessName', 'Iron & Oak');
    render(<CoachOnboardingFlow />);

    fireEvent.changeText(screen.getByLabelText('Client email'), 'maya@example.com');
    fireEvent.press(screen.getByText('Send invite'));

    await waitFor(() => expect(screen.getByText(/couldn’t send that invite/)).toBeTruthy());
    expect(mockComplete).not.toHaveBeenCalled();
    expect(useCoachOnboardingStore.getState().fields.businessName).toBe('Iron & Oak');
  });
});

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
import { useClientOnboardingStore } from '../client-store.ts';
import { ClientOnboardingFlow } from '../screens/ClientOnboardingFlow.tsx';

// `phase-06-onboarding/client-onboarding/05`'s Verification, minus the
// round trip and the device: the full five-step sequence end to end, both
// permission outcomes, and the ordering that makes the rationale mean
// anything — rationale, then OS prompt, then write.
//
// This is the feature's integration point (`useFinishClientOnboarding`'s
// header says why), so the sequence is exercised as one flow rather than as
// five isolated steps.

const mockUpdateProfile = jest.fn();
const mockComplete = jest.fn();
const mockRequestPermission = jest.fn();
const mockTrackEvent = jest.fn();

jest.mock('../../settings/hooks/useMedicalDisclaimer.ts', () => ({
  useMedicalDisclaimer: () => ({
    status: { data: undefined },
    acknowledge: {
      mutate: (_input: unknown, options: { onSuccess: () => void }) => options.onSuccess(),
      isPending: false,
      isError: false,
    },
    acknowledgeCurrent: jest.fn(),
  }),
}));

jest.mock('../hooks/useCompleteOnboarding.ts', () => ({
  useCompleteOnboarding: () => ({ complete: mockComplete, isCompleting: false }),
}));

jest.mock('../notification-permission.ts', () => ({
  requestNotificationPermission: () => mockRequestPermission(),
}));

jest.mock('../../../lib/analytics/index.ts', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
  asUuid: (value: string) => value,
}));

jest.mock('../../../lib/trpc.ts', () => ({
  api: {
    clientApp: {
      updateProfile: { useMutation: () => ({ mutateAsync: mockUpdateProfile, isPending: false }) },
    },
  },
}));

const TEST_METRICS = {
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
  frame: { x: 0, y: 0, width: 390, height: 844 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={TEST_METRICS}>{ui}</SafeAreaProvider>);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateProfile.mockResolvedValue({ success: true });
  mockComplete.mockResolvedValue(undefined);
  mockRequestPermission.mockResolvedValue('granted');
  useAuthStore.setState({
    status: 'authenticated',
    userId: 'client-1',
    role: 'client',
    isOnboarded: false,
  });
  useClientOnboardingStore.getState().reset();
});

/** Walks steps 1–4 the way a client does, leaving the flow on the rationale. */
function walkToNotifications() {
  render(<ClientOnboardingFlow />);

  fireEvent.press(screen.getByTestId('medical-disclaimer-acknowledge'));
  fireEvent.press(screen.getByText('Continue'));

  fireEvent.press(screen.getByText('Build muscle'));
  fireEvent.changeText(
    screen.getByLabelText('Anything your coach should know?'),
    'Half marathon in March.',
  );
  fireEvent.press(screen.getByText('Continue'));

  fireEvent.changeText(screen.getByLabelText('Date of birth'), '14 / 03 / 1994');
  fireEvent.press(screen.getByText('Female'));
  fireEvent.changeText(screen.getByLabelText('Height in centimetres'), '168');
  fireEvent.press(screen.getByText('A year or two'));
  fireEvent.press(screen.getByText('Continue'));

  fireEvent.press(screen.getByText('Full gym'));
  fireEvent.press(screen.getByText('Lactose-free'));
  fireEvent.press(screen.getByText('Continue'));
}

describe('the full client onboarding flow', () => {
  it('walks all five steps and ends on the notification rationale', () => {
    walkToNotifications();

    expect(screen.getByText('Want a nudge?')).toBeTruthy();
    expect(screen.getByText('Step 5 of 5')).toBeTruthy();
  });

  // §7.5's rule, as an ordering assertion: the OS is never asked before
  // the person has read why.
  it('shows the rationale before the OS prompt, and never the prompt cold', () => {
    walkToNotifications();

    expect(screen.getByText('When your coach replies')).toBeTruthy();
    expect(mockRequestPermission).not.toHaveBeenCalled();
  });

  it('sends the whole accumulated draft in exactly one call', async () => {
    walkToNotifications();
    await act(async () => {
      fireEvent.press(screen.getByText('Turn on notifications'));
    });

    expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
    expect(mockUpdateProfile.mock.calls[0]?.[0]).toEqual({
      goal: 'muscle_gain',
      goalNotes: 'Half marathon in March.',
      dateOfBirth: '1994-03-14',
      sexAtBirth: 'female',
      heightCm: 168,
      experienceLevel: 'intermediate',
      equipmentAccess: ['Full gym'],
      dietaryRestrictions: ['Lactose-free'],
    });
  });

  it('asks the OS first, then writes', async () => {
    const order: string[] = [];
    mockRequestPermission.mockImplementation(async () => {
      order.push('permission');
      return 'granted';
    });
    mockUpdateProfile.mockImplementation(async () => {
      order.push('write');
      return { success: true };
    });

    walkToNotifications();
    await act(async () => {
      fireEvent.press(screen.getByText('Turn on notifications'));
    });

    expect(order).toEqual(['permission', 'write']);
  });

  it('calls completeOnboarding immediately after the profile write succeeds', async () => {
    walkToNotifications();
    await act(async () => {
      fireEvent.press(screen.getByText('Turn on notifications'));
    });

    expect(mockComplete).toHaveBeenCalledTimes(1);
    const [writeOrder] = mockUpdateProfile.mock.invocationCallOrder;
    const [completeOrder] = mockComplete.mock.invocationCallOrder;
    expect(writeOrder).toBeDefined();
    expect(completeOrder).toBeGreaterThan(writeOrder as number);
  });

  // The stated risk: a client who declines must finish exactly as well as
  // one who accepts.
  it('completes onboarding when the OS permission is denied', async () => {
    mockRequestPermission.mockResolvedValue('denied');

    walkToNotifications();
    await act(async () => {
      fireEvent.press(screen.getByText('Turn on notifications'));
    });

    expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  it('completes onboarding without asking the OS at all when the client declines up front', async () => {
    walkToNotifications();
    await act(async () => {
      fireEvent.press(screen.getByText('Not now'));
    });

    expect(mockRequestPermission).not.toHaveBeenCalled();
    expect(mockUpdateProfile).toHaveBeenCalledTimes(1);
    expect(mockComplete).toHaveBeenCalledTimes(1);
  });

  it('resets the draft store on completion, and not before', async () => {
    walkToNotifications();
    expect(useClientOnboardingStore.getState().fields.goal).toBe('muscle_gain');

    await act(async () => {
      fireEvent.press(screen.getByText('Not now'));
    });

    await waitFor(() => {
      expect(useClientOnboardingStore.getState().fields.goal).toBe('');
      expect(useClientOnboardingStore.getState().currentStep).toBe(0);
    });
  });

  it('reports completion to analytics with the client role and a real duration', async () => {
    walkToNotifications();
    await act(async () => {
      fireEvent.press(screen.getByText('Not now'));
    });

    expect(mockTrackEvent).toHaveBeenCalledWith(
      'onboarding_completed',
      expect.objectContaining({ role: 'client', steps_skipped: 0 }),
    );
    const properties = mockTrackEvent.mock.calls[0]?.[1] as { duration_s: number };
    expect(properties.duration_s).toBeGreaterThanOrEqual(0);
  });

  // A failed write must leave the draft intact and the client where they
  // are, with something to act on — never "onboarded" on the device and
  // not on the server.
  it('keeps the draft and shows an error when the write fails', async () => {
    mockUpdateProfile.mockRejectedValue(new Error('offline'));

    walkToNotifications();
    await act(async () => {
      fireEvent.press(screen.getByText('Not now'));
    });

    expect(mockComplete).not.toHaveBeenCalled();
    expect(useClientOnboardingStore.getState().fields.goal).toBe('muscle_gain');
    expect(
      screen.getByText('We couldn’t save that. Check your connection and try again.'),
    ).toBeTruthy();
  });
});

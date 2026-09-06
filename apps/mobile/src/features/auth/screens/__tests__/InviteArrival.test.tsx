import { fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAuthStore } from '../../store.ts';
import { InviteArrival } from '../InviteArrival.tsx';

// `client-onboarding/01`'s four arrival cases, which is the whole of this
// task's user-visible behaviour. The tRPC client is stood down: what is
// under test is which screen a given session sees and what it sends, not
// the transport.

const mockCoachQuery = jest.fn();
const mockPreviewQuery = jest.fn();
const mockAcceptAsExisting = jest.fn();
const mockSignOut = jest.fn();
const mockReplace = jest.fn();
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
}));

// Same stand-down as `WelcomeScreen.test.tsx`, for the same reason:
// `AuthScreenShell`'s ambient rings call Reanimated's `useReducedMotion`,
// which the shared native mock does not cover. They are decorative and
// `pointerEvents="none"`.
jest.mock('../../components/PulseRingBackground.tsx', () => ({
  PulseRingBackground: () => null,
}));

jest.mock('../../../../lib/trpc.ts', () => ({
  api: {
    useUtils: () => ({ clientApp: { coach: { invalidate: jest.fn() } } }),
    me: { get: { useQuery: () => ({ data: { email: 'sam@example.com' } }) } },
    clientApp: { coach: { useQuery: () => mockCoachQuery() } },
    invites: {
      preview: { useQuery: () => mockPreviewQuery() },
      acceptAsExistingClient: {
        useMutation: () => ({ mutate: mockAcceptAsExisting, isPending: false }),
      },
      accept: { useMutation: () => ({ mutate: jest.fn(), isPending: false }) },
    },
    auth: { signOut: { useMutation: () => ({ mutateAsync: jest.fn() }) } },
  },
}));

jest.mock('../../hooks/useSignOut.ts', () => ({
  useSignOut: () => ({ signOut: mockSignOut, isSigningOut: false }),
}));

const TEST_METRICS = {
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
  frame: { x: 0, y: 0, width: 390, height: 844 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={TEST_METRICS}>{ui}</SafeAreaProvider>);
}

const CODE = 'K4R7M8PQ';

beforeEach(() => {
  jest.clearAllMocks();
  mockCoachQuery.mockReturnValue({ isPending: false, data: null });
  mockPreviewQuery.mockReturnValue({
    isPending: false,
    error: null,
    data: { coachName: 'Marcus Adeyemi' },
  });
});

function signIn(role: 'client' | 'coach' | 'assistant') {
  useAuthStore.setState({ status: 'authenticated', userId: 'u1', role, isOnboarded: true });
}

describe('InviteArrival', () => {
  it('offers code entry to a signed-out arrival', () => {
    useAuthStore.setState({
      status: 'unauthenticated',
      userId: null,
      role: null,
      isOnboarded: false,
    });

    render(<InviteArrival code="" />);

    expect(screen.getByText('You’ve been invited')).toBeTruthy();
    expect(screen.getByLabelText('Invite code')).toBeTruthy();
  });

  // The decision, as a test: refuse and explain, and carry NO control that
  // switches coaches.
  it('refuses a client who already has a coach, names Settings, and offers no switch', () => {
    signIn('client');
    mockCoachQuery.mockReturnValue({
      isPending: false,
      data: { id: 'c1', name: 'Priya Nair', businessName: null },
    });

    render(<InviteArrival code={CODE} />);

    expect(screen.getByText('You already have a coach')).toBeTruthy();
    expect(screen.getByText(/Priya Nair/)).toBeTruthy();
    expect(screen.getByText('Go to Settings')).toBeTruthy();
    expect(screen.queryByText(/switch/i)).toBeNull();
    expect(screen.queryByText(/leave your current coach$/i)).toBeNull();
  });

  it('refuses a signed-in coach with its own copy, not a silent bounce', () => {
    signIn('coach');

    render(<InviteArrival code={CODE} />);

    expect(screen.getByText('This invite is for a client')).toBeTruthy();
    expect(screen.queryByText('You already have a coach')).toBeNull();
  });

  it('treats an assistant exactly as a coach', () => {
    signIn('assistant');

    render(<InviteArrival code={CODE} />);

    expect(screen.getByText('This invite is for a client')).toBeTruthy();
  });

  it('offers a coachless client the inviting coach’s name and all three sharing controls', () => {
    signIn('client');

    render(<InviteArrival code={CODE} />);

    expect(screen.getByText('Marcus Adeyemi invited you')).toBeTruthy();
    expect(screen.getByText('Training history')).toBeTruthy();
    expect(screen.getByLabelText('Body metrics')).toBeTruthy();
    expect(screen.getByLabelText('Nutrition')).toBeTruthy();
  });

  it('sends exactly the four fields the procedure takes, each the client’s own value', () => {
    signIn('client');

    render(<InviteArrival code={CODE} />);

    fireEvent.press(screen.getByText('Everything'));
    fireEvent(screen.getByLabelText('Body metrics'), 'valueChange', true);
    fireEvent.press(screen.getByText('Join Marcus Adeyemi'));

    expect(mockAcceptAsExisting).toHaveBeenCalledTimes(1);
    expect(mockAcceptAsExisting.mock.calls[0]?.[0]).toEqual({
      code: CODE,
      historySharing: 'everything',
      shareMetrics: true,
      shareNutrition: false,
    });
  });

  // Approach step 7 — the completion gate decides where an already-
  // onboarded client lands, so this hands off to `/` rather than walking
  // them back through goals.
  it('hands a successful returning-client acceptance to the completion gate', () => {
    signIn('client');

    render(<InviteArrival code={CODE} />);
    fireEvent.press(screen.getByText('Join Marcus Adeyemi'));

    const options = mockAcceptAsExisting.mock.calls[0]?.[1] as { onSuccess: () => void };
    options.onSuccess();

    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('does not reveal whether a code exists when the preview is refused', () => {
    signIn('client');
    mockPreviewQuery.mockReturnValue({
      isPending: false,
      error: { data: { appCode: 'INVITE_NOT_FOUND' } },
      data: undefined,
    });

    render(<InviteArrival code={CODE} />);

    expect(screen.getByText('We couldn’t open that invite')).toBeTruthy();
    expect(screen.queryByText(/does not exist/i)).toBeNull();
    expect(screen.queryByText(/another account/i)).toBeNull();
  });

  it.each([
    [
      'client with a coach',
      { isPending: false, data: { id: 'c1', name: 'P', businessName: null } },
    ],
    ['coachless client', { isPending: false, data: null }],
  ])('offers a sign-out affordance to a signed-in %s', (_label, coachState) => {
    signIn('client');
    mockCoachQuery.mockReturnValue(coachState);

    render(<InviteArrival code={CODE} />);
    fireEvent.press(screen.getByText('Sign out'));

    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('offers a sign-out affordance to a signed-in coach too', () => {
    signIn('coach');

    render(<InviteArrival code={CODE} />);
    fireEvent.press(screen.getByText('Sign out'));

    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });
});

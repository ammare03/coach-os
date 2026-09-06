import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { GuardianConsentPendingScreen } from '../GuardianConsentPendingScreen.tsx';

// `guardian-consent/06`'s Verification section: the four `me.get` shapes,
// the two actions, the rate limit, and the transition out — all without a
// navigator and without the transport. What is under test is which state a
// given `me.get` produces and what the screen sends, not tRPC.

const mockReplace = jest.fn();
const mockMeQuery = jest.fn();
const mockResendMutate = jest.fn();
const mockInvalidate = jest.fn();
const mockRefetch = jest.fn();
const mockSignOut = jest.fn();
const mockTrackEvent = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock('../../../lib/trpc.ts', () => ({
  api: {
    useUtils: () => ({ me: { get: { invalidate: mockInvalidate } } }),
    me: { get: { useQuery: () => mockMeQuery() } },
    invites: {
      resendGuardianConsent: {
        useMutation: () => ({ mutate: mockResendMutate, isPending: false }),
      },
    },
  },
}));

jest.mock('../../auth/hooks/useSignOut.ts', () => ({
  useSignOut: () => ({ signOut: mockSignOut, isSigningOut: false }),
}));

jest.mock('../../../lib/analytics/index.ts', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

const TEST_METRICS = {
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
  frame: { x: 0, y: 0, width: 390, height: 844 },
};

function render(ui: ReactElement) {
  return rtlRender(<SafeAreaProvider initialMetrics={TEST_METRICS}>{ui}</SafeAreaProvider>);
}

const MASKED = 'j•••@gmail.com';

/** The four shapes `me.get` can return for this screen. */
const SHAPES = {
  pendingMinor: { isMinor: true, guardianConsentAt: null, guardianEmailMasked: MASKED },
  consentedMinor: {
    isMinor: true,
    guardianConsentAt: new Date('2026-09-01T09:00:00.000Z'),
    guardianEmailMasked: MASKED,
  },
  adult: { isMinor: false, guardianConsentAt: null, guardianEmailMasked: null },
  // `age-sweep.ts` clears `is_minor` on the 18th birthday and leaves
  // `guardian_consent_at` null forever. Never consented, no longer blocked.
  agedOut: { isMinor: false, guardianConsentAt: null, guardianEmailMasked: MASKED },
} as const;

function meReturns(data: unknown) {
  mockMeQuery.mockReturnValue({
    data,
    isError: false,
    isFetching: false,
    refetch: mockRefetch,
  });
}

const HEADLINE = 'We’ve emailed your parent or guardian';

afterEach(() => {
  jest.restoreAllMocks();
});

beforeEach(() => {
  jest.clearAllMocks();
  meReturns(SHAPES.pendingMinor);
  mockResendMutate.mockImplementation((_input: unknown, options: { onSuccess?: () => void }) =>
    options.onSuccess?.(),
  );
});

describe('the four me.get shapes', () => {
  it('explains the wait to a pending minor, naming the guardian and the masked inbox', () => {
    render(<GuardianConsentPendingScreen />);

    expect(screen.getByText(HEADLINE)).toBeTruthy();
    expect(screen.getByText(MASKED)).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it.each([
    ['an adult client', SHAPES.adult],
    ['a consented minor', SHAPES.consentedMinor],
    ['a minor who has aged out', SHAPES.agedOut],
  ])('sends %s straight into onboarding', (_label, shape) => {
    meReturns(shape);

    render(<GuardianConsentPendingScreen />);

    expect(mockReplace).toHaveBeenCalledWith('/(client-onboarding)');
    expect(screen.queryByText(HEADLINE)).toBeNull();
  });

  it('shows a skeleton, not a spinner and not a blank screen, before me.get lands', () => {
    mockMeQuery.mockReturnValue({
      data: undefined,
      isError: false,
      isFetching: true,
      refetch: mockRefetch,
    });

    render(<GuardianConsentPendingScreen />);

    expect(screen.getByLabelText('Checking with your parent or guardian')).toBeTruthy();
    expect(screen.queryByText(HEADLINE)).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('offers a retry and a working sign-out when me.get cannot be reached', () => {
    mockMeQuery.mockReturnValue({
      data: undefined,
      isError: true,
      isFetching: false,
      refetch: mockRefetch,
    });

    render(<GuardianConsentPendingScreen />);

    expect(screen.getByText('We can’t check on this right now')).toBeTruthy();
    // No resend: with no `me.get` we cannot name the inbox it would go to.
    expect(screen.queryByText('Send the email again')).toBeNull();

    fireEvent.press(screen.getByText('Try again'));
    expect(mockRefetch).toHaveBeenCalled();

    fireEvent.press(screen.getByText('Sign out'));
    expect(mockSignOut).toHaveBeenCalled();
  });
});

describe('the two actions', () => {
  it('resends to the address on file', () => {
    render(<GuardianConsentPendingScreen />);

    fireEvent.press(screen.getByText('Send the email again'));

    expect(mockResendMutate).toHaveBeenCalledTimes(1);
    expect(mockResendMutate.mock.calls[0]?.[0]).toEqual({});
    expect(
      screen.getByText(
        `Sent again to ${MASKED}. It can take a couple of minutes to arrive — the spam folder is worth a look.`,
      ),
    ).toBeTruthy();
  });

  it('corrects the address and re-sends in one action', () => {
    render(<GuardianConsentPendingScreen />);

    fireEvent.press(screen.getByText('Use a different email'));
    fireEvent.changeText(
      screen.getByLabelText('Your parent or guardian’s email'),
      'mum@example.com',
    );
    fireEvent.press(screen.getByText('Send to this email'));

    expect(mockResendMutate).toHaveBeenCalledTimes(1);
    expect(mockResendMutate.mock.calls[0]?.[0]).toEqual({ guardianEmail: 'mum@example.com' });
    // The masked value on screen is now stale — the correction changed it.
    expect(mockInvalidate).toHaveBeenCalled();
  });

  it('will not send a half-typed address', () => {
    render(<GuardianConsentPendingScreen />);

    fireEvent.press(screen.getByText('Use a different email'));
    fireEvent.changeText(screen.getByLabelText('Your parent or guardian’s email'), 'mum@');
    fireEvent.press(screen.getByText('Send to this email'));

    expect(mockResendMutate).not.toHaveBeenCalled();
  });

  it('shows the rate limit as a disabled action with a wait, never as a post-tap error', () => {
    render(<GuardianConsentPendingScreen />);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      fireEvent.press(screen.getByText('Send the email again'));
    }
    expect(mockResendMutate).toHaveBeenCalledTimes(3);

    // The fourth is prevented BEFORE the call, which is the acceptance
    // criterion — the control is inert and the wait is stated in legible
    // text next to it, not in the `fg.faint` disabled label.
    expect(screen.getByText('Send again in 15 min')).toBeTruthy();
    fireEvent.press(screen.getByText('Send the email again'));
    expect(mockResendMutate).toHaveBeenCalledTimes(3);

    // And the same sentence rides on the control itself, so a screen reader
    // meets the constraint with the button rather than after it.
    expect(screen.getByLabelText('Send the email again. Send again in 15 min.')).toBeTruthy();

    // And the correction still works while the resend is waiting: a wrong
    // address must never be stuck behind a limit meant for a right one.
    expect(screen.getByText('Use a different email')).toBeTruthy();
  });

  it('signs out from the pending state', () => {
    render(<GuardianConsentPendingScreen />);

    fireEvent.press(screen.getByText('Sign out'));

    expect(mockSignOut).toHaveBeenCalled();
  });

  it('does not put account deletion one tap away', () => {
    render(<GuardianConsentPendingScreen />);

    expect(screen.queryByText(/delete/i)).toBeNull();
  });
});

describe('noticing that the guardian has confirmed', () => {
  function captureAppStateListeners(): ((next: AppStateStatus) => void)[] {
    const listeners: ((next: AppStateStatus) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((
      _type: string,
      handler: (next: AppStateStatus) => void,
    ) => {
      listeners.push(handler);
      return { remove: jest.fn() };
    }) as typeof AppState.addEventListener);
    return listeners;
  }

  it('re-checks when the app comes back to the foreground, and not when it leaves', () => {
    const listeners = captureAppStateListeners();
    render(<GuardianConsentPendingScreen />);
    mockRefetch.mockClear();

    act(() => {
      for (const listener of listeners) listener('background');
    });
    expect(mockRefetch).not.toHaveBeenCalled();

    // The real sequence: a parent standing next to the client says "done",
    // and the client brings the app back.
    act(() => {
      for (const listener of listeners) listener('active');
    });
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  // `CLAUDE.md` §19 — a poll on a screen whose entire job is to wait spends
  // battery to be slower than the tap that brings the app back.
  it('never polls on a timer', () => {
    jest.useFakeTimers();
    try {
      render(<GuardianConsentPendingScreen />);
      mockRefetch.mockClear();

      act(() => {
        jest.advanceTimersByTime(10 * 60 * 1000);
      });

      expect(mockRefetch).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('analytics', () => {
  it('records the arrival once, with no properties at all', () => {
    const view = render(<GuardianConsentPendingScreen />);
    view.rerender(
      <SafeAreaProvider initialMetrics={TEST_METRICS}>
        <GuardianConsentPendingScreen />
      </SafeAreaProvider>,
    );

    const viewed = mockTrackEvent.mock.calls.filter(
      ([name]) => name === 'guardian_consent_pending_viewed',
    );
    expect(viewed).toHaveLength(1);
    expect(viewed[0]?.[1]).toEqual({});
  });

  it('records a resend, and whether it carried a correction, never the address', () => {
    render(<GuardianConsentPendingScreen />);

    fireEvent.press(screen.getByText('Send the email again'));
    expect(mockTrackEvent).toHaveBeenCalledWith('guardian_consent_resend_requested', {
      address_changed: false,
    });

    fireEvent.press(screen.getByText('Use a different email'));
    fireEvent.changeText(
      screen.getByLabelText('Your parent or guardian’s email'),
      'mum@example.com',
    );
    fireEvent.press(screen.getByText('Send to this email'));

    expect(mockTrackEvent).toHaveBeenCalledWith('guardian_consent_resend_requested', {
      address_changed: true,
    });
    for (const [, properties] of mockTrackEvent.mock.calls) {
      expect(JSON.stringify(properties)).not.toContain('mum@example.com');
      expect(JSON.stringify(properties)).not.toContain('gmail');
    }
  });
});

describe('copy (COPY.md §CO1, §CO2)', () => {
  // Every one of these turns a two-minute wait into a suspension notice.
  // The first screen a young client sees may not do that.
  it.each(['blocked', 'restricted', 'suspended', 'under review', 'not allowed', 'verify'])(
    'never says %p',
    (word) => {
      render(<GuardianConsentPendingScreen />);

      expect(screen.queryByText(new RegExp(word, 'i'))).toBeNull();
    },
  );

  it('names the guardian, not the client, as the party being waited on', () => {
    render(<GuardianConsentPendingScreen />);

    expect(screen.getByText(HEADLINE)).toBeTruthy();
    expect(
      screen.getByText(
        'They need to confirm before your coach can start you off. It takes them one tap — no app, no account.',
      ),
    ).toBeTruthy();
  });
});

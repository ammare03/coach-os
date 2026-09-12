import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useAuthStore } from '../../store.ts';
import { PendingDeletionScreen } from '../PendingDeletionScreen.tsx';

// `account-actions/02` Approach step 6 — the blocking state's three exits,
// the purge date in the user's own timezone, and what each of them does
// when the radio is off.

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockCancelDeletion = jest.fn();
const mockInvalidateMe = jest.fn();
const mockRequestSignOut = jest.fn();
let mockIsConnected = true;
let mockCancelOptions: { onSuccess?: () => void } = {};
let mockPendingCount: number | null = null;

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

jest.mock('../../../../lib/connectivity/useConnectivity.ts', () => ({
  useConnectivity: () => ({ isConnected: mockIsConnected }),
}));

// `account-actions/01`'s flow, mocked at its own seam: what matters here is
// that Sign out reaches it, and keeps reaching it with no connection.
jest.mock('../../hooks/useSignOutFlow.ts', () => ({
  useSignOutFlow: () => ({
    requestSignOut: mockRequestSignOut,
    isSigningOut: false,
    pendingCount: mockPendingCount,
    keepSignedIn: jest.fn(),
    discardAndSignOut: jest.fn(),
  }),
}));

// 00:15 on 20 September in Asia/Kolkata; 18:45 on the 19th in UTC. A screen
// that rendered the device's day would say the 19th and be wrong by one for
// every client east of the meridian (`code-conventions` §6).
const SCHEDULED = new Date('2026-09-19T18:45:00.000Z');

const ME_REF: { current: Record<string, unknown> | undefined } = {
  current: {
    id: 'user-1',
    role: 'client',
    timezone: 'Asia/Kolkata',
    deletionScheduledFor: SCHEDULED,
  },
};

jest.mock('../../../../lib/trpc.ts', () => ({
  api: {
    me: {
      get: {
        useQuery: () => ({
          data: ME_REF.current,
          isPending: false,
          isError: false,
          refetch: jest.fn(),
        }),
      },
      cancelDeletion: {
        useMutation: (options: { onSuccess?: () => void }) => {
          mockCancelOptions = options;
          return { mutate: mockCancelDeletion, isPending: false };
        },
      },
    },
    useUtils: () => ({ me: { get: { invalidate: mockInvalidateMe } } }),
  },
}));

const INSETS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function renderAs(role: 'coach' | 'client') {
  useAuthStore.setState({ status: 'authenticated', userId: 'user-1', role, isOnboarded: true });
  ME_REF.current = {
    id: 'user-1',
    role,
    timezone: 'Asia/Kolkata',
    deletionScheduledFor: SCHEDULED,
  };
  return render(
    <SafeAreaProvider initialMetrics={INSETS}>
      <PendingDeletionScreen />
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockIsConnected = true;
  mockPendingCount = null;
  mockCancelOptions = {};
});

describe('the three exits', () => {
  it('offers exactly three, and no fourth', () => {
    renderAs('client');

    const labels = screen
      .getAllByRole('button')
      .map((node) => node.props.accessibilityLabel)
      .filter((label): label is string => typeof label === 'string');

    expect(labels).toEqual(['Restore my account', 'Export your data', 'Sign out']);
  });

  it('cannot re-request deletion — there is no button for it', () => {
    renderAs('client');

    expect(screen.queryByText(/^Delete account$/)).toBeNull();
    expect(screen.queryByText(/delete my account/i)).toBeNull();
  });

  it('sends Export your data to the export screen', () => {
    renderAs('client');

    fireEvent.press(screen.getByLabelText('Export your data'));

    expect(mockPush).toHaveBeenCalledWith('/your-data');
  });

  it('reaches the shared sign-out flow', () => {
    renderAs('client');

    fireEvent.press(screen.getByLabelText('Sign out'));

    expect(mockRequestSignOut).toHaveBeenCalledTimes(1);
  });

  it('renders the unsynced-work prompt when the wipe was refused', () => {
    mockPendingCount = 3;
    renderAs('client');

    expect(screen.getByText('3 entries haven’t synced yet')).toBeTruthy();
  });
});

describe('restore', () => {
  it('calls me.cancelDeletion', () => {
    renderAs('client');

    fireEvent.press(screen.getByLabelText('Restore my account'));

    expect(mockCancelDeletion).toHaveBeenCalledTimes(1);
  });

  it('returns the user to the app they left', async () => {
    renderAs('client');

    fireEvent.press(screen.getByLabelText('Restore my account'));
    mockCancelOptions.onSuccess?.();

    await waitFor(() => expect(mockInvalidateMe).toHaveBeenCalled());
    expect(mockReplace).toHaveBeenCalledWith('/');
  });
});

describe('the purge date', () => {
  it('renders in the user’s timezone, not the device’s', () => {
    renderAs('client');

    const date = screen.getByTestId('pending-deletion-date').props.children;
    const rendered = Array.isArray(date) ? date.join('') : String(date);

    expect(rendered).toMatch(/20/);
    expect(rendered).toMatch(/September/);
    expect(rendered).toMatch(/2026/);
    // The UTC day. Rendering it would move a purge a day earlier for every
    // user east of the meridian.
    expect(rendered).not.toMatch(/19/);
  });

  it('is absolute, never a countdown', () => {
    renderAs('client');

    expect(screen.queryByText(/days left/i)).toBeNull();
    expect(screen.queryByText(/in \d+ days/i)).toBeNull();
  });
});

describe('role copy', () => {
  it('tells a coach their clients have 30 days, and keep their own data', () => {
    renderAs('coach');

    expect(screen.getByText(/30 days to export/)).toBeTruthy();
    expect(screen.getByText(/They keep their own data/)).toBeTruthy();
  });

  it('says nothing about clients to a client', () => {
    renderAs('client');

    expect(screen.queryByText(/30 days/)).toBeNull();
  });
});

describe('offline', () => {
  it('disables Restore and Export, and says why', () => {
    mockIsConnected = false;
    renderAs('client');

    fireEvent.press(screen.getByLabelText(/Restore my account/));
    expect(mockCancelDeletion).not.toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText(/Export your data/));
    expect(mockPush).not.toHaveBeenCalled();

    expect(screen.getByText(/needs a connection/i)).toBeTruthy();
  });

  it('leaves Sign out working — it is the exit that never depends on a network', () => {
    mockIsConnected = false;
    renderAs('client');

    fireEvent.press(screen.getByLabelText('Sign out'));

    expect(mockRequestSignOut).toHaveBeenCalledTimes(1);
  });
});

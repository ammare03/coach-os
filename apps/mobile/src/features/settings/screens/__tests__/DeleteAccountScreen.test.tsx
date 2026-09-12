import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import DeleteAccountRoute from '../../../../app/delete-account.tsx';
import { useAuthStore } from '../../../auth/store.ts';
import { DeleteAccountScreen } from '../DeleteAccountScreen.tsx';
import { SettingsScreen } from '../SettingsScreen.tsx';

// `account-actions/02`'s Verification section, automated half: the role
// copy, the export offer, the three-tap walk from the settings root, the
// typed confirmation, the offline refusal, and the one analytics event.
//
// What is under test is which words a role produces and what the screen
// sends — never tRPC, and never the transport.

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockRequestDeletion = jest.fn();
const mockInvalidateMe = jest.fn();
const mockTrackEvent = jest.fn();
let mockIsConnected = true;
// Captured so a test can fire the mutation's own success path rather than
// asserting against a hook's internals.
let mockRequestDeletionOptions: { onSuccess?: () => void } = {};

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack }),
}));

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.2.0',
  nativeBuildVersion: '24',
}));

// `AppearanceRow` reads `meta.appearance` from the local mirror; `expo-sqlite`
// has no Jest-side native module. Same fake `SettingsScreen.test` uses.
jest.mock('expo-sqlite', () =>
  require('../../../../lib/outbox/__fixtures__/sqlite-fake.ts').createSqliteFake(),
);

jest.mock('../../../../db/wipe.ts', () => ({
  wipeLocalDatabase: jest.fn(async () => ({ outcome: 'wiped' as const })),
}));

jest.mock('../../../../lib/query/persister.ts', () => ({
  clearPersistedQueryCache: jest.fn(async () => undefined),
}));

jest.mock('../../../auth/token-store.ts', () => ({
  getTokens: jest.fn(async () => null),
  clearTokens: jest.fn(async () => undefined),
}));

jest.mock('../../../../lib/analytics/index.ts', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

jest.mock('../../../../lib/connectivity/useConnectivity.ts', () => ({
  useConnectivity: () => ({ isConnected: mockIsConnected }),
}));

const ME = {
  id: 'user-1',
  name: 'Priya Raman',
  email: 'priya@example.com',
  weightUnit: 'kg' as const,
  // 2026-09-12 in the tests' frozen clock; 400 days earlier.
  createdAt: new Date('2025-08-08T09:00:00.000Z'),
  timezone: 'Asia/Kolkata',
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
      updatePreferences: { useMutation: () => ({ mutate: jest.fn() }) },
      requestDeletion: {
        useMutation: (options: { onSuccess?: () => void }) => {
          mockRequestDeletionOptions = options;
          return { mutate: mockRequestDeletion, isPending: false };
        },
      },
    },
    auth: { signOut: { useMutation: () => ({ mutateAsync: jest.fn() }) } },
    useUtils: () => ({
      invalidate: jest.fn(),
      me: {
        get: {
          cancel: jest.fn(),
          getData: () => ME_REF.current,
          setData: jest.fn(),
          invalidate: mockInvalidateMe,
        },
      },
    }),
  },
}));

// Referenced from inside the factory above, so it must exist at module
// scope and be mutable — the `me.get` payload is the same in every test
// here except where a case says otherwise.
const ME_REF: { current: typeof ME | undefined } = { current: ME };

const INSETS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function renderAs(role: 'coach' | 'client', ui: ReactElement) {
  useAuthStore.setState({ status: 'authenticated', userId: 'user-1', role, isOnboarded: true });
  return render(<SafeAreaProvider initialMetrics={INSETS}>{ui}</SafeAreaProvider>);
}

/** Every row's `accessibilityLabel`, in the order they are rendered. */
function rowLabelsInOrder(): string[] {
  return screen
    .getAllByRole('button')
    .map((node) => node.props.accessibilityLabel)
    .filter((label): label is string => typeof label === 'string');
}

const EXPORT_ROW = 'Your data, Request a copy of everything you have logged';

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-09-12T09:00:00.000Z').getTime());
  mockIsConnected = true;
  ME_REF.current = ME;
  mockRequestDeletionOptions = {};
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the Delete account row', () => {
  it.each(['coach', 'client'] as const)('sits directly below Your data for a %s', (role) => {
    renderAs(role, <SettingsScreen />);

    const labels = rowLabelsInOrder();

    expect(labels).toContain('Delete account');
    expect(labels.indexOf('Delete account')).toBe(labels.indexOf(EXPORT_ROW) + 1);
  });

  it('opens the delete-account screen', () => {
    renderAs('client', <SettingsScreen />);

    fireEvent.press(screen.getByLabelText('Delete account'));

    expect(mockPush).toHaveBeenCalledWith('/delete-account');
  });

  it('draws no chevron — it is destructive, and a destructive row acts', () => {
    renderAs('client', <SettingsScreen />);

    const row = screen.getByTestId('settings-delete-account');

    // `includeHiddenElements`: the chevron sits inside the trailing column,
    // which `ListRow` hides from the reading order on purpose.
    expect(
      within(row).queryByTestId('list-row-chevron', { includeHiddenElements: true }),
    ).toBeNull();
  });
});

describe('the screen', () => {
  it('offers the export before the destructive action, and links to it', () => {
    renderAs('client', <DeleteAccountScreen onBack={mockBack} />);

    fireEvent.press(screen.getByLabelText('Export your data'));

    expect(mockPush).toHaveBeenCalledWith('/your-data');
  });

  it('tells a client what is deleted, and that their coach loses access', () => {
    renderAs('client', <DeleteAccountScreen onBack={mockBack} />);

    expect(screen.getByText(/Everything you have logged is deleted/)).toBeTruthy();
    expect(screen.getByText(/Your coach loses access to it/)).toBeTruthy();
    expect(screen.getByText(/7 days to change your mind/)).toBeTruthy();
    // The coach's timeline is not the client's, and saying so here would be
    // wrong rather than merely irrelevant.
    expect(screen.queryByText(/30 days/)).toBeNull();
  });

  it('names the 30-day client window and that clients keep their data, for a coach', () => {
    renderAs('coach', <DeleteAccountScreen onBack={mockBack} />);

    expect(screen.getByText(/30 days to export/)).toBeTruthy();
    expect(screen.getByText(/They keep their own data/)).toBeTruthy();
    expect(screen.getByText(/detached from you, not deleted with you/i)).toBeTruthy();
  });

  it('never argues — no retention plea, no guilt, no offer to stay', () => {
    for (const role of ['coach', 'client'] as const) {
      renderAs(role, <DeleteAccountScreen onBack={mockBack} />);
      for (const plea of [
        /are you sure/i,
        /we'?re sorry/i,
        /sorry to see you go/i,
        /discount/i,
        /instead/i,
        /miss you/i,
        /reconsider/i,
        /stay/i,
        /!/,
      ]) {
        expect(screen.queryByText(plea)).toBeNull();
      }
      screen.unmount();
    }
  });
});

describe('the typed confirmation', () => {
  function openConfirmation() {
    renderAs('client', <DeleteAccountScreen onBack={mockBack} />);
    fireEvent.press(screen.getByTestId('delete-account-action'));
    return screen.getByTestId('delete-account-confirm');
  }

  it('keeps the confirm disabled until the exact word is typed', () => {
    const dialog = openConfirmation();
    const confirm = within(dialog).getByText('Delete account');
    const input = within(dialog).getByLabelText('Type DELETE to confirm');

    fireEvent.press(confirm);
    expect(mockRequestDeletion).not.toHaveBeenCalled();

    fireEvent.changeText(input, 'delete');
    fireEvent.press(confirm);
    expect(mockRequestDeletion).not.toHaveBeenCalled();

    fireEvent.changeText(input, 'DELETE');
    fireEvent.press(confirm);
    expect(mockRequestDeletion).toHaveBeenCalledTimes(1);
  });

  it('asks for no email address anywhere in the flow', () => {
    const dialog = openConfirmation();

    expect(within(dialog).queryByLabelText(/email/i)).toBeNull();
    expect(screen.queryByPlaceholderText(/@/)).toBeNull();
  });
});

describe('three taps from the settings root', () => {
  it('reaches a submitted me.requestDeletion in exactly three presses, both roles', () => {
    for (const role of ['coach', 'client'] as const) {
      jest.clearAllMocks();
      let taps = 0;

      // Tap 1 — the settings row.
      renderAs(role, <SettingsScreen />);
      fireEvent.press(screen.getByLabelText('Delete account'));
      taps += 1;
      expect(mockPush).toHaveBeenCalledWith('/delete-account');
      screen.unmount();

      // The route is composition only; pressing the row lands here.
      renderAs(role, <DeleteAccountRoute />);

      // Tap 2 — the screen's destructive button.
      fireEvent.press(screen.getByTestId('delete-account-action'));
      taps += 1;

      // Typing is deliberation, not navigation — it is not a tap.
      const dialog = screen.getByTestId('delete-account-confirm');
      fireEvent.changeText(within(dialog).getByLabelText('Type DELETE to confirm'), 'DELETE');

      // Tap 3 — the confirmation.
      fireEvent.press(within(dialog).getByText('Delete account'));
      taps += 1;

      expect(taps).toBe(3);
      expect(mockRequestDeletion).toHaveBeenCalledTimes(1);
      screen.unmount();
    }
  });

  it('has no fourth step between the row and the confirmation', () => {
    renderAs('client', <DeleteAccountScreen onBack={mockBack} />);

    for (const interstitial of [/continue/i, /next/i, /why are you leaving/i, /before you go/i]) {
      expect(screen.queryByText(interstitial)).toBeNull();
    }
  });
});

describe('after the request', () => {
  function submit() {
    renderAs('client', <DeleteAccountScreen onBack={mockBack} />);
    fireEvent.press(screen.getByTestId('delete-account-action'));
    const dialog = screen.getByTestId('delete-account-confirm');
    fireEvent.changeText(within(dialog).getByLabelText('Type DELETE to confirm'), 'DELETE');
    fireEvent.press(within(dialog).getByText('Delete account'));
    mockRequestDeletionOptions.onSuccess?.();
  }

  it('invalidates me.get and routes to the pending state', async () => {
    submit();

    await waitFor(() => expect(mockInvalidateMe).toHaveBeenCalled());
    expect(mockReplace).toHaveBeenCalledWith('/pending-deletion');
  });

  it('fires account_deletion_requested once, with role and account_age_days only', () => {
    submit();

    expect(mockTrackEvent).toHaveBeenCalledTimes(1);
    const [name, properties] = mockTrackEvent.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe('account_deletion_requested');
    expect(Object.keys(properties).sort()).toEqual(['account_age_days', 'role']);
    expect(properties).toEqual({ role: 'client', account_age_days: 400 });
  });

  it('never sends the email, the name, or a reason', () => {
    submit();

    const [, properties] = mockTrackEvent.mock.calls[0] as [string, Record<string, unknown>];
    expect(JSON.stringify(properties)).not.toContain(ME.email);
    expect(JSON.stringify(properties)).not.toContain(ME.name);
  });
});

describe('offline', () => {
  it('disables the destructive action and says why', () => {
    mockIsConnected = false;
    renderAs('client', <DeleteAccountScreen onBack={mockBack} />);

    fireEvent.press(screen.getByTestId('delete-account-action'));

    expect(screen.queryByTestId('delete-account-confirm')).toBeNull();
    expect(screen.getByText(/needs a connection/i)).toBeTruthy();
    expect(screen.getByText(/Nothing is queued up to happen later/i)).toBeTruthy();
  });

  it('carries the reason on the control too, so it is announced with it', () => {
    mockIsConnected = false;
    renderAs('client', <DeleteAccountScreen onBack={mockBack} />);

    expect(screen.getByTestId('delete-account-action').props.accessibilityLabel).toMatch(
      /needs a connection/i,
    );
  });

  it('queues nothing — a deletion left on a device is not a thing', () => {
    mockIsConnected = false;
    renderAs('client', <DeleteAccountScreen onBack={mockBack} />);

    fireEvent.press(screen.getByTestId('delete-account-action'));

    expect(mockRequestDeletion).not.toHaveBeenCalled();
    expect(mockTrackEvent).not.toHaveBeenCalled();
  });
});

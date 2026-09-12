import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import ClientSettingsRoute from '../../../../app/(client)/settings/index.tsx';
import CoachSettingsRoute from '../../../../app/(coach)/settings/index.tsx';
import { useAuthStore } from '../../../auth/store.ts';
import { SettingsScreen } from '../SettingsScreen.tsx';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '1.2.0',
  nativeBuildVersion: '24',
}));

// `AppearanceRow` reads `meta.appearance` from the local mirror
// (`settings-shell/03`). `expo-sqlite` has no Jest-side native module, so
// the same fake `lib/outbox` maintains stands in for it.
jest.mock('expo-sqlite', () =>
  require('../../../../lib/outbox/__fixtures__/sqlite-fake.ts').createSqliteFake(),
);

type MeQuery = {
  data: { id: string; name: string; email: string; weightUnit: 'kg' | 'lb' } | undefined;
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
};

const mockLoaded: MeQuery = {
  data: { id: 'user-1', name: 'Priya Raman', email: 'priya@example.com', weightUnit: 'kg' },
  isPending: false,
  isError: false,
  refetch: jest.fn(),
};

let mockMeQuery: MeQuery = mockLoaded;

// `account-actions/01` mounted the footer's Sign out row, so the screen now
// pulls in `useSignOut` too. The wipe itself is covered by `useSignOut.test`
// and `db/__tests__/wipe.test`; here it only has to resolve.
const mockWipeLocalDatabase = jest.fn(async () => ({ outcome: 'wiped' as const }));

jest.mock('../../../../db/wipe.ts', () => ({
  wipeLocalDatabase: () => mockWipeLocalDatabase(),
}));

jest.mock('../../../../lib/query/persister.ts', () => ({
  clearPersistedQueryCache: jest.fn(async () => undefined),
}));

jest.mock('../../../auth/token-store.ts', () => ({
  getTokens: jest.fn(async () => null),
  clearTokens: jest.fn(async () => undefined),
}));

jest.mock('../../../../lib/trpc.ts', () => ({
  api: {
    me: {
      get: { useQuery: () => mockMeQuery },
      updatePreferences: { useMutation: () => ({ mutate: jest.fn() }) },
    },
    auth: { signOut: { useMutation: () => ({ mutateAsync: jest.fn() }) } },
    useUtils: () => ({
      invalidate: jest.fn(),
      me: {
        get: {
          cancel: jest.fn(),
          getData: () => mockMeQuery.data,
          setData: jest.fn(),
          invalidate: jest.fn(),
        },
      },
    }),
  },
}));

const INSETS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function renderScreen(role: 'coach' | 'client', ui: ReactElement = <SettingsScreen />) {
  useAuthStore.setState({
    status: 'authenticated',
    userId: 'user-1',
    role,
    isOnboarded: true,
  });
  return render(<SafeAreaProvider initialMetrics={INSETS}>{ui}</SafeAreaProvider>);
}

/**
 * Rows another phase owns. None of them may appear on this screen yet: the
 * section map reserves the NAME, and a row that opens nothing is the exact
 * failure `settings-shell/01`'s Risks section names.
 */
const UNSHIPPED_ROWS = [
  'Notifications',
  'Availability',
  'Coaching',
  'Blocked people',
  'Privacy & safety',
  'Terms',
  'Privacy Policy',
  'Billing',
  'Branding',
  'Team',
];

beforeEach(() => {
  mockPush.mockClear();
  mockMeQuery = mockLoaded;
  mockWipeLocalDatabase.mockClear();
});

describe('SettingsScreen — the row set, per role', () => {
  it.each(['coach', 'client'] as const)('mounts exactly what has shipped, for a %s', (role) => {
    renderScreen(role);

    expect(screen.getByRole('button', { name: /^Your data/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Medical disclaimer' })).toBeTruthy();
    expect(screen.getByLabelText('App version, 1.2.0 (24)')).toBeTruthy();
    // P03 `account-lifecycle/08`'s control, finally reachable by a user.
    expect(screen.getByLabelText(/Kilograms/)).toBeTruthy();
    // `settings-shell/03`.
    expect(screen.getByText('Appearance')).toBeTruthy();
    // `account-actions/02`. It left `UNSHIPPED_ROWS` in the same change
    // that mounted it; placement and the three-tap walk are asserted by
    // `DeleteAccountScreen.test.tsx`, which owns that flow.
    expect(screen.getByRole('button', { name: 'Delete account' })).toBeTruthy();
  });

  it.each(['coach', 'client'] as const)(
    'draws no placeholder row for an unshipped phase, for a %s',
    (role) => {
      renderScreen(role);

      for (const label of UNSHIPPED_ROWS) {
        expect(screen.queryByText(label)).toBeNull();
      }
    },
  );

  it('shows a coach no client-only row — Coaching is absent, not empty-headed', () => {
    renderScreen('coach');
    expect(screen.queryByText('Coaching')).toBeNull();
  });

  it('shows a client no coach-only row — Availability is absent', () => {
    renderScreen('client');
    expect(screen.queryByText('Availability')).toBeNull();
  });

  it('reads role from the auth store, not the profile — the wrong role never paints', () => {
    // `me.get` says nothing about role here, and the screen still renders
    // the right list, which is the point (`settings-shell/01`, Risks).
    mockMeQuery = { ...mockLoaded, data: undefined, isPending: true, isError: false };
    renderScreen('client');

    expect(screen.getByRole('button', { name: 'Medical disclaimer' })).toBeTruthy();
  });
});

describe('SettingsScreen — Appearance sits in Preferences, below Weight unit', () => {
  it.each(['coach', 'client'] as const)(
    'renders the Preferences eyebrow once the section has two children, for a %s',
    (role) => {
      renderScreen(role);

      const eyebrow = screen.getByText('Preferences');
      // A heading, not a caption — it is what lets a screen reader jump
      // section to section (`accessibility` §2).
      expect(eyebrow.props.accessibilityRole).toBe('header');
    },
  );

  it.each(['coach', 'client'] as const)(
    'puts Appearance after Weight unit and before Your data, for a %s',
    (role) => {
      renderScreen(role);

      const order = screen
        .getAllByText(/^(Preferences|Weight unit|Appearance|Your data)$/)
        .map((node) => node.props.children);

      // "Your data" twice: the section eyebrow, then the row inside it.
      expect(order).toEqual(['Preferences', 'Weight unit', 'Appearance', 'Your data', 'Your data']);
    },
  );

  it('offers Dark selected and Light unavailable, with the reason in words', () => {
    renderScreen('client');

    expect(screen.getByLabelText('Dark, tab 1 of 2').props.accessibilityState).toMatchObject({
      selected: true,
      disabled: false,
    });
    expect(screen.getByLabelText('Light, tab 2 of 2').props.accessibilityState).toMatchObject({
      selected: false,
      disabled: true,
    });
    // Never colour (or dimming) alone — `accessibility` §4.
    expect(screen.getByText(/Light mode isn't ready yet/)).toBeTruthy();
  });

  it('has no System option — it would render the undesigned fallback', () => {
    renderScreen('coach');

    expect(screen.queryByText('System')).toBeNull();
  });

  it('does not promise a detail screen it does not have', () => {
    renderScreen('client');

    // The Appearance row is static text with its value, not a button, and
    // draws no chevron: there is nowhere to go.
    const row = screen.getByLabelText('Appearance');
    expect(row.props.accessibilityRole).toBe('text');
  });
});

describe('SettingsScreen — where each row goes', () => {
  it('Your data pushes /your-data', () => {
    renderScreen('client');

    fireEvent.press(screen.getByRole('button', { name: /^Your data/ }));

    expect(mockPush).toHaveBeenCalledWith('/your-data');
  });

  it('Medical disclaimer pushes /medical-disclaimer', () => {
    renderScreen('coach');

    fireEvent.press(screen.getByRole('button', { name: 'Medical disclaimer' }));

    expect(mockPush).toHaveBeenCalledWith('/medical-disclaimer');
  });

  it('the version row is not a control at all', () => {
    renderScreen('coach');

    expect(screen.getByLabelText('App version, 1.2.0 (24)').props.accessibilityRole).toBe('text');
  });
});

describe('SettingsScreen — the header degrades, the rows do not', () => {
  it('shows a skeleton while the profile loads, with the rows already live', () => {
    mockMeQuery = { ...mockLoaded, data: undefined, isPending: true, isError: false };
    renderScreen('client');

    expect(screen.getByLabelText('Loading your account')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Medical disclaimer' })).toBeTruthy();
  });

  it('falls back when me.get fails, and every row still works', () => {
    mockMeQuery = { data: undefined, isPending: false, isError: true, refetch: jest.fn() };
    renderScreen('coach');

    expect(screen.getByLabelText('Your account. Details unavailable.')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: /^Your data/ }));
    expect(mockPush).toHaveBeenCalledWith('/your-data');
  });

  it('offers a retry rather than a dead end', () => {
    const refetch = jest.fn();
    mockMeQuery = { data: undefined, isPending: false, isError: true, refetch };
    renderScreen('client');

    fireEvent.press(screen.getByRole('button', { name: 'Retry loading your account' }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

// `account-actions/01` — the footer slot `settings-shell/01` left empty.
describe('SettingsScreen — the way out', () => {
  it.each(['coach', 'client'] as const)(
    'renders Sign out as the last row of the screen, for a %s',
    (role) => {
      renderScreen(role);

      const rows = screen
        .getAllByRole('button')
        .map((node) => String(node.props.accessibilityLabel));

      expect(rows.at(-1)).toBe('Sign out');
    },
  );

  it('acts rather than navigating — a destructive row draws no chevron', () => {
    renderScreen('client');

    const row = screen.getByTestId('settings-sign-out');
    expect(row.props.accessibilityRole).toBe('button');
    expect(within(row).queryByTestId('list-row-chevron')).toBeNull();
  });

  it('asks nothing when the outbox is empty — one tap and the wipe runs', async () => {
    renderScreen('coach');

    fireEvent.press(screen.getByTestId('settings-sign-out'));

    await waitFor(() => expect(mockWipeLocalDatabase).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/synced yet$/)).toBeNull();
  });

  it('names the unsynced count instead of discarding it', async () => {
    mockWipeLocalDatabase.mockResolvedValue({
      outcome: 'blocked',
      pendingCount: 2,
    } as unknown as { outcome: 'wiped' });
    renderScreen('client');

    fireEvent.press(screen.getByTestId('settings-sign-out'));

    expect(await screen.findByText('2 entries haven’t synced yet')).toBeTruthy();
    expect(screen.getByText('Keep me signed in')).toBeTruthy();
  });
});

describe('both settings routes compose the one screen', () => {
  it.each([['coach', CoachSettingsRoute] as const, ['client', ClientSettingsRoute] as const])(
    '%s/settings renders SettingsScreen, not the P05 placeholder',
    (role, Route) => {
      renderScreen(role, <Route />);

      expect(screen.getByTestId('settings-screen')).toBeTruthy();
      // The placeholder rendered its own route path and one bare link. Both
      // are gone; the disclaimer is a list row now.
      expect(screen.queryByText(`(${role})/settings/index`)).toBeNull();
      expect(screen.getByRole('button', { name: 'Medical disclaimer' })).toBeTruthy();
    },
  );
});

import { fireEvent, render, screen } from '@testing-library/react-native';
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

jest.mock('../../../../lib/trpc.ts', () => ({
  api: {
    me: {
      get: { useQuery: () => mockMeQuery },
      updatePreferences: { useMutation: () => ({ mutate: jest.fn() }) },
    },
    useUtils: () => ({
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
  'Delete account',
  'Sign out',
  'Billing',
  'Branding',
  'Team',
];

beforeEach(() => {
  mockPush.mockClear();
  mockMeQuery = mockLoaded;
});

describe('SettingsScreen — the row set, per role', () => {
  it.each(['coach', 'client'] as const)('mounts exactly what has shipped, for a %s', (role) => {
    renderScreen(role);

    expect(screen.getByRole('button', { name: /^Your data/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Medical disclaimer' })).toBeTruthy();
    expect(screen.getByLabelText('App version, 1.2.0 (24)')).toBeTruthy();
    // P03 `account-lifecycle/08`'s control, finally reachable by a user.
    expect(screen.getByLabelText(/Kilograms/)).toBeTruthy();
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

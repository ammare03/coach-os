import { existsSync } from 'node:fs';
import path from 'node:path';

import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import CoachMoreRoute from '../../../../app/(coach)/(tabs)/more.tsx';
import { useAuthStore } from '../../../auth/store.ts';
import { MORE_HUB_ROWS, MoreHub, visibleMoreHubRows, type MoreHubRow } from '../MoreHub.tsx';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const INSETS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

/** The expo-router root, for the "every route resolves" check below. */
const APP_DIR = path.resolve(__dirname, '../../../../app');

/**
 * The rows later phases own. None may render until its owning task adds it:
 * a row that opens nothing is a worse store-review outcome than an absent
 * row, and it is this task's stated primary failure mode.
 */
const UNSHIPPED_ROWS = ['Billing', 'Branding', 'Team', 'Gym', 'Join a gym'];

function renderHub(role: 'coach' | 'assistant' = 'coach') {
  useAuthStore.setState({ status: 'authenticated', userId: 'coach-1', role, isOnboarded: true });
  return render(
    <SafeAreaProvider initialMetrics={INSETS}>
      <MoreHub />
    </SafeAreaProvider>,
  );
}

/**
 * Does `route` resolve to a real file under `src/app`?
 *
 * This exists because `Href` cannot be trusted to catch it everywhere:
 * expo-router's typed-route union is generated into `.expo/types`, which is
 * gitignored, so on a clean CI checkout `Href` widens to `string` and a
 * typo compiles. The filesystem is the same answer in both places.
 */
function routeResolves(route: string): boolean {
  const relative = route.replace(/^\//, '');
  return [
    `${relative}.tsx`,
    `${relative}.ts`,
    `${relative}/index.tsx`,
    `${relative}/index.ts`,
  ].some((candidate) => existsSync(path.join(APP_DIR, candidate)));
}

beforeEach(() => {
  mockPush.mockClear();
});

describe('the coach More hub', () => {
  it('renders the three rows that have screens, in the section map order', () => {
    renderHub();

    expect(MORE_HUB_ROWS.map((row) => row.label)).toEqual([
      'Settings',
      'Exercise library',
      'Invite a client',
    ]);
    for (const label of ['Settings', 'Exercise library', 'Invite a client']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
  });

  it('draws no row for a destination a later phase owns', () => {
    renderHub();

    for (const label of UNSHIPPED_ROWS) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it.each([
    ['Settings', '/(coach)/settings'],
    ['Exercise library', '/(coach)/exercise-library'],
    ['Invite a client', '/(coach)/invite-client'],
  ])('sends %s to %s', (label, route) => {
    renderHub();

    fireEvent.press(screen.getByLabelText(label));

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(route);
  });

  it('has no dead row — every route in the map exists under src/app', () => {
    const dead = MORE_HUB_ROWS.filter((row) => !routeResolves(String(row.route)));

    expect(dead.map((row) => `${row.label} -> ${String(row.route)}`)).toEqual([]);
  });

  it('renders with no query client mounted, which is how it renders offline', () => {
    // `@coachos/ui` and `expo-router` are the only things this screen
    // imports. There is no tRPC provider in this file and no mock of
    // `lib/trpc.ts`: if the hub ever grows a query, this test stops
    // rendering rather than quietly acquiring a network dependency.
    expect(() => renderHub()).not.toThrow();
    expect(screen.getByTestId('coach-more-hub')).toBeTruthy();
  });

  it('is what the More tab route composes', () => {
    useAuthStore.setState({
      status: 'authenticated',
      userId: 'coach-1',
      role: 'coach',
      isOnboarded: true,
    });
    render(
      <SafeAreaProvider initialMetrics={INSETS}>
        <CoachMoreRoute />
      </SafeAreaProvider>,
    );

    expect(screen.getByTestId('coach-more-hub')).toBeTruthy();
    expect(screen.getByLabelText('Settings')).toBeTruthy();
  });
});

describe('visibleMoreHubRows', () => {
  it('shows every shipped row to both a root coach and an assistant', () => {
    for (const role of ['coach', 'assistant'] as const) {
      expect(visibleMoreHubRows({ role })).toHaveLength(MORE_HUB_ROWS.length);
    }
  });

  // The mechanism P25 `team-seats-and-roles/05` and P28 `gym-presence/03`
  // both depend on. No shipped row uses it yet, so it is proven against a
  // row declared here rather than left untested until they arrive.
  it('drops a row whose predicate refuses the session', () => {
    const rootOnly: MoreHubRow = {
      ...(MORE_HUB_ROWS[0] as MoreHubRow),
      label: 'Billing',
      visibleWhen: ({ role }) => role === 'coach',
    };

    expect(visibleMoreHubRows({ role: 'coach' }, [rootOnly])).toHaveLength(1);
    expect(visibleMoreHubRows({ role: 'assistant' }, [rootOnly])).toEqual([]);
  });
});

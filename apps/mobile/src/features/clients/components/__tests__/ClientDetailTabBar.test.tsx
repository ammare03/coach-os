import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { CLIENT_DETAIL_TABS, type ClientIdentity } from '../../api.ts';
import { ClientDetailTabBar, type ClientDetailTabBarProps } from '../ClientDetailTabBar.tsx';

// §8.3's tab shell: six facets, in the designed order, each one reachable
// and each one announcing its position. The `notes` route is in the
// directory and declared by `_layout.tsx` — this asserts it is NOT a facet,
// because the thing that would break silently is a seventh tab appearing
// the day `coach-notes` lands.

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const CLIENT_ID = '01924f2c-0000-7000-8000-00000000000a';
const ROUTE_NAMES = ['index', 'training', 'nutrition', 'videos', 'checkins', 'chat', 'notes'];

const emit = jest.fn(() => ({ defaultPrevented: false }));
const navigate = jest.fn();
const onBack = jest.fn();

let mockIdentity: { data?: ClientIdentity };

jest.mock('../../api.ts', () => {
  const actual = jest.requireActual('../../api.ts') as Record<string, unknown>;
  return { ...actual, useClientIdentity: () => mockIdentity };
});

/**
 * A minimal stand-in for what `<Tabs tabBar>` hands the bar — narrowed with
 * a cast for the same reason `CoachTabBar.test.tsx` does it: react-navigation's
 * state and descriptor map carry a dozen fields this component never reads.
 */
function makeProps(activeIndex = 0): ClientDetailTabBarProps {
  const routes = ROUTE_NAMES.map((name) => ({ key: `${name}-key`, name, params: undefined }));

  return {
    state: {
      index: activeIndex,
      key: 'client-detail-tabs',
      routeNames: ROUTE_NAMES,
      routes,
      type: 'tab',
      stale: false,
      history: [],
      preloadedRoutes: [],
    },
    descriptors: Object.fromEntries(routes.map((route) => [route.key, { options: {} }])),
    navigation: { emit, navigate },
    insets: METRICS.insets,
    clientId: CLIENT_ID,
    onBack,
  } as unknown as ClientDetailTabBarProps;
}

function renderBar(activeIndex = 0) {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ClientDetailTabBar {...makeProps(activeIndex)} />
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  emit.mockClear();
  navigate.mockClear();
  onBack.mockClear();
  mockIdentity = {
    data: {
      name: 'Priya Sharma',
      status: 'active',
      goal: 'fat_loss',
      avatarAssetId: null,
      coachSince: new Date('2026-03-01T00:00:00.000Z'),
    },
  };
});

describe('ClientDetailTabBar', () => {
  it('renders the six §8.3 facets in the designed order, and not the seventh', () => {
    renderBar();

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(CLIENT_DETAIL_TABS.length);
    expect(tabs.map((tab) => tab.props.accessibilityLabel)).toEqual([
      'Overview, tab 1 of 6',
      'Training, tab 2 of 6',
      'Nutrition, tab 3 of 6',
      'Videos, tab 4 of 6',
      'Check-ins, tab 5 of 6',
      'Chat, tab 6 of 6',
    ]);
    // Declared in the navigator, deliberately not a facet until
    // `coach-notes` ships.
    expect(screen.queryByText('Notes')).toBeNull();
  });

  it('marks exactly one facet selected, and it follows the navigator', () => {
    renderBar(2);

    const selected = screen
      .getAllByRole('tab')
      .filter((tab) => tab.props.accessibilityState?.selected === true);

    expect(selected).toHaveLength(1);
    expect(selected[0]?.props.accessibilityLabel).toBe('Nutrition, tab 3 of 6');
  });

  it('navigates to a facet that is not already focused, and not to one that is', () => {
    renderBar();

    fireEvent.press(screen.getByLabelText('Training, tab 2 of 6'));
    expect(navigate).toHaveBeenCalledWith('training', undefined);

    navigate.mockClear();
    fireEvent.press(screen.getByLabelText('Overview, tab 1 of 6'));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('names the client, and says what the coach already knows about them', () => {
    renderBar();

    expect(screen.getByText('Priya Sharma')).toBeTruthy();
    expect(screen.getByText('Active · Fat loss')).toBeTruthy();
  });

  it('keeps the way out working before the client has loaded', () => {
    mockIdentity = {};
    renderBar();

    // The shell never depends on a query: a failed or pending Overview
    // still leaves the back control and all six facets usable
    // (`screen-composition` §3).
    expect(screen.getAllByRole('tab')).toHaveLength(CLIENT_DETAIL_TABS.length);
    fireEvent.press(screen.getByLabelText('Back to clients'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

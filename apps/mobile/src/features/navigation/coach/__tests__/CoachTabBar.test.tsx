import { readFileSync } from 'node:fs';
import path from 'node:path';

import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Svg } from 'react-native-svg';

import {
  COACH_DOCK_HEIGHT,
  COACH_DOCK_ICON_SIZE,
  COACH_DOCK_ICON_STROKE_WIDTH,
  COACH_DOCK_SIDE_INSET,
  coachTabBarInset,
  resolveCoachDockBottom,
} from '../coach-dock-metrics.ts';
import { COACH_TABS } from '../coach-tabs.ts';
import { CoachTabBar, type CoachTabBarProps } from '../CoachTabBar.tsx';
import { CoachTabPlaceholder } from '../CoachTabPlaceholder.tsx';

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const emit = jest.fn(() => ({ defaultPrevented: false }));
const navigate = jest.fn();

/**
 * A minimal stand-in for what `<Tabs tabBar>` hands the bar. Narrowed with a
 * cast rather than constructed faithfully: react-navigation's
 * `TabNavigationState` and `BottomTabDescriptorMap` each carry a dozen fields
 * (`render`, per-route `navigation`, router internals) that this component
 * never reads, and fabricating them would test the fixture rather than the
 * dock.
 */
function makeProps(options: {
  activeIndex?: number;
  badges?: Partial<Record<string, string | number>>;
  accessibilityLabels?: Partial<Record<string, string>>;
}): CoachTabBarProps {
  const { activeIndex = 0, badges = {}, accessibilityLabels = {} } = options;
  const routes = COACH_TABS.map((tab) => ({
    key: `${tab.name}-key`,
    name: tab.name,
    params: undefined,
  }));

  const descriptors = Object.fromEntries(
    routes.map((route) => [
      route.key,
      {
        options: {
          ...(badges[route.name] === undefined ? {} : { tabBarBadge: badges[route.name] }),
          ...(accessibilityLabels[route.name] === undefined
            ? {}
            : { tabBarAccessibilityLabel: accessibilityLabels[route.name] }),
        },
      },
    ]),
  );

  return {
    state: {
      index: activeIndex,
      key: 'coach-tabs',
      routeNames: routes.map((route) => route.name),
      routes,
      type: 'tab',
      stale: false,
      history: [],
      preloadedRoutes: [],
    },
    descriptors,
    navigation: { emit, navigate },
    insets: METRICS.insets,
  } as unknown as CoachTabBarProps;
}

function renderBar(options: Parameters<typeof makeProps>[0] = {}) {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <CoachTabBar {...makeProps(options)} />
    </SafeAreaProvider>,
  );
}

beforeEach(() => {
  emit.mockClear();
  navigate.mockClear();
});

describe('CoachTabBar — DESIGN.md §9.1 tabs', () => {
  it('renders all five tabs, with the label and the icon, in the designed order', () => {
    renderBar();

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(5);
    expect(tabs.map((tab) => tab.props.accessibilityLabel)).toEqual([
      'Home',
      'Clients',
      'Programs',
      'Inbox',
      'More',
    ]);

    for (const tab of COACH_TABS) {
      // Both channels, every tab — an icon never travels alone in navigation
      // (`DESIGN.md` §13).
      expect(screen.getByText(tab.label)).toBeTruthy();
      expect(screen.getByTestId(`coach-tab-icon-${tab.name}`)).toBeTruthy();
    }
  });

  it("draws each icon at §9's 20px", () => {
    renderBar();

    for (const tab of COACH_TABS) {
      const svg = within(screen.getByTestId(`coach-tab-icon-${tab.name}`)).UNSAFE_getByType(Svg);
      expect(svg.props.width).toBe(COACH_DOCK_ICON_SIZE);
      expect(svg.props.height).toBe(COACH_DOCK_ICON_SIZE);
      expect(svg.props.strokeWidth).toBe(COACH_DOCK_ICON_STROKE_WIDTH);
    }
  });

  it('marks exactly one tab selected, and it is the focused route', () => {
    renderBar({ activeIndex: 3 });

    const selected = screen
      .getAllByRole('tab')
      .filter((tab) => tab.props.accessibilityState?.selected === true);

    expect(selected).toHaveLength(1);
    expect(selected[0]?.props.accessibilityLabel).toBe('Inbox');
  });

  it('navigates on press, through the tabPress event so a listener can prevent it', () => {
    renderBar({ activeIndex: 0 });

    fireEvent.press(screen.getByLabelText('Clients'));

    expect(emit).toHaveBeenCalledWith({
      type: 'tabPress',
      target: 'clients-key',
      canPreventDefault: true,
    });
    expect(navigate).toHaveBeenCalledWith('clients', undefined);
  });

  it('does not re-navigate when the focused tab is pressed', () => {
    renderBar({ activeIndex: 0 });

    fireEvent.press(screen.getByLabelText('Home'));

    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('CoachTabBar — the Inbox badge', () => {
  // The count itself arrives in `phase-12-feedback-comments/feedback-inbox/03`;
  // what this task owns is the capability to draw one.
  // `includeHiddenElements` throughout: the badge is deliberately outside the
  // reading order (the count is announced through the item's own label
  // instead), and RNTL excludes accessibility-hidden nodes from queries by
  // default. Opting back in is what lets these assert the VISUAL badge.
  const HIDDEN = { includeHiddenElements: true } as const;

  it('renders no badge on any tab when no count is supplied', () => {
    renderBar();

    for (const tab of COACH_TABS) {
      expect(screen.queryByTestId(`coach-tab-badge-${tab.name}`, HIDDEN)).toBeNull();
    }
  });

  it('renders the count on Inbox when one is supplied, and nowhere else', () => {
    renderBar({ badges: { inbox: 3 } });

    const badge = screen.getByTestId('coach-tab-badge-inbox', HIDDEN);
    expect(within(badge).getByText('3', HIDDEN)).toBeTruthy();
    expect(screen.queryByTestId('coach-tab-badge-index', HIDDEN)).toBeNull();
    expect(screen.queryByTestId('coach-tab-badge-more', HIDDEN)).toBeNull();
  });

  it('puts the count in the accessible name, since the badge itself is hidden', () => {
    renderBar({ badges: { inbox: 3 } });

    expect(screen.getByLabelText('Inbox, 3 new')).toBeTruthy();
    expect(
      screen.getByTestId('coach-tab-badge-inbox', HIDDEN).props.accessibilityElementsHidden,
    ).toBe(true);
  });

  it('lets the owning phase override the announced wording', () => {
    renderBar({ badges: { inbox: 3 }, accessibilityLabels: { inbox: 'Inbox, 3 unread' } });

    expect(screen.getByLabelText('Inbox, 3 unread')).toBeTruthy();
  });

  it('treats an empty badge as no badge', () => {
    renderBar({ badges: { inbox: '' } });

    expect(screen.queryByTestId('coach-tab-badge-inbox', HIDDEN)).toBeNull();
  });
});

describe('CoachTabBar — material and geometry', () => {
  const source = readFileSync(path.join(__dirname, '..', 'CoachTabBar.tsx'), 'utf8');

  it('takes its material from GlassSurface and never from a raw blur', () => {
    // `ui-conventions` §5 / DS§12.3 — one primitive owns the platform and
    // accessibility branching, including the runtime collapse to opaque under
    // Reduce Transparency. A local `expo-blur` would silently opt the dock
    // out of it, and that cannot be caught by rendering.
    expect(source).toContain("from '@coachos/ui'");
    expect(source).toContain('<GlassSurface');
    expect(source).not.toMatch(/from '(expo-blur|expo-glass-effect)'/);
  });

  it('renders the dock itself', () => {
    renderBar();

    expect(screen.getByTestId('coach-tab-bar')).toBeTruthy();
  });

  it('floats at the resolved offset rather than sitting flush', () => {
    renderBar();

    const style = StyleSheet.flatten(screen.getByTestId('coach-tab-bar').props.style);
    expect(style.position).toBe('absolute');
    expect(style.bottom).toBe(resolveCoachDockBottom(METRICS.insets.bottom));
    expect(style.height).toBe(COACH_DOCK_HEIGHT);
    expect(style.left).toBe(COACH_DOCK_SIDE_INSET);
    expect(style.right).toBe(COACH_DOCK_SIDE_INSET);
  });
});

describe('CoachTabPlaceholder', () => {
  it("reserves the dock's inset so the last row is not trapped under the glass", () => {
    render(
      <SafeAreaProvider initialMetrics={METRICS}>
        <CoachTabPlaceholder route="(coach)/(tabs)/index" ownedBy="phase-10" />
      </SafeAreaProvider>,
    );

    const style = StyleSheet.flatten(
      screen.getByTestId('coach-tab-placeholder-(coach)/(tabs)/index').props.style,
    );
    expect(style.paddingBottom).toBe(coachTabBarInset(METRICS.insets.bottom));
  });
});

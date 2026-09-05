import { Stack } from 'expo-router';
import { renderRouter, screen, testRouter } from 'expo-router/testing-library';
import {
  Children,
  isValidElement,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from 'react';

import ClientTabsLayout from '../app/(client)/(tabs)/_layout.tsx';
import ClientCoachScreen from '../app/(client)/(tabs)/coach.tsx';
import ClientTodayScreen from '../app/(client)/(tabs)/index.tsx';
import ClientNutritionScreen from '../app/(client)/(tabs)/nutrition.tsx';
import ClientProgressScreen from '../app/(client)/(tabs)/progress.tsx';
import ClientLayout from '../app/(client)/_layout.tsx';
import ClientLiveScreen from '../app/(client)/live/[sessionId].tsx';
import ClientWorkoutSummaryScreen from '../app/(client)/workout/[sessionId]/summary.tsx';
import ClientWorkoutScreen from '../app/(client)/workout/[sessionId].tsx';
import CoachTabsLayout from '../app/(coach)/(tabs)/_layout.tsx';
import CoachClientsScreen from '../app/(coach)/(tabs)/clients.tsx';
import CoachInboxScreen from '../app/(coach)/(tabs)/inbox.tsx';
import CoachHomeScreen from '../app/(coach)/(tabs)/index.tsx';
import CoachMoreScreen from '../app/(coach)/(tabs)/more.tsx';
import CoachProgramsScreen from '../app/(coach)/(tabs)/programs.tsx';
import CoachLayout from '../app/(coach)/_layout.tsx';
import CoachLiveScreen from '../app/(coach)/live/[sessionId].tsx';
import CoachSessionScreen from '../app/(coach)/session/[id].tsx';
import CoachVideoScreen from '../app/(coach)/video/[id].tsx';
import { useAuthStore } from '../features/auth/store.ts';

// `phase-05-app-shell/navigation-primitives/01`, as a test rather than a
// manual pass through the dev URL bar. Its Risks section is explicit that the
// tree shape alone must not be assumed to guarantee the visual result, so
// every assertion below is made against the real group layouts, the real tab
// layouts and the real docks — the three things that between them decide
// whether a dock is on screen.
//
// Three questions, matching the task's three acceptance criteria:
//   1. Is the dock genuinely gone inside a focus mode?
//   2. Does back land on the tab the push came from, not a default tab?
//   3. Are the focus routes' screen options configured as a focus mode?

const FOCUS_MODE_OPTIONS = {
  presentation: 'fullScreenModal',
  gestureEnabled: false,
};

type ScreenProps = { name: string; options?: unknown };
type StackProps = { screenOptions?: unknown; children?: ReactNode };

/** The `<Stack>` a group layout renders inside its `AuthGate`. */
function stackOf(Layout: ComponentType): ReactElement<StackProps> {
  const gate = (Layout as () => ReactNode)();
  if (!isValidElement<{ children?: ReactNode }>(gate)) {
    throw new Error('the group layout did not render an element');
  }
  const stack = gate.props.children;
  if (!isValidElement<StackProps>(stack) || stack.type !== Stack) {
    throw new Error('the group layout must render a <Stack> inside its gate');
  }
  return stack;
}

/** The `<Stack.Screen>` entries declared in that stack, in order. */
function screensOf(Layout: ComponentType): ScreenProps[] {
  return Children.toArray(stackOf(Layout).props.children)
    .filter(
      (child): child is ReactElement<ScreenProps> =>
        isValidElement(child) && child.type === Stack.Screen,
    )
    .map((child) => child.props);
}

function optionsFor(Layout: ComponentType, name: string): unknown {
  const found = screensOf(Layout).find((declared) => declared.name === name);
  if (!found) throw new Error(`no <Stack.Screen name="${name}"> in this layout`);
  return found.options;
}

function renderCoachGroup(initialUrl: string) {
  useAuthStore.setState({ status: 'authenticated', userId: 'coach-1', role: 'coach' });
  return renderRouter(
    {
      _layout: () => <Stack screenOptions={{ headerShown: false }} />,
      '(coach)/_layout': CoachLayout,
      '(coach)/(tabs)/_layout': CoachTabsLayout,
      '(coach)/(tabs)/index': CoachHomeScreen,
      '(coach)/(tabs)/clients': CoachClientsScreen,
      '(coach)/(tabs)/programs': CoachProgramsScreen,
      '(coach)/(tabs)/inbox': CoachInboxScreen,
      '(coach)/(tabs)/more': CoachMoreScreen,
      '(coach)/session/[id]': CoachSessionScreen,
      '(coach)/video/[id]': CoachVideoScreen,
      '(coach)/live/[sessionId]': CoachLiveScreen,
    },
    { initialUrl },
  );
}

function renderClientGroup(initialUrl: string) {
  useAuthStore.setState({ status: 'authenticated', userId: 'client-1', role: 'client' });
  return renderRouter(
    {
      _layout: () => <Stack screenOptions={{ headerShown: false }} />,
      '(client)/_layout': ClientLayout,
      '(client)/(tabs)/_layout': ClientTabsLayout,
      '(client)/(tabs)/index': ClientTodayScreen,
      '(client)/(tabs)/nutrition': ClientNutritionScreen,
      '(client)/(tabs)/progress': ClientProgressScreen,
      '(client)/(tabs)/coach': ClientCoachScreen,
      '(client)/workout/[sessionId]': ClientWorkoutScreen,
      '(client)/workout/[sessionId]/summary': ClientWorkoutSummaryScreen,
      '(client)/live/[sessionId]': ClientLiveScreen,
    },
    { initialUrl },
  );
}

/**
 * The dock stays MOUNTED while a focus mode sits on top of it — the stack
 * keeps the screen below alive, which is what makes AC 2's return instant.
 * "No tab bar" therefore means hidden from the screen and from the
 * accessibility tree, not unmounted, and both halves are asserted: a dock
 * that were merely `opacity: 0` would still be a VoiceOver target over an
 * active set.
 */
function expectDockHidden(testID: string): void {
  expect(screen.getByTestId(testID, { includeHiddenElements: true })).not.toBeVisible();
  expect(screen.queryByTestId(testID)).toBeNull();
}

afterEach(() => {
  useAuthStore.setState({ status: 'unauthenticated', userId: null, role: null });
});

describe('a coach focus mode', () => {
  it.each([
    ['session/[id]', '/session/s1'],
    ['video/[id]', '/video/v1'],
    ['live/[sessionId]', '/live/l1'],
  ])('renders %s with no dock', (route, href) => {
    renderCoachGroup('/(coach)/(tabs)');
    expect(screen.getByTestId('coach-tab-bar')).toBeVisible();

    testRouter.push(href);

    expect(screen.getByText(`(coach)/${route}`)).toBeTruthy();
    expectDockHidden('coach-tab-bar');
  });

  it.each(['/session/s1', '/video/v1', '/live/l1'])(
    'returns from %s to the tab it was entered from, not the default one',
    (href) => {
      // Programs, deliberately: Home is the default tab, so entering from it
      // would pass even if back reset the tab navigator.
      const router = renderCoachGroup('/(coach)/(tabs)/programs');

      testRouter.push(href);
      testRouter.back();

      expect(router.getPathname()).toBe('/programs');
      expect(screen.getByTestId('coach-tab-bar')).toBeVisible();
    },
  );

  it.each(['session/[id]', 'video/[id]', 'live/[sessionId]'])(
    'declares %s as a sibling of (tabs), presented as a focus mode',
    (route) => {
      expect(optionsFor(CoachLayout, route)).toEqual(FOCUS_MODE_OPTIONS);
    },
  );
});

describe('a client focus mode', () => {
  it.each([
    ['workout/[sessionId]', '/workout/w1'],
    ['live/[sessionId]', '/live/l2'],
  ])('renders %s with no dock', (route, href) => {
    renderClientGroup('/(client)/(tabs)');
    expect(screen.getByTestId('client-tab-bar')).toBeVisible();

    testRouter.push(href);

    expect(screen.getByText(`(client)/${route}`)).toBeTruthy();
    expectDockHidden('client-tab-bar');
  });

  it.each(['/workout/w1', '/live/l2'])(
    'returns from %s to the tab it was entered from, not the default one',
    (href) => {
      const router = renderClientGroup('/(client)/(tabs)/progress');

      testRouter.push(href);
      testRouter.back();

      expect(router.getPathname()).toBe('/progress');
      expect(screen.getByTestId('client-tab-bar')).toBeVisible();
    },
  );

  it.each(['workout/[sessionId]', 'live/[sessionId]'])(
    'declares %s as a sibling of (tabs), presented as a focus mode',
    (route) => {
      expect(optionsFor(ClientLayout, route)).toEqual(FOCUS_MODE_OPTIONS);
    },
  );

  it('leaves the post-session summary an ordinary push', () => {
    // It is read after the session ends, so it keeps a back gesture and the
    // default card presentation. Outside a focus mode, still outside (tabs).
    expect(optionsFor(ClientLayout, 'workout/[sessionId]/summary')).toBeUndefined();
  });
});

describe('both group layouts', () => {
  it.each([
    ['(coach)', CoachLayout],
    ['(client)', ClientLayout],
  ])('%s makes (tabs) the first screen of its stack', (_group, Layout) => {
    expect(screensOf(Layout)[0]?.name).toBe('(tabs)');
  });

  it.each([
    ['(coach)', CoachLayout],
    ['(client)', ClientLayout],
  ])('%s declares no focus mode inside (tabs)', (_group, Layout) => {
    // A nested name would put the dock back on screen, which is the whole
    // failure this task exists to prevent.
    const nested = screensOf(Layout)
      .filter((declared) => declared.options !== undefined)
      .filter((declared) => declared.name.startsWith('(tabs)'));

    expect(nested).toEqual([]);
  });

  it.each([
    ['(coach)', CoachLayout],
    ['(client)', ClientLayout],
  ])('%s shows no native header, so nothing carries tab-adjacent chrome', (_group, Layout) => {
    // Not inherited from the root Stack — a nested navigator resolves its own
    // screenOptions, so leaving this off gives every screen in the group a
    // native header titled after its route.
    expect(stackOf(Layout).props.screenOptions).toEqual({ headerShown: false });
  });
});

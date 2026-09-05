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
import ClientLogFoodScreen from '../app/(client)/log-food.tsx';
import ClientRecordFormCheckScreen from '../app/(client)/record-form-check.tsx';
import ClientScanScreen from '../app/(client)/scan.tsx';
import ClientWorkoutSummaryScreen from '../app/(client)/workout/[sessionId]/summary.tsx';
import ClientWorkoutScreen from '../app/(client)/workout/[sessionId].tsx';
import { useAuthStore } from '../features/auth/store.ts';

// `phase-05-app-shell/navigation-primitives/04`. Its three acceptance
// criteria are all about presentation, which expo-router resolves natively
// and a test renderer cannot see pixels of — so what is asserted here is the
// contract that decides those pixels: the exact screen options each route
// carries, and the fact that the three arms of the convention differ.
//
// The Risks section names the real failure — a later phase defaulting every
// new screen to a push. A test that pins all three arms at once is what makes
// that drift visible, so the focus modes and an ordinary push are re-asserted
// alongside the modals rather than left to `focus-modes.test.tsx`.

const MODAL_OPTIONS = {
  presentation: 'modal',
  gestureEnabled: true,
};

const FOCUS_MODE_OPTIONS = {
  presentation: 'fullScreenModal',
  gestureEnabled: false,
};

const MODAL_ROUTES = ['log-food', 'scan', 'record-form-check'];

type ScreenProps = { name: string; options?: unknown };
type StackProps = { screenOptions?: unknown; children?: ReactNode };

/** The `<Stack.Screen>` entries the group layout declares, in order. */
function screensOf(Layout: ComponentType): ScreenProps[] {
  const gate = (Layout as () => ReactNode)();
  if (!isValidElement<{ children?: ReactNode }>(gate)) {
    throw new Error('the group layout did not render an element');
  }
  const stack = gate.props.children;
  if (!isValidElement<StackProps>(stack) || stack.type !== Stack) {
    throw new Error('the group layout must render a <Stack> inside its gate');
  }
  return Children.toArray(stack.props.children)
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

function renderClientGroup(initialUrl: string) {
  useAuthStore.setState({
    status: 'authenticated',
    userId: 'client-1',
    role: 'client',
    isOnboarded: true,
  });
  return renderRouter(
    {
      _layout: () => <Stack screenOptions={{ headerShown: false }} />,
      '(client)/_layout': ClientLayout,
      '(client)/(tabs)/_layout': ClientTabsLayout,
      '(client)/(tabs)/index': ClientTodayScreen,
      '(client)/(tabs)/nutrition': ClientNutritionScreen,
      '(client)/(tabs)/progress': ClientProgressScreen,
      '(client)/(tabs)/coach': ClientCoachScreen,
      '(client)/log-food': ClientLogFoodScreen,
      '(client)/scan': ClientScanScreen,
      '(client)/record-form-check': ClientRecordFormCheckScreen,
      '(client)/workout/[sessionId]': ClientWorkoutScreen,
      '(client)/workout/[sessionId]/summary': ClientWorkoutSummaryScreen,
      '(client)/live/[sessionId]': ClientLiveScreen,
    },
    { initialUrl },
  );
}

afterEach(() => {
  useAuthStore.setState({
    status: 'unauthenticated',
    userId: null,
    role: null,
    isOnboarded: false,
  });
});

describe('the modal routes', () => {
  it.each(MODAL_ROUTES)('presents %s as a modal', (route) => {
    expect(optionsFor(ClientLayout, route)).toEqual(MODAL_OPTIONS);
  });

  it.each(MODAL_ROUTES)('leaves swipe-to-dismiss enabled on %s', (route) => {
    // The half of the convention that carries meaning: a modal is a detour
    // the user may abandon, so the dismiss gesture is never taken away.
    expect(optionsFor(ClientLayout, route)).toMatchObject({ gestureEnabled: true });
  });

  it.each(MODAL_ROUTES)('opens %s over the tab that pushed it, and returns there', (route) => {
    const router = renderClientGroup('/(client)/(tabs)/nutrition');

    testRouter.push(`/${route}`);
    expect(screen.getByText(`(client)/${route}`)).toBeTruthy();

    // AC 3, as far as a test renderer can reach it: the gesture is native, but
    // what it does is dismiss this route, and dismissal must land back where
    // the user was rather than on a default tab.
    testRouter.back();
    expect(router.getPathname()).toBe('/nutrition');
  });

  it.each(MODAL_ROUTES)('declares %s outside (tabs), so it covers the dock', (route) => {
    expect(screensOf(ClientLayout).map((declared) => declared.name)).toContain(route);
  });
});

describe('the three-way convention', () => {
  it('gives a modal and a focus mode different presentations', () => {
    // If these ever converge, the distinction this task exists to draw is
    // gone: a focus mode has one exit, a modal has a gesture out.
    expect(optionsFor(ClientLayout, 'log-food')).not.toEqual(
      optionsFor(ClientLayout, 'workout/[sessionId]'),
    );
    expect(optionsFor(ClientLayout, 'workout/[sessionId]')).toEqual(FOCUS_MODE_OPTIONS);
  });

  it('leaves an ordinary push undeclared rather than modal', () => {
    // The third arm. The post-session summary is a destination you drilled
    // into, not a task you dismiss — no options, so the default card push.
    expect(optionsFor(ClientLayout, 'workout/[sessionId]/summary')).toBeUndefined();
  });

  it('presents no route as a modal by accident', () => {
    const modals = screensOf(ClientLayout)
      .filter((declared) => {
        const options = declared.options;
        return (
          typeof options === 'object' &&
          options !== null &&
          (options as { presentation?: unknown }).presentation === 'modal'
        );
      })
      .map((declared) => declared.name);

    expect(modals).toEqual(MODAL_ROUTES);
  });
});

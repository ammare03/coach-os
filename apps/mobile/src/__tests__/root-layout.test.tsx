import { ThemeProvider } from '@coachos/ui';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { renderRouter, screen } from 'expo-router/testing-library';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import { Text } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import type { ReactTestInstance } from 'react-test-renderer';

import RootLayout from '../app/_layout.tsx';
import { useAuthStore } from '../features/auth/store.ts';
import { api } from '../lib/trpc.ts';

// The acceptance criteria of `phase-05-app-shell/providers-and-gates/01`,
// as a test. Two are structural (nesting order, the gesture root at the
// true root) and two are sequencing (the splash outlives setup; the whole
// stack renders a real route without a dependency failure).
//
// Sits outside `src/app` deliberately — every `.ts`/`.tsx` file under the
// expo-router root becomes a route (see `route-tree.test.tsx`'s own note).

// The root layout imports the Tailwind entry for its side effect. Jest has
// no CSS transform and does not need one; the mock keeps the file from
// being parsed as JavaScript.
jest.mock('../global.css', () => ({}));

// `refresh-client.ts` and `trpc-links.ts` both resolve the API origin at
// module scope, which throws without a build-time `EXPO_PUBLIC_API_URL`.
// The origin is environment config, not part of what this test asserts.
jest.mock('../lib/api-url.ts', () => ({ getApiUrl: () => 'http://localhost:3000/trpc' }));

// Neither native module has a real implementation under Jest, and both are
// the subject of the sequencing assertions below. The doubles are built
// inside the factories rather than closed over, because the root layout
// calls `preventAutoHideAsync` at module scope — that call happens while
// this file's own imports are still resolving, before any `const` here has
// been initialised.
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve(true)),
  hideAsync: jest.fn(() => Promise.resolve(true)),
}));

jest.mock('expo-system-ui', () => ({
  setBackgroundColorAsync: jest.fn(() => Promise.resolve()),
}));

// `providers-and-gates/03` made the splash outlast the auth bootstrap too.
// Stubbed here so the sequencing assertions below stay about the splash: the
// real cold-start sequence has its own tests in `features/auth/__tests__`,
// and the store is driven directly instead.
jest.mock('../features/auth/bootstrap.ts', () => ({ bootstrap: jest.fn(() => Promise.resolve()) }));

const mockHideAsync = jest.mocked(SplashScreen.hideAsync);
const mockSetBackgroundColorAsync = jest.mocked(SystemUI.setBackgroundColorAsync);

// Read here, at module scope, because `clearMocks` (jest.base.js) wipes the
// record before the first test body runs — and the call under test happens
// while `../app/_layout.tsx` is being imported, above.
const preventAutoHideCallsOnImport = jest.mocked(SplashScreen.preventAutoHideAsync).mock.calls
  .length;

const PROBE = 'the route below the stack';

function ProbeScreen() {
  return <Text>{PROBE}</Text>;
}

function renderTree(): void {
  renderRouter({ _layout: RootLayout, index: ProbeScreen }, { initialUrl: '/' });
}

/**
 * The real root layout, the real `Stack`, and one route under it — so the
 * ordering is asserted against the tree the app actually mounts. Resolves
 * once the route has rendered and the native-chrome effect has settled.
 */
async function renderRootLayout(): Promise<void> {
  renderTree();
  expect(await screen.findByText(PROBE)).toBeTruthy();
  await waitFor(() => expect(mockSetBackgroundColorAsync).toHaveBeenCalled());
}

beforeEach(() => {
  // `providers-and-gates/03` made the splash outlast the auth bootstrap, so
  // a resolved session is now part of "setup is done". Which session does not
  // matter here — the route gate itself is asserted in `auth-gate.test.tsx`.
  useAuthStore.setState({
    status: 'unauthenticated',
    userId: null,
    role: null,
    isOnboarded: false,
  });
});

/**
 * Matched on element type by identity rather than through
 * `UNSAFE_getByType`, whose `ComponentType<unknown>` parameter rejects every
 * component in this stack that has real props.
 */
function instanceOf(component: unknown): ReactTestInstance {
  const [match] = screen.UNSAFE_root.findAll((node) => node.type === component);
  if (!match) {
    throw new Error('component is not in the rendered tree');
  }
  return match;
}

/** The number of ancestors between a component instance and the tree root. */
function depthOf(component: unknown): number {
  let node: ReactTestInstance | null = instanceOf(component);
  let depth = 0;
  while (node) {
    node = node.parent;
    depth += 1;
  }
  return depth;
}

/**
 * The host view carrying the layout's `onLayout`. Scoped to the gesture
 * root's own subtree and taken first in tree order, so react-navigation's
 * own `onLayout` handlers further down cannot be mistaken for it.
 */
function rootHostElement(): ReactTestInstance {
  const [host] = instanceOf(GestureHandlerRootView).findAll(
    (node) => typeof node.type === 'string' && typeof node.props.onLayout === 'function',
  );
  if (!host) {
    throw new Error('no host element carries onLayout');
  }
  return host;
}

const LAYOUT_EVENT = { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } } };

describe('the root layout', () => {
  it('holds the splash screen from module scope, before any render', () => {
    // Not from an effect: by the time an effect runs the OS has already
    // dismissed the splash and there is nothing left to prevent.
    expect(preventAutoHideCallsOnImport).toBe(1);
  });

  it('renders a route through the whole stack without a dependency failure', async () => {
    // The failure this guards is tRPC's provider mounting before the query
    // client exists, which throws on the first frame.
    await expect(renderRootLayout()).resolves.toBeUndefined();
  });

  it('nests the providers in dependency order', async () => {
    await renderRootLayout();

    // Query outside tRPC (tRPC's React integration is a layer over it),
    // Theme innermost (presentational, depended on by nothing).
    expect(depthOf(GestureHandlerRootView)).toBeLessThan(depthOf(QueryClientProvider));
    expect(depthOf(QueryClientProvider)).toBeLessThan(depthOf(api.Provider));
    expect(depthOf(api.Provider)).toBeLessThan(depthOf(ThemeProvider));
    expect(depthOf(ThemeProvider)).toBeLessThan(depthOf(BottomSheetModalProvider));
  });

  it('puts the gesture handler root at the true root, with flex: 1', async () => {
    await renderRootLayout();

    // Nothing of ours sits between the layout and the gesture root — RNGH
    // only recognises gestures inside it, modals included.
    expect(depthOf(GestureHandlerRootView)).toBe(depthOf(RootLayout) + 1);
    // Omitting this one style gives a zero-height root and a blank app.
    expect(instanceOf(GestureHandlerRootView).props.style).toEqual({ flex: 1 });
  });

  it('keeps the splash up until setup is done AND the tree has painted', async () => {
    await renderRootLayout();
    expect(mockHideAsync).not.toHaveBeenCalled();

    fireEvent(rootHostElement(), 'layout', LAYOUT_EVENT);

    await waitFor(() => expect(mockHideAsync).toHaveBeenCalledTimes(1));
  });

  it('does not hide the splash on paint alone, before setup resolves', async () => {
    let resolveBackground: () => void = () => undefined;
    mockSetBackgroundColorAsync.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveBackground = resolve;
        }),
    );

    renderTree();
    expect(await screen.findByText(PROBE)).toBeTruthy();
    fireEvent(rootHostElement(), 'layout', LAYOUT_EVENT);

    expect(mockHideAsync).not.toHaveBeenCalled();

    resolveBackground();

    await waitFor(() => expect(mockHideAsync).toHaveBeenCalledTimes(1));
  });
});
